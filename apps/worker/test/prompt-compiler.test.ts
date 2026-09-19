import { describe, expect, it } from 'vitest';
import { advancedControlsSchema } from '@sonora/shared';
import {
  ACESTEP_MAX_CAPTION,
  compileAceStepCaption,
  compilePrompt,
  excludesVocals,
  toAceStepKeyscale,
} from '../src/generation/prompt-compiler';

const controls = (over: Record<string, unknown> = {}) => advancedControlsSchema.parse(over);

describe('excludesVocals', () => {
  it.each([
    ['vocals', true],
    ['no vocals, rap', true],
    ['sem voz', true],
    ['Singing', true],
    ['rap, distortion', false],
    ['vocal chops', true],
    ['', false],
    [undefined, false],
  ])('%s -> %s', (input, expected) => {
    expect(excludesVocals(input as string | undefined)).toBe(expected);
  });
});

describe('compileAceStepCaption', () => {
  it('não leva BPM nem tom: no ACE-Step eles são parâmetros nativos', () => {
    const caption = compileAceStepCaption({
      styles: 'synthwave',
      instrumental: false,
      controls: controls({ bpm: 92, key: 'Am' }),
    });

    expect(caption).toBe('synthwave');
  });

  it('acrescenta gênero vocal só quando há voz', () => {
    expect(
      compileAceStepCaption({ styles: 'pop', instrumental: false, controls: controls({ vocalGender: 'female' }) }),
    ).toBe('pop, female vocal');
    expect(
      compileAceStepCaption({ styles: 'pop', instrumental: true, controls: controls({ vocalGender: 'female' }) }),
    ).toBe('pop');
  });

  it('traduz extremos de weirdness e ignora a faixa neutra', () => {
    expect(compileAceStepCaption({ styles: 'jazz', instrumental: true, controls: controls({ weirdness: 90 }) })).toContain(
      'experimental',
    );
    expect(compileAceStepCaption({ styles: 'jazz', instrumental: true, controls: controls({ weirdness: 50 }) })).toBe('jazz');
  });

  it('respeita o limite de caracteres do ACE-Step cortando num separador', () => {
    const caption = compileAceStepCaption({
      styles: Array.from({ length: 80 }, (_, i) => `estilo${i}`).join(', '),
      instrumental: true,
      controls: controls(),
    });

    expect(caption.length).toBeLessThanOrEqual(ACESTEP_MAX_CAPTION);
    expect(caption.endsWith(',')).toBe(false);
  });
});

describe('toAceStepKeyscale', () => {
  it('converte para o formato aceito pelo ACE-Step', () => {
    expect(toAceStepKeyscale('C')).toBe('C major');
    expect(toAceStepKeyscale('Am')).toBe('A minor');
    expect(toAceStepKeyscale('F#m')).toBe('F# minor');
    expect(toAceStepKeyscale('any')).toBeUndefined();
  });
});

describe('compilePrompt (reserva Lyria)', () => {
  it('é determinístico: mesma entrada, mesmo prompt', () => {
    const input = {
      styles: 'lofi hip hop',
      excludeStyles: 'vocals',
      instrumental: true,
      controls: controls({ bpm: 80 }),
      hasLyrics: false,
    };

    expect(compilePrompt(input)).toBe(compilePrompt(input));
    expect(compilePrompt(input)).toContain('at 80 BPM');
    expect(compilePrompt(input)).toContain('no vocals');
  });
});
