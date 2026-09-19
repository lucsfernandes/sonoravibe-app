import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { advancedControlsSchema, MusicProviderError, type MusicGenerationRequest } from '@sonora/shared';
import { AceStepProvider, buildJobInput } from '../src/providers/acestep.provider';

// ---------------------------------------------------------------------------
// RunPod falsa: responde /run, /status/:id e /cancel/:id com roteiro por teste
// ---------------------------------------------------------------------------

interface Recorded {
  method: string;
  path: string;
  auth?: string;
  body?: any;
}

type Reply = { status?: number; json?: unknown };

interface Script {
  run?: (body: any) => Reply;
  /** Respostas sucessivas do /status; a última se repete. */
  statuses?: Reply[];
}

let server: Server | null = null;

async function fakeRunPod(script: Script) {
  const calls: Recorded[] = [];
  let statusIndex = 0;

  server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    const path = req.url ?? '';
    calls.push({ method: req.method ?? '', path, auth: req.headers.authorization, body });

    let reply: Reply = { status: 404, json: { error: 'rota inexistente' } };
    if (path === '/run') reply = script.run?.(body) ?? { json: { id: 'job-1', status: 'IN_QUEUE' } };
    else if (path.startsWith('/status/')) {
      const list = script.statuses ?? [];
      reply = list[Math.min(statusIndex, list.length - 1)] ?? { status: 500 };
      statusIndex += 1;
    } else if (path.startsWith('/cancel/')) reply = { json: { id: 'job-1', status: 'CANCELLED' } };

    res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.json ?? {}));
  });

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server!.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, calls };
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

// ---------------------------------------------------------------------------

function request(overrides: Partial<MusicGenerationRequest> = {}): MusicGenerationRequest {
  return {
    kind: 'song',
    prompt: 'Brazilian pop rock, warm guitars',
    lyrics: '[Verse]\nAcordei com o sol',
    instrumental: false,
    controls: advancedControlsSchema.parse({ bpm: 104, key: 'Am', vocalGender: 'male' }),
    vocalLanguage: 'pt',
    seed: 42,
    uploadTarget: {
      url: 'https://r2.example/presigned',
      storageKey: 'songs/abc/master.flac',
      contentType: 'audio/flac',
    },
    ...overrides,
  };
}

const COMPLETED = {
  json: {
    id: 'job-1',
    status: 'COMPLETED',
    output: {
      tracks: [
        {
          storage_key: 'songs/abc/master.flac',
          size_bytes: 8_440_887,
          duration_ms: 40_000,
          format: 'flac',
          sample_rate: 48_000,
          bit_depth: 24,
          seed: 42,
        },
      ],
      metadata: { bpm: 104, keyscale: 'A minor', language: 'pt' },
      timings: { generate_s: 33.8 },
    },
  },
};

