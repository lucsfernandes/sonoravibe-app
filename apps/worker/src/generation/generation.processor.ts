import {
  AUDIO_FORMAT_SPECS,
  DEFAULT_JOB_OPTIONS,
  EAGER_FORMATS,
  JOB_NAMES,
  PROGRESS_CHANNEL,
  STATUS_PROGRESS,
  ffmpegArgsFor,
  jobId,
  mp3ArgsFor,
  renditionBitrate,
  type TranscodeJob,
  type AudioFormat,
  type GenerationJob,
  type GenerationProgressMessage,
  type GenerationStatus,
  type MasterFormat,
  type MusicGenerationRequest,
  type AdvancedControls,
  type PlaylistInspiration,
  type UploadTarget,
  type WaveformJob,
} from '@sonora/shared';
import { CreditsLedger, Generation, Song } from '@sonora/db';
import { StorageService, storageKeys } from '@sonora/storage';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { In, type DataSource } from 'typeorm';
import type { MusicRouter } from '../providers/music-router';
import { durationOfBuffer } from '../audio/ffmpeg';
import { coverPromptFor, type CoverArtGenerator } from './cover-art';

/**
 * O que acontece com um job de geração, do início ao fim.
 *
 * Três garantias norteiam o código abaixo:
 *
 *  1. O usuário vê progresso. Cada etapa publica no canal do Redis que
 *     alimenta o SSE — uma geração de 3 minutos sem sinal nenhum é
 *     indistinguível de uma geração travada.
 *  2. Crédito reservado não fica preso. Sucesso confirma, falha estorna, e o
 *     estorno é idempotente para o retry do BullMQ não devolver duas vezes.
 *  3. Cancelamento é respeitado. Um job pode ter sido cancelado enquanto
 *     esperava na fila; conferimos antes de gastar dinheiro com o provedor.
 */

/** O ACE-Step entrega FLAC 24 bits; o Lyria só devolve MP3. */
const MASTER_BY_SOURCE: Record<string, MasterFormat> = { flac: 'flac', mp3: 'mp3' };

/**
 * Traduz o formato devolvido pelo motor para o formato do master.
 *
 * Sem `??` de conveniência: um formato desconhecido virando 'flac' por padrão
 * grava um arquivo com a extensão e o Content-Type errados, e o usuário só
 * descobre no download. Já aconteceu — um WAV foi parar no R2 como
 * `master.flac`. Falhar aqui aponta direto para o provider defeituoso.
 */
function masterFormatOf(sourceFormat: string, providerId: string): MasterFormat {
  const master = MASTER_BY_SOURCE[sourceFormat];
  if (!master) {
    throw new Error(
      `O motor '${providerId}' devolveu formato '${sourceFormat}', que não serve como master ` +
        `(esperado: ${Object.keys(MASTER_BY_SOURCE).join(' ou ')}).`,
    );
  }
  return master;
}

/**
 * Uma faixa do pedido: a primária ou uma variante. Cada uma é uma música na
 * biblioteca, com a própria Generation, mas todas nascem da mesma chamada ao motor.
 */
interface Alvo {
  generationId: string;
  songId: string;
}

interface Faixa extends Alvo {
  song: Song;
}

/** Uma faixa com o áudio já no R2, pronta para virar `complete`. */
interface Gravada {
  faixa: Faixa;
  master: MasterFormat;
  masterKey: string;
  durationMs: number;
  capa: { key: string | null };
}

