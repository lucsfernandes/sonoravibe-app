import {
  CREDIT_COSTS,
  MusicProviderError,
  type GenerationKind,
  type MusicGenerationRequest,
  type MusicGenerationResult,
  type MusicProvider,
} from '@sonora/shared';
import { compilePrompt, compileSoundPrompt } from '../generation/prompt-compiler';

/**
 * Google Lyria 3 via OpenRouter.
 *
 * COMPORTAMENTO REAL DA API — confirmado por scripts/probe-lyria.mjs, não por
 * documentação. Cada item abaixo custou uma chamada real para ser descoberto:
 *
 *  1. Saída de áudio EXIGE `stream: true`. Sem isso: HTTP 400
 *     "Audio output requires stream: true".
 *  2. Saída de áudio EXIGE saldo >= $0.50 disponível na chave. Sem isso:
 *     HTTP 402. Abaixo desse piso TODA geração falha, não só a que estouraria.
 *  3. O áudio chega em `choices[0].delta.audio.data`, base64, normalmente num
 *     único chunk (um clipe de 30s veio inteiro num evento de ~957 KB).
 *  4. O parâmetro `audio.format` é IGNORADO. Pedimos 'wav' e recebemos MP3
 *     ~193 kbps 44.1 kHz estéreo. Por isso o formato é detectado pelos magic
 *     bytes, nunca assumido.
 *  5. O MP3 traz um manifesto C2PA assinado pelo Google (~6 KB de ID3) com a
 *     proveniência do conteúdo gerado por IA. Transcodificar remove esse
 *     manifesto — ver docs/ARQUITETURA.md sobre a decisão de preservá-lo.
 *  6. `delta.content` traz marcadores como "<instrumental>", não título.
 *
 * Latência observada: ~10s para clipe de 30s. Custo: $0.04 clipe / $0.08 música.
 */

interface LyriaConfig {
  apiKey: string;
  baseUrl: string;
  proModel: string;
  clipModel: string;
  siteUrl: string;
  appName: string;
  timeoutMs?: number;
}

const SUPPORTED: readonly GenerationKind[] = ['song', 'clip', 'extend', 'remix', 'cover'];

/** Marcadores que o modelo emite em `delta.content` e que não são título. */
const CONTENT_MARKERS = new Set(['<instrumental>', '<vocal>', '<music>']);

export class LyriaProvider implements MusicProvider {
  readonly id = 'lyria';
  readonly displayName = 'Google Lyria 3';
  readonly maxDurationSeconds = 180;
  readonly supportedKinds = SUPPORTED;

  private readonly timeoutMs: number;

  constructor(private readonly config: LyriaConfig) {
    if (!config.apiKey) {
      throw new Error('LyriaProvider exige OPENROUTER_API_KEY.');
    }
    this.timeoutMs = config.timeoutMs ?? 10 * 60 * 1000;
  }

  estimateCredits(req: MusicGenerationRequest): number {
    if (req.kind === 'clip') return CREDIT_COSTS.clip;
    if (req.kind === 'extend') return CREDIT_COSTS.extend;
    if (req.kind === 'remix' || req.kind === 'cover') return CREDIT_COSTS.remix;
    return CREDIT_COSTS.song;
  }

  async generate(req: MusicGenerationRequest): Promise<MusicGenerationResult> {
    const model = req.kind === 'clip' ? this.config.clipModel : this.config.proModel;
    const stream = await this.openStream(model, req);
    const collected = await this.consumeStream(stream, model);

    if (collected.audioChunks.length === 0) {
      throw new MusicProviderError(
        `O modelo ${model} encerrou o stream sem áudio ` +
          `(${collected.eventCount} eventos, finish_reason=${collected.finishReason}). ` +
          `Rode scripts/probe-lyria.mjs para inspecionar o stream.`,
        this.id,
        // Stream vazio costuma ser transitório do lado do provedor.
        true,
      );
    }

    const audio = assembleAudio(collected.audioChunks);
    const sourceFormat = detectAudioFormat(audio);

    if (!sourceFormat) {
      throw new MusicProviderError(
        `Áudio recebido de ${model} não tem assinatura de formato reconhecida ` +
          `(primeiros bytes: ${audio.subarray(0, 8).toString('hex')}).`,
        this.id,
        false,
      );
    }

    return {
      audio: { kind: 'buffer', data: audio },
      sourceFormat,
      // O provedor não informa duração; medimos com ffprobe depois do download.
      durationMs: 0,
      providerRef: collected.generationId,
      suggestedTitle: extractTitle(collected.text),
    };
  }