const fast = { pollIntervalMs: 5, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

describe('AceStepProvider', () => {
  it('submete o job, acompanha a fila e devolve o áudio já gravado no R2', async () => {
    const { baseUrl, calls } = await fakeRunPod({
      statuses: [
        { json: { id: 'job-1', status: 'IN_QUEUE' } },
        { json: { id: 'job-1', status: 'IN_PROGRESS' } },
        COMPLETED,
      ],
    });
    const provider = new AceStepProvider({ baseUrl, apiKey: 'rp-key', ...fast });

    const result = await provider.generate(request());

    expect(result.audio).toEqual({ kind: 'stored', storageKey: 'songs/abc/master.flac', sizeBytes: 8_440_887 });
    expect(result.sourceFormat).toBe('flac');
    expect(result.durationMs).toBe(40_000);
    expect(result.providerRef).toBe('job-1');
    expect(result.providerMetadata).toMatchObject({ bpm: 104, keyscale: 'A minor', seed: 42 });

    const run = calls.find((c) => c.path === '/run')!;
    expect(run.method).toBe('POST');
    expect(run.auth).toBe('Bearer rp-key');
    expect(run.body.input).toMatchObject({
      task_type: 'text2music',
      bpm: 104,
      keyscale: 'A minor',
      vocal_language: 'pt',
      seed: 42,
      instrumental: false,
      uploads: [{ url: 'https://r2.example/presigned', storage_key: 'songs/abc/master.flac' }],
    });
    expect(run.body.input.caption).toContain('male vocal');
    expect(calls.filter((c) => c.path === '/status/job-1').every((c) => c.method === 'GET')).toBe(true);
  });

  it('usa POST no /status para o emulador local do SDK da RunPod', async () => {
    const { baseUrl, calls } = await fakeRunPod({ statuses: [COMPLETED] });
    const provider = new AceStepProvider({ baseUrl, statusMethod: 'POST', ...fast });

    await provider.generate(request());

    expect(calls.find((c) => c.path === '/status/job-1')?.method).toBe('POST');
  });

  it('desiste da fila sem GPU, cancela o job e marca como retentável para cair na reserva', async () => {
    const { baseUrl, calls } = await fakeRunPod({ statuses: [{ json: { id: 'job-1', status: 'IN_QUEUE' } }] });
    const provider = new AceStepProvider({ baseUrl, queueTimeoutMs: 30, ...fast });

    const error = await provider.generate(request()).catch((e) => e);

    expect(error).toBeInstanceOf(MusicProviderError);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('Sem GPU disponível');
    expect(calls.some((c) => c.path === '/cancel/job-1' && c.method === 'POST')).toBe(true);
  });

  it('não retenta quando o handler recusa a entrada', async () => {
    const { baseUrl } = await fakeRunPod({
      statuses: [{ json: { id: 'job-1', status: 'FAILED', error: "entrada inválida: 'caption' é obrigatório" } }],
    });
    const provider = new AceStepProvider({ baseUrl, ...fast });

    const error = await provider.generate(request()).catch((e) => e);

    expect(error.retryable).toBe(false);
  });

  it('retenta quando o worker falha por memória da GPU', async () => {
    const { baseUrl } = await fakeRunPod({
      statuses: [{ json: { id: 'job-1', status: 'FAILED', error: 'GPU sem memória' } }],
    });
    const provider = new AceStepProvider({ baseUrl, ...fast });

    const error = await provider.generate(request()).catch((e) => e);

    expect(error.retryable).toBe(true);
  });

  it('não retenta com chave da RunPod recusada e aponta a variável certa', async () => {
    const { baseUrl } = await fakeRunPod({ run: () => ({ status: 401, json: { error: 'unauthorized' } }) });
    const provider = new AceStepProvider({ baseUrl, apiKey: 'errada', ...fast });

    const error = await provider.generate(request()).catch((e) => e);

    expect(error.retryable).toBe(false);
    expect(error.message).toContain('RUNPOD_API_KEY');
  });

  it('sobrevive a uma oscilação de rede no meio do polling', async () => {
    const { baseUrl } = await fakeRunPod({
      statuses: [{ status: 502, json: {} }, { json: { id: 'job-1', status: 'IN_PROGRESS' } }, COMPLETED],
    });
    const provider = new AceStepProvider({ baseUrl, ...fast });

    const result = await provider.generate(request());

    expect(result.providerRef).toBe('job-1');
  });

  it('recusa resultado gravado numa chave diferente da pedida', async () => {
    const wrongKey = structuredClone(COMPLETED);
    wrongKey.json.output.tracks[0].storage_key = 'outro/lugar.flac';
    const { baseUrl } = await fakeRunPod({ statuses: [wrongKey] });
    const provider = new AceStepProvider({ baseUrl, ...fast });

    const error = await provider.generate(request()).catch((e) => e);

    expect(error.retryable).toBe(false);
    expect(error.message).toContain('outro/lugar.flac');
  });
});

describe('buildJobInput', () => {
  it('transforma exclusão de voz em instrumental nativo, sem citar "vocals" no caption', () => {
    const input = buildJobInput(
      request({ controls: advancedControlsSchema.parse({ excludeStyles: 'vocals, rap, distortion' }) }),
    );

    expect(input.instrumental).toBe(true);
    expect(input.lyrics).toBe('');
    expect(input.caption).toContain('without rap, distortion');
    expect(String(input.caption)).not.toMatch(/vocal/i);
  });

  it('deixa a duração para o modelo decidir quando o usuário não escolhe', () => {
    expect(buildJobInput(request()).duration).toBeNull();
    expect(buildJobInput(request({ durationSeconds: 270 })).duration).toBe(270);
  });

  it('usa 30 s por padrão num clipe da aba Sounds', () => {
    const input = buildJobInput(request({ kind: 'clip', soundType: 'loop', lyrics: null, instrumental: true }));

    expect(input.duration).toBe(30);
    expect(input.caption).toContain('seamless loop');
  });

  it('mapeia replace_section para repaint em segundos', () => {
    const input = buildJobInput(
      request({ kind: 'replace_section', sourceAudioUrl: 'https://r2/src.flac', sectionStartMs: 30_000, sectionEndMs: 45_500 }),
    );

    expect(input).toMatchObject({ task_type: 'repaint', repainting_start: 30, repainting_end: 45.5 });
  });

  it('exige destino de upload: sem ele o áudio não teria para onde ir', () => {
    expect(() => buildJobInput(request({ uploadTarget: undefined }))).toThrow(/uploadTarget/);
  });
});