export interface ProcessorDeps {
  dataSource: DataSource;
  storage: StorageService;
  redis: Redis;
  router: MusicRouter;
  credits: CreditsLedger;
  /** Fila de conversão, para já deixar o MP3 pronto quando a música nasce. */
  transcodeQueue: Queue;
  coverArt: CoverArtGenerator;
  /** Usado para medir a duração quando o provedor não informa. Ver `resolveDuration`. */
  ffmpegPath: string;
  logger?: { log(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

export class GenerationProcessor {
  private readonly logger: NonNullable<ProcessorDeps['logger']>;

  /**
   * Em que etapa cada geração deste processo está. A capa, que roda em
   * paralelo, consulta aqui ao terminar: se a música ainda está gerando, o
   * evento dela sai com o status atual; se já acabou, sai como conclusão.
   */
  private readonly andamento = new Map<string, GenerationStatus>();

  constructor(private readonly deps: ProcessorDeps) {
    this.logger = deps.logger ?? console;
  }

  async process(job: GenerationJob): Promise<void> {
    const { generationId, songId, userId } = job;

    const { generation, song } = await this.load(generationId, songId);

    // Cancelado enquanto esperava na fila: não chamamos o provedor. O estorno
    // já foi feito por quem cancelou.
    if (generation.status === 'canceled') {
      this.logger.log(`Geração ${generationId} cancelada antes de rodar; nada a fazer.`);
      return;
    }

    // O BullMQ devolve um job que considerou travado — um worker reiniciado
    // enquanto a capa terminava, por exemplo. A música já existe e já foi
    // cobrada; rodar de novo geraria outra e cobraria outra vez.
    if (generation.status === 'complete') {
      this.logger.log(`Geração ${generationId} já concluída; nada a fazer.`);
      return;
    }

    // A capa pedida à parte é um job próprio e não passa pelo motor de música.
    if (job.kind === 'cover') {
      await this.processCover(job, song);
      return;
    }

    // A primária e as variantes que ainda valem. Todas saem da mesma chamada ao
    // motor, então andam juntas: mesmas etapas, mesmo desfecho.
    const faixas = await this.faixasDoPedido(job, song);

    await this.transition(job, faixas, 'compiling_prompt');

    // A capa parte junto com a música, não depois dela. É uma chamada ao
    // modelo de imagem que costuma levar menos que o motor de áudio, então
    // quase sempre está pronta quando a música termina e já entra no evento
    // de conclusão; se demorar mais, publica o próprio evento ao sair. Não
    // custa crédito (é o mesmo pedido) e nunca rejeita. Cada faixa tem a sua:
    // são músicas distintas na biblioteca.
    const capas = faixas.map((faixa) => {
      const capa = { key: null as string | null };
      const terminou = this.gerarCapa(userId, faixa, coverPromptFor(faixa.song)).then((key) => {
        capa.key = key;
      });
      return { capa, terminou };
    });

    try {
      const request = await this.buildRequest(song, job);

      // O destino no R2 é assinado antes de chamar o motor: o worker de GPU
      // roda fora do cluster e sobe o master direto, sem passar o arquivo por
      // aqui (um FLAC de 4 min estoura o limite de resposta da RunPod). Um
      // destino por faixa, na ordem em que o motor devolve.
      const destinos = await Promise.all(
        faixas.map(async (faixa): Promise<UploadTarget> => {
          const storageKey = storageKeys.master(faixa.songId, 'flac');
          const contentType = AUDIO_FORMAT_SPECS.flac.mimeType;
          return { url: await this.deps.storage.presignPut(storageKey, contentType), storageKey, contentType };
        }),
      );
      request.uploadTarget = destinos[0];
      if (destinos.length > 1) request.variantUploadTargets = destinos.slice(1);

      await this.transition(job, faixas, 'generating_audio');
      const result = await this.deps.router.generate(request);

      await this.transition(job, faixas, 'uploading');

      // O que o motor entregou, na ordem das faixas. O Lyria (reserva) só
      // entrega uma: as variantes sem áudio são descartadas mais abaixo, em vez
      // de ficarem na biblioteca como falha de algo que o usuário não errou.
      const entregas = [
        { audio: result.audio, sourceFormat: result.sourceFormat, durationMs: result.durationMs },
        ...(result.variants ?? []),
      ];
      const prontas = faixas.slice(0, entregas.length);
      const descartadas = faixas.slice(entregas.length);

      const gravadas: Gravada[] = [];
      for (const [indice, faixa] of prontas.entries()) {
        const entrega = entregas[indice]!;
        const master = masterFormatOf(entrega.sourceFormat, result.servedBy);
        const masterKey = await this.storeAudio(faixa.songId, master, entrega.audio);
        const durationMs = await this.resolveDuration(entrega, master);
        gravadas.push({ faixa, master, masterKey, durationMs, capa: capas[indice]!.capa });
      }

      // O título do modelo só entra se o usuário não tiver escolhido um. Quem
      // digitou o nome da música espera vê-lo de volta — e o que o Lyria manda
      // nem sempre é um nome: já chegou a ser o mapa de seções da faixa.
      const titulo =
        job.titleFromUser || !result.suggestedTitle
          ? undefined
          : result.suggestedTitle.slice(0, 160);

      await this.deps.dataSource.transaction(async (em) => {
        for (const { faixa, masterKey, durationMs } of gravadas) {
          await em.getRepository(Song).update(
            { id: faixa.songId },
            {
              status: 'complete',
              masterKey,
              durationMs,
              providerId: result.servedBy,
              compiledPrompt: request.prompt,
              ...(titulo ? { title: titulo } : {}),
            },
          );
          await em.getRepository(Generation).update(
            { id: faixa.generationId },
            {
              status: 'complete',
              providerId: result.servedBy,
              providerRef: result.providerRef ?? null,
              compiledPrompt: request.prompt,
              finishedAt: new Date(),
            },
          );
        }

        if (descartadas.length > 0) {
          await em.getRepository(Generation).update(
            { id: In(descartadas.map((f) => f.generationId)) },
            { status: 'canceled', finishedAt: new Date() },
          );
          // Status e lixeira: a música some da biblioteca sem apagar o registro,
          // e quem investigar vê que nasceu e não teve áudio.
          await em.getRepository(Song).update(
            { id: In(descartadas.map((f) => f.songId)) },
            { status: 'canceled' },
          );
          await em.getRepository(Song).softDelete({ id: In(descartadas.map((f) => f.songId)) });
        }
      });
      for (const { faixa } of gravadas) this.andamento.set(faixa.generationId, 'complete');
      for (const faixa of descartadas) this.andamento.set(faixa.generationId, 'canceled');

      // Só agora o crédito sai da reserva: até aqui, qualquer falha estornava.
      // Uma vez por pedido, e não por faixa: o preço é do pedido.
      await this.deps.credits.commit(userId, job.reservedCredits);

      for (const { faixa, master, masterKey, durationMs, capa } of gravadas) {
        await this.enqueueEagerFormats(faixa.songId, userId, master);
        await this.enqueueWaveform(faixa.songId);

        await this.publish({
          userId,
          generationId: faixa.generationId,
          songId: faixa.songId,
          status: 'complete',
          progress: STATUS_PROGRESS.complete,
          song: {
            id: faixa.songId,
            title: titulo ?? faixa.song.title,
            durationMs,
            audioUrl: await this.deps.storage.presignGet(masterKey),
            // Quase sempre já desenhada. Se não, o evento dela vem em seguida.
            coverUrl: capa.key ? await this.deps.storage.presignGet(capa.key) : null,
          },
        });
      }

      for (const faixa of descartadas) {
        await this.publish({
          userId,
          generationId: faixa.generationId,
          songId: faixa.songId,
          status: 'canceled',
          progress: STATUS_PROGRESS.canceled,
        });
      }
      if (descartadas.length > 0) {
        this.logger.warn(
          `Geração ${generationId}: ${result.servedBy} entregou ${prontas.length} de ` +
            `${faixas.length} faixas; a(s) sem áudio foram descartadas.`,
        );
      }

      const viaReserva = result.fallbackReason ? ` (reserva: ${result.fallbackReason})` : '';
      const segundos = gravadas.map((g) => `${Math.round(g.durationMs / 1000)}s`).join(' + ');
      this.logger.log(
        `Geração ${generationId} concluída por ${result.servedBy}: ` +
          `${segundos} de áudio${viaReserva}`,
      );
    } catch (err) {
      await this.fail(job, faixas, err);
      throw err; // devolve ao BullMQ para ele decidir sobre o retry
    } finally {
      // O job só é dado como terminado quando as capas também terminaram (ou
      // desistiram): uma chamada pendente num worker "ocioso" se perderia num
      // desligamento. Nunca rejeita, então não muda o resultado acima.
      await Promise.all(capas.map((c) => c.terminou));
      for (const faixa of faixas) this.andamento.delete(faixa.generationId);
    }
  }

  /**
   * A primária e as variantes do pedido, prontas para gerar.
   *
   * Uma variante cancelada (ou apagada) enquanto esperava na fila fica de fora:
   * o motor gera só o que ainda tem dono, e o destino de upload dela nem é
   * assinado.
   */
  private async faixasDoPedido(job: GenerationJob, song: Song): Promise<Faixa[]> {
    const faixas: Faixa[] = [{ generationId: job.generationId, songId: job.songId, song }];

    for (const variante of job.variants ?? []) {
      const [generation, songDaVariante] = await Promise.all([
        this.deps.dataSource.getRepository(Generation).findOneBy({ id: variante.generationId }),
        this.deps.dataSource.getRepository(Song).findOneBy({ id: variante.songId }),
      ]);
      if (!generation || !songDaVariante || generation.status === 'canceled') continue;
      faixas.push({ generationId: variante.generationId, songId: variante.songId, song: songDaVariante });
    }
    return faixas;
  }

  /**
   * Já deixa o MP3 pronto, sem esperar alguém clicar em baixar.
   *
   * É o formato que a maioria baixa e o único do plano Free: convertê-lo agora
   * troca uma espera visível (usuário parado na tela de download) por trabalho
   * de fundo. Os demais formatos continuam sob demanda, porque guardar os cinco
   * de toda música multiplicaria o armazenamento à toa.
   *
   * Falha aqui não derruba a geração: a música está pronta e a API reconverte
   * quando alguém pedir.
   */
  private async enqueueEagerFormats(
    songId: string,
    userId: string,
    master: MasterFormat,
  ): Promise<void> {
    for (const format of EAGER_FORMATS) {
      // O master já É o formato: não há o que converter.
      if (format === master) continue;

      const bitrate = renditionBitrate(format, 'full');
      const eager: TranscodeJob = {
        songId,
        userId,
        format,
        bitrate,
        ffmpegArgs: format === 'mp3' ? mp3ArgsFor('full') : ffmpegArgsFor(format, master),
      };

      await this.deps.transcodeQueue
        .add('transcode', eager, {
          ...DEFAULT_JOB_OPTIONS,
          jobId: jobId(songId, format, bitrate),
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Não enfileirei o ${format} de ${songId}: ${(err as Error).message}`,
          );
        });
    }
  }

  /**
   * A forma de onda sai num job próprio, e não aqui, porque o master do
   * ACE-Step nunca passa por este processo (sobe direto no R2) e baixá-lo
   * agora atrasaria o evento de conclusão que o usuário está esperando.
   */
  private async enqueueWaveform(songId: string): Promise<void> {
    const job: WaveformJob = { songId };
    await this.deps.transcodeQueue
      .add(JOB_NAMES.waveform, job, {
        ...DEFAULT_JOB_OPTIONS,
        jobId: jobId(songId, 'waveform'),
        attempts: 1,
      })
      .catch((err: unknown) => {
        this.logger.warn(`Não enfileirei a onda de ${songId}: ${(err as Error).message}`);
      });
  }

  private async load(
    generationId: string,
    songId: string,
  ): Promise<{ generation: Generation; song: Song }> {
    const [generation, song] = await Promise.all([
      this.deps.dataSource.getRepository(Generation).findOneBy({ id: generationId }),
      this.deps.dataSource.getRepository(Song).findOneBy({ id: songId }),
    ]);
    if (!generation) throw new Error(`Geração ${generationId} não existe.`);
    if (!song) throw new Error(`Música ${songId} não existe.`);
    return { generation, song };
  }

  /**
   * Capa pedida à parte, para uma música já pronta. Custa crédito e grava na
   * própria música — não nasce faixa nova.
   *
   * Só a geração muda de status. A música continua `complete`, tocável e
   * editável enquanto a capa é desenhada: foi gravar `generating_cover` nela
   * que deixou faixas presas em "Carregando…" para sempre, porque nada
   * devolvia o status depois. Pelo mesmo motivo, falhar aqui estorna o crédito
   * da capa e não toca no áudio.
   */
  private async processCover(job: GenerationJob, song: Song): Promise<void> {
    await this.deps.dataSource
      .getRepository(Generation)
      .update({ id: job.generationId }, { status: 'generating_cover', startedAt: new Date() });
    await this.publish({
      userId: job.userId,
      generationId: job.generationId,
      songId: song.id,
      status: 'generating_cover',
      progress: STATUS_PROGRESS.generating_cover,
    });

    try {
      if (!this.deps.coverArt.available) {
        throw new Error('Geração de capa indisponível: OPENROUTER_API_KEY não configurada.');
      }

      const resultado = await this.deps.coverArt.generate(job.coverPrompt ?? coverPromptFor(song));
      if (!resultado) throw new Error('O modelo de imagem não devolveu nenhuma capa.');

      const key = storageKeys.cover(song.id);
      await this.deps.storage.putObject(key, resultado.data, resultado.mimeType);

      await this.deps.dataSource.transaction(async (em) => {
        await em.getRepository(Song).update({ id: song.id }, { coverKey: key });
        await em.getRepository(Generation).update(
          { id: job.generationId },
          { status: 'complete', providerId: 'openrouter-image', finishedAt: new Date() },
        );
      });

      await this.deps.credits.commit(job.userId, job.reservedCredits);

      await this.publish({
        userId: job.userId,
        generationId: job.generationId,
        songId: song.id,
        status: 'complete',
        progress: STATUS_PROGRESS.complete,
        song: {
          id: song.id,
          title: song.title,
          durationMs: song.durationMs,
          audioUrl: song.masterKey ? await this.deps.storage.presignGet(song.masterKey) : '',
          coverUrl: await this.deps.storage.presignGet(key),
        },
      });

      this.logger.log(`Capa nova de ${song.id} pronta.`);
    } catch (err) {
      await this.fail(job, [{ generationId: job.generationId, songId: song.id }], err, {
        mexeNaMusica: false,
      });
      throw err;
    }
  }

  /** Traduz a música gravada no banco para o pedido que o motor entende. */
  private async buildRequest(song: Song, job: GenerationJob): Promise<MusicGenerationRequest> {
    const controls = (song.params ?? {}) as Partial<AdvancedControls> & {
      sectionStartMs?: number;
      sectionEndMs?: number;
      addSeconds?: number;
      inspiration?: PlaylistInspiration;
    };

    // A inspiração da playlist entra no fim do estilo, depois do que o
    // usuário escreveu: o modelo pesa mais o começo, e o pedido explícito
    // tem que vencer a referência.
    const estiloBase = song.stylePrompt ?? song.title;
    const styles = withInspiration(estiloBase, controls.inspiration);

    // Derivadas precisam ouvir a faixa original. A URL é assinada e curta: o
    // motor roda fora do cluster e não tem credencial do nosso bucket.
    let sourceAudioUrl: string | undefined;
    if (job.sourceSongId) {
      const origem = await this.deps.dataSource
        .getRepository(Song)
        .findOneBy({ id: job.sourceSongId });
      if (!origem?.masterKey) {
        throw new Error(`A faixa de origem ${job.sourceSongId} não tem áudio.`);
      }
      sourceAudioUrl = await this.deps.storage.presignGet(origem.masterKey, 3600);
    }

    return {
      ...(sourceAudioUrl ? { sourceAudioUrl } : {}),
      ...(controls.sectionStartMs !== undefined
        ? { sectionStartMs: controls.sectionStartMs, sectionEndMs: controls.sectionEndMs }
        : {}),
      kind: song.kind,
      prompt: styles,
      lyrics: song.instrumental ? null : song.lyrics,
      instrumental: song.instrumental,
      durationSeconds: controls.durationSeconds,
      controls: {
        styles,
        excludeStyles: song.excludeStyles ?? undefined,
        vocalGender: controls.vocalGender ?? 'any',
        maxMode: controls.maxMode ?? false,
        weirdness: controls.weirdness ?? 50,
        styleInfluence: controls.styleInfluence ?? 50,
        variety: controls.variety ?? 'high',
        personalize: controls.personalize ?? false,
        bpm: controls.bpm,
        key: controls.key ?? 'any',
        durationSeconds: controls.durationSeconds,
      },
    };
  }

  /**
   * Desenha a capa que nasce junto com a música.
   *
   * Não cobra crédito: é parte do mesmo pedido. Cobrar duas vezes por um
   * clique é o tipo de surpresa que faz o usuário desconfiar da fatura.
   *
   * Nada aqui pode derrubar a geração: uma falha no modelo de imagem custa uma
   * capa, e o card cai no gradiente com a inicial do título. Por isso o
   * try/catch engole tudo e só registra, e a promessa devolve a chave da capa
   * (ou null) em vez de rejeitar.
   *
   * O evento publicado sai com o status em que a música está: se ainda gera,
   * o card troca o gradiente pela capa por baixo da barra de progresso; se já
   * terminou, é o segundo evento de conclusão, agora com a arte.
   */
  private async gerarCapa(userId: string, faixa: Faixa, prompt: string): Promise<string | null> {
    if (!this.deps.coverArt.available) return null;
    const { song } = faixa;

    try {
      const resultado = await this.deps.coverArt.generate(prompt);
      if (!resultado) return null;

      const status = this.andamento.get(faixa.generationId) ?? 'complete';
      // A música falhou (ou foi cancelada) enquanto a capa era desenhada: não
      // há o que ilustrar, e um evento agora reabriria o card na interface.
      if (status === 'failed' || status === 'canceled') return null;

      const key = storageKeys.cover(song.id);
      await this.deps.storage.putObject(key, resultado.data, resultado.mimeType);
      await this.deps.dataSource.getRepository(Song).update({ id: song.id }, { coverKey: key });

      await this.publish({
        userId,
        generationId: faixa.generationId,
        songId: song.id,
        status,
        progress: STATUS_PROGRESS[status],
        song: {
          id: song.id,
          title: song.title,
          durationMs: song.durationMs,
          audioUrl: '',
          coverUrl: await this.deps.storage.presignGet(key),
        },
      });

      this.logger.log(`Capa de ${song.id} pronta.`);
      return key;
    } catch (err) {
      this.logger.warn(`Não desenhei a capa de ${song.id}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Duração real da música, em milissegundos.
   *
   * O Lyria não informa duração nenhuma e devolve 0. Aceitar esse 0 deixa a
   * música com "0:00" na tela e todo download estimado em "~0 MB" — foi
   * exatamente o que aconteceu com a primeira música gerada em produção, cujo
   * arquivo tinha 180s e 2,8 MB de verdade. Quando o provedor não diz, medimos.
   *
   * Só dá para medir o que passou por aqui: quando o motor de GPU sobe o master
   * direto para o R2, o buffer nunca chega ao worker. Esse caminho é o
   * ACE-Step, que informa `duration_ms` corretamente, então não há perda.
   *
   * Duração é informativa, nunca motivo para perder a música: se o ffprobe
   * falhar, `durationOfBuffer` devolve 0 e a geração continua valendo.
   */
  private async resolveDuration(
    result: {
      durationMs: number;
      audio: { kind: 'buffer'; data: Buffer } | { kind: 'stored'; storageKey: string };
    },
    master: MasterFormat,
  ): Promise<number> {
    if (result.durationMs > 0) return result.durationMs;
    if (result.audio.kind !== 'buffer') return 0;

    const medido = await durationOfBuffer(result.audio.data, master, this.deps.ffmpegPath);
    if (medido === 0) {
      this.logger.warn(
        'O provedor não informou a duração e o ffprobe não conseguiu medir; ' +
          'a música fica com 0:00 na interface.',
      );
    }
    return medido;
  }

  /**
   * O áudio ou já está no R2 (o motor de GPU subiu direto) ou veio em memória
   * e precisa ser gravado aqui.
   */
  private async storeAudio(
    songId: string,
    master: MasterFormat,
    audio: { kind: 'buffer'; data: Buffer } | { kind: 'stored'; storageKey: string },
  ): Promise<string> {
    if (audio.kind === 'stored') {
      const stat = await this.deps.storage.statObject(audio.storageKey);
      if (!stat || stat.size === 0) {
        throw new Error(
          `O motor disse ter gravado ${audio.storageKey}, mas o objeto não está lá.`,
        );
      }
      return audio.storageKey;
    }

    const key = storageKeys.master(songId, master);
    await this.deps.storage.putObject(
      key,
      audio.data,
      AUDIO_FORMAT_SPECS[master as AudioFormat].mimeType,
    );
    return key;
  }

  /** Grava o status de todas as faixas e avisa o navegador, nessa ordem. */
  private async transition(
    job: GenerationJob,
    faixas: Alvo[],
    status: GenerationStatus,
  ): Promise<void> {
    await this.deps.dataSource.getRepository(Generation).update(
      { id: In(faixas.map((f) => f.generationId)) },
      { status, ...(status === 'compiling_prompt' ? { startedAt: new Date() } : {}) },
    );
    await this.deps.dataSource
      .getRepository(Song)
      .update({ id: In(faixas.map((f) => f.songId)) }, { status });

    for (const faixa of faixas) {
      this.andamento.set(faixa.generationId, status);
      await this.publish({
        userId: job.userId,
        generationId: faixa.generationId,
        songId: faixa.songId,
        status,
        progress: STATUS_PROGRESS[status],
      });
    }
  }

  /**
   * Marca as gerações como falhas, estorna e avisa.
   *
   * Todas as faixas do pedido falham juntas: vieram de uma chamada só. O
   * crédito está na primária (a primeira de `faixas`), e é dela o estorno.
   *
   * `mexeNaMusica: false` é para a capa pedida à parte: a música já estava
   * pronta antes do pedido e continua pronta depois dele.
   */
  private async fail(
    job: GenerationJob,
    faixas: Alvo[],
    err: unknown,
    { mexeNaMusica = true }: { mexeNaMusica?: boolean } = {},
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    if (mexeNaMusica) {
      for (const faixa of faixas) this.andamento.set(faixa.generationId, 'failed');
    }

    await this.deps.dataSource.transaction(async (em) => {
      await em.getRepository(Generation).update(
        { id: In(faixas.map((f) => f.generationId)) },
        { status: 'failed', errorMessage: message, finishedAt: new Date() },
      );
      if (mexeNaMusica) {
        await em
          .getRepository(Song)
          .update({ id: In(faixas.map((f) => f.songId)) }, { status: 'failed' });
      }
    });

    // Estorno idempotente: se o BullMQ tentar de novo e falhar de novo, o
    // crédito volta uma vez só.
    const { refunded } = await this.deps.credits
      .refund(job.generationId)
      .catch((refundErr: unknown) => {
        this.logger.error(
          `Falhei ao estornar ${job.generationId}: ${(refundErr as Error).message}`,
        );
        return { refunded: 0 };
      });

    for (const faixa of faixas) {
      await this.publish({
        userId: job.userId,
        generationId: faixa.generationId,
        songId: faixa.songId,
        status: 'failed',
        progress: STATUS_PROGRESS.failed,
        error: message,
      });
    }

    this.logger.error(
      `Geração ${job.generationId} falhou (${refunded} créditos estornados): ${message}`,
    );
  }

  private async publish(message: GenerationProgressMessage): Promise<void> {
    await this.deps.redis.publish(PROGRESS_CHANNEL, JSON.stringify(message));
  }
}

/**
 * Acrescenta os estilos da playlist de inspiração ao estilo pedido.
 *
 * Exportada para teste. Curta de propósito: o caption do ACE-Step tem 512
 * caracteres, e o compilador corta pelo fim, então a inspiração é o que
 * some primeiro se não couber, e nunca o que o usuário escreveu.
 */
export function withInspiration(styles: string, inspiration?: PlaylistInspiration): string {
  const lista = inspiration?.styles?.filter(Boolean) ?? [];
  if (lista.length === 0) return styles;
  return `${styles.trim().replace(/[.\s]+$/, '')}, inspired by ${lista.join('; ')}`;
}
