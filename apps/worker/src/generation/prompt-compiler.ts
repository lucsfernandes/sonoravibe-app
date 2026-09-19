import type { AdvancedControls, VocalGender } from '@sonora/shared';

/**
 * Traduz os controles da UI para o prompt em linguagem natural que o Lyria entende.
 *
 * CONTEXTO IMPORTANTE
 * O Lyria 3 não expõe parâmetros de exclude_styles, vocal gender, BPM, key,
 * weirdness, style influence ou seed — diferente do Suno, que as telas de
 * referência mostram. Tudo isso precisa virar texto.
 *
 * A montagem é DETERMINÍSTICA de propósito: mesma entrada gera exatamente o
 * mesmo prompt. Isso torna o resultado reproduzível, permite cachear e não
 * custa nada. O LLM só entra em `enrichLooseDescription`, para transformar uma
 * descrição solta da aba Simple num prompt de estilo rico — ali ele agrega
 * valor real.
 */

export interface CompileInput {
  /** Estilos desejados ou, na aba Simple, a descrição livre já enriquecida. */
  styles?: string | null;
  excludeStyles?: string | null;
  instrumental: boolean;
  controls: AdvancedControls;
  /** true quando há letra — muda a instrução de vocal. */
  hasLyrics: boolean;
}

const VOCAL_GENDER_PHRASES: Record<Exclude<VocalGender, 'any'>, string> = {
  male: 'male lead vocal',
  female: 'female lead vocal',
};

/**
 * Mapeia 0–100 para uma frase. Faixas amplas de propósito: o modelo responde a
 * intensidade descrita, não a número, então granularidade fina seria ilusória.
 */
function weirdnessPhrase(value: number): string | null {
  if (value <= 20) return 'conventional and predictable song structure';
  if (value <= 40) return 'familiar structure with subtle variations';
  if (value <= 60) return null; // faixa neutra: não adiciona ruído ao prompt
  if (value <= 80) return 'unconventional arrangement with unexpected turns';
  return 'highly experimental and unpredictable, avoid standard song structure';
}

function styleInfluencePhrase(value: number): string | null {
  if (value <= 20) return 'treat the style description as loose inspiration only';
  if (value <= 40) return 'loosely follow the described style';
  if (value <= 60) return null;
  if (value <= 80) return 'closely follow the described style';
  return 'strictly adhere to every element of the described style';
}

/**
 * Normaliza a lista de exclusões numa instrução negativa.
 *
 * Aceita tanto "vocals, rap, distortion" quanto texto livre. Cada item vira
 * "no <item>" porque instruções negativas curtas e repetidas funcionam melhor
 * que uma frase longa.
 */
export function buildNegativeInstruction(excludeStyles?: string | null): string | null {
  if (!excludeStyles?.trim()) return null;

  const items = excludeStyles
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    // remove "no "/"sem " que o usuário possa ter digitado, para não virar "no no vocals"
    .map((s) => s.replace(/^(no|sem|without|avoid)\s+/i, ''))
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .slice(0, 20);

  if (items.length === 0) return null;
  return `Strictly avoid: ${items.map((i) => `no ${i}`).join(', ')}.`;
}

function buildVocalInstruction(input: CompileInput): string {
  if (input.instrumental) {
    return 'Strictly instrumental: no vocals, no singing, no spoken word, no vocal samples.';
  }

  const parts: string[] = [];
  const gender = input.controls.vocalGender;
  if (gender !== 'any') {
    parts.push(`Lead vocal performed by a ${VOCAL_GENDER_PHRASES[gender]}.`);
  }
  if (input.hasLyrics) {
    parts.push('Sing the provided lyrics clearly and in time.');
  }
  return parts.join(' ');
}

function buildTempoInstruction(controls: AdvancedControls): string | null {
  const parts: string[] = [];
  if (controls.bpm) parts.push(`at ${controls.bpm} BPM`);
  if (controls.key !== 'any') parts.push(`in the key of ${controls.key}`);
  return parts.length ? `Play ${parts.join(', ')}.` : null;
}

/**
 * Monta o prompt final. A ordem importa: o modelo dá mais peso ao início,
 * então estilo vem primeiro e as restrições depois.
 */
export function compilePrompt(input: CompileInput): string {
  const segments: string[] = [];

  const styles = input.styles?.trim();
  if (styles) segments.push(ensureSentence(styles));

  const tempo = buildTempoInstruction(input.controls);
  if (tempo) segments.push(tempo);

  const vocal = buildVocalInstruction(input);
  if (vocal) segments.push(vocal);

  const influence = styleInfluencePhrase(input.controls.styleInfluence);
  if (influence) segments.push(ensureSentence(capitalize(influence)));

  const weird = weirdnessPhrase(input.controls.weirdness);
  if (weird) segments.push(ensureSentence(capitalize(weird)));

  const negative = buildNegativeInstruction(input.excludeStyles);
  if (negative) segments.push(negative);

  return segments.join(' ').replace(/\s+/g, ' ').trim();
}

