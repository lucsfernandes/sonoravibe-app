/**
 * Formatos de áudio suportados para download.
 *
 * O master é guardado uma única vez e os demais formatos são transcodificados
 * sob demanda pelo worker e cacheados no R2.
 *
 * O MASTER DEPENDE DO MOTOR — medido, não suposto:
 *  - ACE-Step (principal): WAV float32 48 kHz nativo, guardado como FLAC 24-bit.
 *    Sem perdas de verdade: WAV e FLAC entregam a qualidade completa, e o MP3 é
 *    derivado dele.
 *  - Lyria (reserva): MP3 ~192 kbps 44.1 kHz, com manifesto C2PA do Google. O
 *    parâmetro `audio.format` é ignorado pela API. Aqui WAV/FLAC são LOSSLESS DE
 *    UM ÁUDIO LOSSY — não recuperam nada — e o MP3 servido é o próprio master,
 *    sem reencode, para preservar o C2PA.
 *
 * Por isso os args de FFmpeg e o texto mostrado na UI saem de `ffmpegArgsFor` e
 * `formatNote`, que consideram o formato do master de cada faixa.
 */

export const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'opus', 'm4a'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** Formato do master: FLAC (ACE-Step, sem perdas) ou MP3 (Lyria, reserva). */
export type MasterFormat = 'flac' | 'mp3';

export interface AudioFormatSpec {
  /** extensão do arquivo */
  readonly extension: AudioFormat;
  readonly mimeType: string;
  readonly label: string;
  /** true quando é gerado imediatamente após a música ficar pronta */
  readonly eager: boolean;
  /** argumentos do FFmpeg para produzir este formato a partir de um master sem perdas */
  readonly ffmpegArgs: readonly string[];
  /** estimativa de MB por minuto de áudio — usada para avisar o usuário no download em lote */
  readonly mbPerMinute: number;
  /** texto mostrado na UI quando o master é sem perdas (ACE-Step) */
  readonly note: string;
  /** texto mostrado quando o master é MP3 (Lyria) e o formato não ganha qualidade */
  readonly lossyMasterNote?: string;
}

export const AUDIO_FORMAT_SPECS: Record<AudioFormat, AudioFormatSpec> = {
  mp3: {
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    label: 'MP3 320 kbps',
    note: 'Melhor opção para ouvir e compartilhar.',
    lossyMasterNote:
      'O arquivo exato gerado pelo modelo, com a credencial C2PA do Google intacta.',
    eager: true,
    ffmpegArgs: ['-codec:a', 'libmp3lame', '-b:a', '320k'],
    mbPerMinute: 2.4,
  },
  wav: {
    extension: 'wav',
    mimeType: 'audio/wav',
    label: 'WAV 24-bit 48 kHz',
    note: 'Sem perdas. Exigido por DAWs, distribuidoras e editores de vídeo.',
    lossyMasterNote:
      'Convertido de um master MP3: exigido por DAWs e distribuidoras, mas não melhora a qualidade.',
    eager: false,
    ffmpegArgs: ['-codec:a', 'pcm_s24le', '-ar', '48000'],
    mbPerMinute: 17.3,
  },
  flac: {
    extension: 'flac',
    mimeType: 'audio/flac',
    label: 'FLAC 24-bit',
    note: 'Sem perdas e cerca de metade do tamanho do WAV.',
    lossyMasterNote:
      'Convertido de um master MP3: fica maior que o próprio WAV e não melhora a qualidade.',
    eager: false,
    ffmpegArgs: ['-codec:a', 'flac', '-compression_level', '8'],
    mbPerMinute: 10,
  },
  opus: {
    extension: 'opus',
    mimeType: 'audio/opus',
    label: 'Opus 192 kbps',
    note: 'Menor arquivo. Ideal para web e streaming.',
    eager: false,
    ffmpegArgs: ['-codec:a', 'libopus', '-b:a', '192k'],
    mbPerMinute: 1.4,
  },
  m4a: {
    extension: 'm4a',
    mimeType: 'audio/mp4',
    label: 'AAC 256 kbps',
    note: 'Compatibilidade com Apple e editores de vídeo.',
    eager: false,
    ffmpegArgs: ['-codec:a', 'aac', '-b:a', '256k'],
    mbPerMinute: 1.9,
  },
};

/**
 * Args do FFmpeg para produzir `format` a partir do master.
 * MP3 a partir de master MP3 é cópia: reencodar somaria perda de geração e
 * apagaria o manifesto C2PA do Google.
 */
export function ffmpegArgsFor(format: AudioFormat, master: MasterFormat): readonly string[] {
  if (format === 'mp3' && master === 'mp3') return ['-codec:a', 'copy'];
  return AUDIO_FORMAT_SPECS[format].ffmpegArgs;
}

/** Texto honesto para a UI: com master MP3, WAV/FLAC não ganham qualidade. */
export function formatNote(format: AudioFormat, master: MasterFormat): string {
  const spec = AUDIO_FORMAT_SPECS[format];
  return master === 'mp3' && spec.lossyMasterNote ? spec.lossyMasterNote : spec.note;
}

/**
 * Bitrate do MP3 por qualidade de plano.
 *
 * O Free recebe 128 kbps e os pagos 320. Como as duas versões podem coexistir
 * para a mesma música (alguém que assina depois de baixar no Free), o bitrate
 * faz parte da identidade da rendição, não é só um dado informativo.
 */
export const MP3_BITRATES = { preview: 128, full: 320 } as const;
export type Mp3Quality = keyof typeof MP3_BITRATES;

/**
 * Bitrate que identifica a rendição. `0` significa "não se aplica": formatos
 * sem perdas e os de bitrate fixo têm uma versão só.
 *
 * Zero em vez de null porque o índice único do Postgres trata NULLs como
 * distintos entre si — com null, a mesma rendição poderia ser gravada duas vezes.
 */
export function renditionBitrate(format: AudioFormat, quality: Mp3Quality = 'full'): number {
  return format === 'mp3' ? MP3_BITRATES[quality] : 0;
}

/**
 * Rótulo honesto do formato para o plano em questão.
 *
 * O rótulo fixo de AUDIO_FORMAT_SPECS.mp3 diz "320 kbps", que é falso para o
 * Free. Mostrar o número errado numa mensagem de bloqueio é pior do que não
 * mostrar número nenhum.
 */
export function formatLabel(format: AudioFormat, quality: Mp3Quality = 'full'): string {
  return format === 'mp3' ? `MP3 ${MP3_BITRATES[quality]} kbps` : AUDIO_FORMAT_SPECS[format].label;
}

/** Args do FFmpeg para o MP3 na qualidade do plano. */
export function mp3ArgsFor(quality: Mp3Quality): readonly string[] {
  return ['-codec:a', 'libmp3lame', '-b:a', `${MP3_BITRATES[quality]}k`];
}

/** Formatos gerados assim que a música fica pronta. */
export const EAGER_FORMATS = AUDIO_FORMATS.filter((f) => AUDIO_FORMAT_SPECS[f].eager);

/** Quantos dias um formato transcodificado sob demanda fica em cache no R2. */
export const RENDITION_CACHE_DAYS = 7;

export const STEM_KINDS = ['vocals', 'drums', 'bass', 'other'] as const;
export type StemKind = (typeof STEM_KINDS)[number];

export function estimateDownloadMb(format: AudioFormat, durationMs: number): number {
  const minutes = durationMs / 60_000;
  return Math.round(AUDIO_FORMAT_SPECS[format].mbPerMinute * minutes * 10) / 10;
}
