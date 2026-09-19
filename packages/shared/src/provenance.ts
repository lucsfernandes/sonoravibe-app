import type { AudioFormat } from './audio';

/**
 * Proveniência de conteúdo gerado por IA.
 *
 * POR QUE ISSO EXISTE
 * O MP3 que o Lyria 3 devolve carrega um manifesto C2PA assinado pelo Google
 * (~6 KB de ID3, emitido por "Google C2PA Media Services"). É a prova
 * criptográfica de que o áudio foi gerado por IA — cada vez mais exigida por
 * plataformas e por regulação.
 *
 * O problema: transcodificar com FFmpeg REMOVE esse manifesto. Um WAV ou FLAC
 * gerado a partir do master sai sem nenhuma credencial.
 *
 * ESTRATÉGIA EM DUAS CAMADAS
 *  1. O MP3 original, com o C2PA intacto, é preservado no R2 e oferecido como
 *     download canônico. Ele nunca é regerado nem reescrito.
 *  2. Todo formato convertido recebe metadados de proveniência nossos —
 *     não são C2PA assinado, mas mantêm rastreabilidade legível por humanos e
 *     por ferramentas, e declaram que a credencial original está no MP3.
 *
 * Limite honesto: metadado comum é removível com um comando e não é assinado.
 * Ele documenta a origem, não a prova. Por isso a camada 1 importa.
 */

export const PROVENANCE = {
  /** Nome que aparece como codificador nos metadados. */
  encodedBy: 'Sonora',
  /** Modelo que efetivamente gerou o áudio. */
  generator: 'Google Lyria 3',
  /** Aviso curto, cabe nos campos de comentário de todos os formatos. */
  aiDisclosure:
    'Audio gerado por inteligencia artificial (Google Lyria 3) via Sonora.',
  /** Explica onde está a credencial assinada. */
  c2paNotice:
    'O arquivo MP3 original desta faixa contem um manifesto C2PA assinado pelo Google. Esta versao foi convertida e nao carrega a credencial assinada.',
} as const;

export interface ProvenanceInput {
  title: string;
  /** Handle ou nome de exibição do criador. */
  artist: string;
  /** ISO date de quando a faixa foi gerada. */
  generatedAt: Date;
  /** ID da faixa no Sonora, para rastrear até o registro. */
  songId: string;
  /** Prompt compilado, truncado. Útil para auditoria. */
  prompt?: string;
}

/**
 * Metadados gravados em formatos convertidos.
 *
 * Os campos escolhidos são os que sobrevivem em ID3 (MP3), Vorbis comments
 * (FLAC/Opus), INFO chunk (WAV) e atoms (M4A). Campos exóticos são descartados
 * silenciosamente por alguns contêineres, então ficamos no denominador comum.
 */
export function buildProvenanceTags(
  input: ProvenanceInput,
  isConverted: boolean,
): Record<string, string> {
  const tags: Record<string, string> = {
    title: input.title,
    artist: input.artist,
    album: 'Sonora',
    date: input.generatedAt.toISOString().slice(0, 10),
    encoded_by: PROVENANCE.encodedBy,
    comment: isConverted
      ? `${PROVENANCE.aiDisclosure} ${PROVENANCE.c2paNotice}`
      : PROVENANCE.aiDisclosure,
  };

  // Campo livre com o identificador — permite rastrear de volta ao registro.
  tags.TXXX_sonora_song_id = input.songId;

  if (input.prompt) {
    tags.description = truncate(input.prompt, 500);
  }

  return tags;
}

/**
 * Converte os metadados em argumentos do FFmpeg.
 *
 * `-map_metadata 0` preserva o que o contêiner de origem tiver antes de
 * sobrescrevermos os nossos campos. Não recupera o C2PA (que vive num frame
 * GEOB específico do ID3 e é descartado na reencodificação), mas mantém o resto.
 */
export function provenanceFfmpegArgs(
  input: ProvenanceInput,
  format: AudioFormat,
): string[] {
  const isConverted = format !== 'mp3';
  const tags = buildProvenanceTags(input, isConverted);

  const args = ['-map_metadata', '0'];
  for (const [key, value] of Object.entries(tags)) {
    args.push('-metadata', `${key}=${sanitize(value)}`);
  }
  return args;
}

/** Quebra de linha e '=' confundem o parser de metadados do FFmpeg. */
function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/=/g, '-').trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

/**
 * Verifica se um buffer MP3 ainda contém o manifesto C2PA.
 * Usado num teste de regressão: se um dia mudarmos o pipeline e o master passar
 * a ser reencodado por engano, este check falha e avisa.
 */
export function hasC2paManifest(buffer: Buffer): boolean {
  if (buffer.subarray(0, 3).toString('ascii') !== 'ID3') return false;
  // O manifesto vive num frame GEOB cujo mime é 'application/c2pa'.
  const header = buffer.subarray(0, Math.min(buffer.length, 16_384)).toString('latin1');
  return header.includes('application/c2pa');
}
