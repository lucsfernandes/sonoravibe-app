import { Song } from '@sonora/db';
import { WAVEFORM_POINTS, type WaveformJob } from '@sonora/shared';
import { StorageService } from '@sonora/storage';
import type { DataSource } from 'typeorm';
import { peaksOfBuffer } from '../audio/ffmpeg';

/**
 * Calcula e grava a forma de onda de uma faixa que já tem master.
 *
 * Roda depois de toda geração e edição, e também como backfill: as faixas de
 * antes da coluna `waveform` só ganham a onda quando alguém as vê no modo
 * onda e a interface pede. Baixa o master do R2 (dentro do cluster, sem custo
 * de saída) e deixa o FFmpeg reduzir a 120 picos.
 *
 * Não custa crédito e não muda o status da música: é só um desenho. Por isso
 * uma falha aqui é registrada e engolida, sem estorno nem evento de erro.
 */
export class WaveformProcessor {
  constructor(
    private readonly deps: {
      dataSource: DataSource;
      storage: StorageService;
      ffmpegPath: string;
      logger?: { log(msg: string): void; warn(msg: string): void };
    },
  ) {}

  private get logger() {
    return this.deps.logger ?? console;
  }

  async process(job: WaveformJob): Promise<void> {
    const repo = this.deps.dataSource.getRepository(Song);
    const song = await repo.findOneBy({ id: job.songId });
    if (!song?.masterKey) {
      this.logger.warn(`Onda de ${job.songId}: a faixa não tem master.`);
      return;
    }
    if (song.waveform) return;

    const master = await this.deps.storage.getObject(song.masterKey);
    const extension = song.masterKey.split('.').pop() ?? 'flac';
    const waveform = await peaksOfBuffer(master, extension, this.deps.ffmpegPath, WAVEFORM_POINTS);
    if (!waveform) {
      this.logger.warn(`Onda de ${job.songId}: o FFmpeg não conseguiu ler o master.`);
      return;
    }

    await repo.update({ id: song.id }, { waveform });
    this.logger.log(`Onda de ${song.id} pronta (${waveform.length} pontos).`);
  }
}