/** Prompt para a aba Sounds — one-shots e loops curtos. */
export function compileSoundPrompt(params: {
  prompt: string;
  soundType: 'one-shot' | 'loop';
  bpm?: number;
  key: string;
}): string {
  const segments: string[] = [ensureSentence(params.prompt)];

  segments.push(
    params.soundType === 'loop'
      ? 'A seamlessly looping sample that repeats without an audible seam.'
      : 'A single one-shot sample with a clean attack and natural decay.',
  );

  if (params.bpm) segments.push(`Tempo locked at ${params.bpm} BPM.`);
  if (params.key !== 'any') segments.push(`In the key of ${params.key}.`);

  segments.push('No vocals. Clean, dry and ready to drop into a production.');

  return segments.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// ACE-Step (motor principal)
// ---------------------------------------------------------------------------

/** Limite do campo caption no ACE-Step 1.5 (GenerationParams). */
export const ACESTEP_MAX_CAPTION = 512;

/** Termos que, numa exclusão, significam "sem voz". */
const VOCAL_EXCLUSION_TERMS = [
  'vocal',
  'vocals',
  'voice',
  'voz',
  'vocais',
  'singing',
  'canto',
  'singer',
  'cantor',
  'lyrics',
  'letra',
];

/**
 * true quando o usuário excluiu a voz.
 *
 * Para o ACE-Step isso vira `instrumental: true` — parâmetro nativo e confiável —
 * em vez de "no vocals" no caption: modelos de difusão tendem a reagir à
 * palavra citada, com ou sem negação.
 */
export function excludesVocals(excludeStyles?: string | null): boolean {
  if (!excludeStyles) return false;
  const items = excludeStyles
    .toLowerCase()
    .split(/[,;\n]/)
    .map((s) => s.trim().replace(/^(no|sem|without|avoid)\s+/, ''));
  return items.some((item) => VOCAL_EXCLUSION_TERMS.some((term) => item === term || item.startsWith(`${term} `)));
}

export interface AceStepCaptionInput {
  styles?: string | null;
  excludeStyles?: string | null;
  instrumental: boolean;
  controls: AdvancedControls;
  soundType?: 'one-shot' | 'loop';
}

/**
 * Monta o caption do ACE-Step.
 *
 * Diferente do Lyria, BPM, tom, duração e idioma NÃO entram aqui: vão como
 * parâmetros nativos. O caption fica com estilo, voz e as exclusões que não
 * são de voz.
 *
 * NÃO TESTADO: a eficácia de "without X" no caption. O LM do ACE-Step reescreve
 * o caption (use_cot_caption) e deve interpretar a negação, mas isso não foi
 * medido como o ritmo foi. Exclusões de voz não dependem disso (ver
 * excludesVocals).
 */
export function compileAceStepCaption(input: AceStepCaptionInput): string {
  const parts: string[] = [];

  const styles = input.styles?.trim();
  if (styles) parts.push(styles.replace(/[.\s]+$/, ''));

  if (input.soundType === 'loop') parts.push('seamless loop');
  if (input.soundType === 'one-shot') parts.push('one-shot sample');

  const instrumental = input.instrumental || excludesVocals(input.excludeStyles);
  if (!instrumental && input.controls.vocalGender !== 'any') {
    parts.push(`${input.controls.vocalGender} vocal`);
  }

  const weirdness = input.controls.weirdness;
  if (weirdness >= 80) parts.push('experimental, unconventional structure');
  else if (weirdness <= 20) parts.push('conventional song structure');

  const otherExclusions = splitExclusions(input.excludeStyles).filter(
    (item) => !excludesVocals(item),
  );
  if (otherExclusions.length) parts.push(`without ${otherExclusions.join(', ')}`);

  const caption = parts.join(', ').replace(/\s+/g, ' ').trim();
  return caption.length <= ACESTEP_MAX_CAPTION
    ? caption
    : caption.slice(0, ACESTEP_MAX_CAPTION).replace(/,[^,]*$/, '');
}

function splitExclusions(excludeStyles?: string | null): string[] {
  if (!excludeStyles?.trim()) return [];
  return excludeStyles
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase().replace(/^(no|sem|without|avoid)\s+/i, ''))
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);
}

/**
 * Converte o tom da UI ('C', 'Am', 'F#m') para o formato do ACE-Step
 * ('C major', 'A minor', 'F# minor'). 'any' = deixar o modelo decidir.
 */
export function toAceStepKeyscale(key: string): string | undefined {
  if (!key || key === 'any') return undefined;
  const minor = key.endsWith('m');
  const root = minor ? key.slice(0, -1) : key;
  return `${root} ${minor ? 'minor' : 'major'}`;
}

/** Chave de cache: mesma entrada não paga enriquecimento duas vezes. */
export function compileCacheKey(input: CompileInput): string {
  const c = input.controls;
  return [
    input.styles ?? '',
    input.excludeStyles ?? '',
    input.instrumental ? 'inst' : 'voc',
    c.vocalGender,
    c.bpm ?? '',
    c.key,
    bucket(c.weirdness),
    bucket(c.styleInfluence),
  ].join('|');
}

/** Agrupa em faixas de 20 — variações dentro da mesma faixa dão o mesmo prompt. */
function bucket(value: number): number {
  return Math.floor(value / 20);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ensureSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
