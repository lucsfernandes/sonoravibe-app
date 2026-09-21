import { describe, expect, it } from 'vitest';
import { ENGINE_MAX_DURATION_SECONDS, PLANS, maxDurationFor } from '@sonora/shared';

/**
 * O que a tela de planos promete tem que ser o que a API aceita.
 *
 * O bug que motivou isto apareceu numa geração real em produção: o plano Free
 * anunciava "2 min por música" e o Lyria devolveu 3:01, porque a duração vai
 * para ele como sugestão de texto no prompt, não como parâmetro. No sentido
 * inverso o problema é pior — Pro e Premier anunciam 4 e 8 min, que o motor
 * ligado hoje simplesmente não entrega.
 */

describe('maxDurationFor', () => {
  it('nunca promete mais do que o motor ligado entrega', () => {
    for (const code of ['free', 'pro', 'premier'] as const) {
      expect(maxDurationFor(code)).toBeLessThanOrEqual(ENGINE_MAX_DURATION_SECONDS);
    }
  });

  it('nunca promete mais do que o próprio plano dá direito', () => {
    // O teto do motor não pode virar um upgrade silencioso: se um dia ele subir
    // para 480, o Free continua com os 120 s que ele comprou.
    for (const code of ['free', 'pro', 'premier'] as const) {
      expect(maxDurationFor(code)).toBeLessThanOrEqual(PLANS[code].features.maxDurationSeconds);
    }
  });

  it('entrega o menor dos dois limites', () => {
    for (const code of ['free', 'pro', 'premier'] as const) {
      expect(maxDurationFor(code)).toBe(
        Math.min(PLANS[code].features.maxDurationSeconds, ENGINE_MAX_DURATION_SECONDS),
      );
    }
  });

  it('respeita o limite menor do Free mesmo com o motor permitindo mais', () => {
    // Enquanto ENGINE for 180 e o Free for 120, quem manda é o plano.
    expect(maxDurationFor('free')).toBe(
      Math.min(120, ENGINE_MAX_DURATION_SECONDS),
    );
  });
});