  /**
   * O Lyria não tem parâmetros de BPM, tom, gênero vocal nem exclusão: tudo vira
   * texto pelo Prompt Compiler. O ACE-Step, ao contrário, recebe isso nativo.
   */
  private buildContent(req: MusicGenerationRequest): string {
    const prompt =
      req.kind === 'clip'
        ? compileSoundPrompt({
            prompt: req.prompt,
            soundType: req.soundType ?? 'one-shot',
            bpm: req.controls.bpm,
            key: req.controls.key,
          })
        : compilePrompt({
            styles: req.prompt,
            excludeStyles: req.controls.excludeStyles,
            instrumental: req.instrumental,
            controls: req.controls,
            hasLyrics: Boolean(req.lyrics?.trim()),
          });
    const parts = [prompt];

    if (req.lyrics && !req.instrumental) {
      parts.push('', 'Lyrics to sing:', req.lyrics.trim());
    }

    if (req.durationSeconds && req.kind !== 'clip') {
      parts.push('', `Target duration: about ${formatDuration(req.durationSeconds)}.`);
    }

    return parts.join('\n');
  }

  private async openStream(
    model: string,
    req: MusicGenerationRequest,
  ): Promise<ReadableStream<Uint8Array>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'HTTP-Referer': this.config.siteUrl,
          'X-Title': this.config.appName,
        },
        body: JSON.stringify({
          model,
          stream: true,
          modalities: ['text', 'audio'],
          // Mantido por compatibilidade futura: hoje o Lyria ignora e devolve MP3.
          audio: { format: 'wav' },
          messages: [{ role: 'user', content: this.buildContent(req) }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new MusicProviderError(
        aborted
          ? `Tempo esgotado após ${this.timeoutMs / 1000}s aguardando ${model}.`
          : `Falha de rede ao chamar ${model}.`,
        this.id,
        true,
        err,
      );
    }

    if (!response.ok) {
      clearTimeout(timer);
      const text = await response.text().catch(() => '');
      throw new MusicProviderError(
        this.describeHttpError(response.status, text, model),
        this.id,
        isRetryableStatus(response.status),
      );
    }

    if (!response.body) {
      clearTimeout(timer);
      throw new MusicProviderError(
        `OpenRouter devolveu 200 sem corpo para ${model}.`,
        this.id,
        true,
      );
    }

    // O timer é limpo quando o stream termina de ser consumido.
    const body = response.body;
    return new ReadableStream({
      async start(ctrl) {
        const reader = body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            ctrl.enqueue(value);
          }
          ctrl.close();
        } catch (err) {
          ctrl.error(err);
        } finally {
          clearTimeout(timer);
          reader.releaseLock();
        }
      },
    });
  }

  /** Mensagens acionáveis para os erros que já vimos na prática. */
  private describeHttpError(status: number, body: string, model: string): string {
    if (status === 402) {
      return (
        `Saldo insuficiente na OpenRouter para gerar áudio com ${model}. ` +
        `A API exige pelo menos $0.50 disponíveis na chave. ` +
        `Ajuste o limite em https://openrouter.ai/settings/keys`
      );
    }
    if (status === 429) {
      return `Rate limit da OpenRouter atingido em ${model}.`;
    }
    return `OpenRouter respondeu ${status} para ${model}: ${body.slice(0, 500)}`;
  }

  /** Lê o SSE e junta os pedaços de áudio na ordem em que chegam. */
  private async consumeStream(
    stream: ReadableStream<Uint8Array>,
    model: string,
  ): Promise<CollectedStream> {
    const decoder = new TextDecoder();
    const audioChunks: string[] = [];
    let buffer = '';
    let text = '';
    let eventCount = 0;
    let finishReason: string | null = null;
    let generationId: string | undefined;

    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          for (const line of rawEvent.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;

            let event: any;
            try {
              event = JSON.parse(payload);
            } catch {
              // Evento parcial ou comentário de keep-alive: ignora.
              continue;
            }

            eventCount++;
            if (!generationId && typeof event.id === 'string') {
              generationId = event.id;
            }

            const choice = event.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta ?? choice.message;
            if (!delta) continue;

            if (typeof delta.content === 'string') text += delta.content;

            const data = delta.audio?.data;
            if (typeof data === 'string' && data.length > 0) {
              audioChunks.push(data);
            }
          }
        }
      }
    } catch (err) {
      throw new MusicProviderError(
        `Stream de ${model} interrompido após ${eventCount} eventos.`,
        this.id,
        true,
        err,
      );
    } finally {
      reader.releaseLock();
    }

    return { audioChunks, text, eventCount, finishReason, generationId };
  }
}

