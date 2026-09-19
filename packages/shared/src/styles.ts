/**
 * Catálogo de estilos usado nas sugestões de tag da aba Advanced.
 * Não é uma lista fechada — o usuário pode escrever qualquer coisa.
 */

export interface StyleTag {
  readonly slug: string;
  readonly pt: string;
  readonly en: string;
}

export const GENRES: readonly StyleTag[] = [
  { slug: 'synthwave', pt: 'synthwave', en: 'synthwave' },
  { slug: 'lofi', pt: 'lo-fi', en: 'lo-fi' },
  { slug: 'pop', pt: 'pop', en: 'pop' },
  { slug: 'pop-punk', pt: 'pop punk', en: 'pop punk' },
  { slug: 'edm', pt: 'EDM', en: 'EDM' },
  { slug: 'house', pt: 'house', en: 'house' },
  { slug: 'techno', pt: 'techno', en: 'techno' },
  { slug: 'drum-and-bass', pt: 'drum and bass', en: 'drum and bass' },
  { slug: 'rock', pt: 'rock', en: 'rock' },
  { slug: 'indie-rock', pt: 'rock indie', en: 'indie rock' },
  { slug: 'metal', pt: 'metal', en: 'metal' },
  { slug: 'jazz', pt: 'jazz', en: 'jazz' },
  { slug: 'bossa-nova', pt: 'bossa nova', en: 'bossa nova' },
  { slug: 'samba', pt: 'samba', en: 'samba' },
  { slug: 'mpb', pt: 'MPB', en: 'Brazilian MPB' },
  { slug: 'forro', pt: 'forró', en: 'forro' },
  { slug: 'sertanejo', pt: 'sertanejo', en: 'sertanejo' },
  { slug: 'funk-carioca', pt: 'funk carioca', en: 'Brazilian funk' },
  { slug: 'pagode', pt: 'pagode', en: 'pagode' },
  { slug: 'hip-hop', pt: 'hip hop', en: 'hip hop' },
  { slug: 'trap', pt: 'trap', en: 'trap' },
  { slug: 'rnb', pt: 'R&B', en: 'R&B' },
  { slug: 'soul', pt: 'soul', en: 'soul' },
  { slug: 'funk', pt: 'funk', en: 'funk' },
  { slug: 'reggae', pt: 'reggae', en: 'reggae' },
  { slug: 'country', pt: 'country', en: 'country' },
  { slug: 'folk', pt: 'folk', en: 'folk' },
  { slug: 'classical', pt: 'clássico', en: 'classical' },
  { slug: 'chamber-pop', pt: 'chamber pop', en: 'chamber pop' },
  { slug: 'ambient', pt: 'ambient', en: 'ambient' },
  { slug: 'cinematic', pt: 'cinematográfico', en: 'cinematic' },
  { slug: 'gospel', pt: 'gospel', en: 'gospel' },
  { slug: 'worship', pt: 'louvor', en: 'worship' },
];

export const MOODS: readonly StyleTag[] = [
  { slug: 'melancholic', pt: 'melancólico', en: 'melancholic' },
  { slug: 'euphoric', pt: 'eufórico', en: 'euphoric' },
  { slug: 'calm', pt: 'calmo', en: 'calm' },
  { slug: 'dark', pt: 'sombrio', en: 'dark' },
  { slug: 'dreamy', pt: 'onírico', en: 'dreamy' },
  { slug: 'aggressive', pt: 'agressivo', en: 'aggressive' },
  { slug: 'nostalgic', pt: 'nostálgico', en: 'nostalgic' },
  { slug: 'romantic', pt: 'romântico', en: 'romantic' },
  { slug: 'epic', pt: 'épico', en: 'epic' },
  { slug: 'playful', pt: 'divertido', en: 'playful' },
  { slug: 'late-night', pt: 'madrugada', en: 'late night' },
  { slug: 'uplifting', pt: 'inspirador', en: 'uplifting' },
];

export const INSTRUMENTS: readonly StyleTag[] = [
  { slug: 'analog-synth', pt: 'synth analógico', en: 'analog synth' },
  { slug: 'rhodes', pt: 'Rhodes', en: 'Rhodes piano' },
  { slug: 'upright-piano', pt: 'piano de armário', en: 'upright piano' },
  { slug: 'acoustic-guitar', pt: 'violão', en: 'acoustic guitar' },
  { slug: 'electric-guitar', pt: 'guitarra', en: 'electric guitar' },
  { slug: 'sub-bass', pt: 'sub bass', en: 'deep sub bass' },
  { slug: 'brushed-drums', pt: 'bateria com vassourinha', en: 'brushed drums' },
  { slug: '808', pt: '808', en: '808 drums' },
  { slug: 'strings', pt: 'cordas', en: 'strings' },
  { slug: 'brass', pt: 'metais', en: 'brass section' },
  { slug: 'choir', pt: 'coral', en: 'choir' },
  { slug: 'cavaquinho', pt: 'cavaquinho', en: 'cavaquinho' },
  { slug: 'accordion', pt: 'sanfona', en: 'accordion' },
];

export const PRODUCTION: readonly StyleTag[] = [
  { slug: 'tape-saturation', pt: 'saturação de fita', en: 'tape saturation' },
  { slug: 'plate-reverb', pt: 'reverb de placa', en: 'spacious plate reverb' },
  { slug: 'sidechain', pt: 'sidechain', en: 'sidechain compression' },
  { slug: 'vinyl-crackle', pt: 'chiado de vinil', en: 'vinyl crackle' },
  { slug: 'wide-stereo', pt: 'estéreo amplo', en: 'wide stereo image' },
  { slug: 'dynamic-transitions', pt: 'transições dinâmicas', en: 'dynamic transitions' },
];

/** Elementos mais comuns em "Exclude Styles". */
export const COMMON_EXCLUSIONS: readonly StyleTag[] = [
  { slug: 'vocals', pt: 'vocais', en: 'vocals' },
  { slug: 'singing', pt: 'canto', en: 'singing' },
  { slug: 'spoken-word', pt: 'narração', en: 'spoken word' },
  { slug: 'choir', pt: 'coral', en: 'choir' },
  { slug: 'rap', pt: 'rap', en: 'rap' },
  { slug: 'aggressive-drums', pt: 'bateria agressiva', en: 'aggressive drums' },
  { slug: 'distortion', pt: 'distorção', en: 'distortion' },
  { slug: 'autotune', pt: 'autotune', en: 'autotune' },
];

export const ALL_STYLE_TAGS: readonly StyleTag[] = [
  ...GENRES,
  ...MOODS,
  ...INSTRUMENTS,
  ...PRODUCTION,
];

export function styleLabel(tag: StyleTag, locale: 'pt' | 'en'): string {
  return locale === 'pt' ? tag.pt : tag.en;
}