interface CollectedStream {
  audioChunks: string[];
  text: string;
  eventCount: number;
  finishReason: string | null;
  generationId?: string;
}

/**
 * Remonta o áudio a partir dos chunks base64.
 *
 * Os chunks podem ser fragmentos de um único base64 ou blocos independentes.
 * Padding '=' no meio da sequência denuncia o segundo caso — concatenar strings
 * ali produziria um arquivo corrompido.
 */
export function assembleAudio(chunks: string[]): Buffer {
  if (chunks.length === 1) return Buffer.from(chunks[0], 'base64');

  const independent = chunks.slice(0, -1).some((c) => c.includes('='));
  return independent
    ? Buffer.concat(chunks.map((c) => Buffer.from(c, 'base64')))
    : Buffer.from(chunks.join(''), 'base64');
}

/**
 * Detecta o formato pelos magic bytes.
 *
 * Necessário porque o Lyria ignora o `audio.format` pedido: confiar no que
 * pedimos gravaria um MP3 com extensão .wav e quebraria o player.
 */
export function detectAudioFormat(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  const ascii4 = buffer.subarray(0, 4).toString('ascii');

  if (ascii4 === 'ID3') return 'mp3';
  if (ascii4.startsWith('ID3')) return 'mp3';
  if (ascii4 === 'fLaC') return 'flac';
  if (ascii4 === 'OggS') return 'ogg';
  if (ascii4 === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'wav';
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a';

  // MPEG frame sync: 11 bits ligados.
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';

  return null;
}

/**
 * Tira um título de `delta.content`, se houver um ali.
 *
 * Esse canal é misto: o modelo manda pelo mesmo caminho o nome da faixa, os
 * marcadores de conteúdo (`<instrumental>`) e o mapa de seções da música —
 * blocos como `[[A0]] [[B1]] [[C2]]`, que dizem a estrutura, não o nome.
 *
 * A versão anterior aceitava qualquer texto com menos de 120 caracteres, e
 * músicas em produção nasciam chamadas "[[A0]] [[B1]] [[C2]] [[B3]] [[C4]]".
 *
 * Então a regra deixou de ser "não é um marcador conhecido" e passou a ser
 * "sobra alguma palavra depois de remover todos os marcadores". Um título de
 * verdade tem letras; um mapa de seções, não.
 */
export function extractTitle(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120) return undefined;
  if (CONTENT_MARKERS.has(trimmed.toLowerCase())) return undefined;

  // Remove [[A0]], [Verse], <instrumental> e o que mais vier nesse formato. O
  // `[[...]]` sai primeiro porque o padrão de colchete simples comeria só os
  // internos e deixaria os externos órfãos.
  const semMarcadores = trimmed
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // `\p{L}` e não `[a-z]`: "Coração" e "サクラ" são títulos válidos.
  if (!/\p{L}/u.test(semMarcadores)) return undefined;

  // Duas letras seguidas afastam restos como "A 0 B 1" de um marcador mal
  // formado, que passaria no teste acima por ter uma letra solta.
  if (!/\p{L}{2}/u.test(semMarcadores)) return undefined;

  return semMarcadores;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} seconds`;
  return s === 0 ? `${m} minutes` : `${m} minutes and ${s} seconds`;
}
