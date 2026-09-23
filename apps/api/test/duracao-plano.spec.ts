import { describe, expect, it } from 'vitest';
import {
  ENGINE_MAX_DURATION_SECONDS,
  MAX_DURATION_SECONDS,
  PLANS,
  maxDurationFor,
} from '@sonora/shared';

/**
 * O que a tela de planos promete tem que ser o que a API aceita.
 *
 * O bug que motivou isto apareceu numa geração real em produção: o Free
 * anunciava "2 min por música" e o Lyria devolveu 3:01, porque a duração vai
 * para ele como sugestão de texto no prompt, não como parâmetro. No sentido
 * inverso o problema é pior: Pro e Premier anunciavam 4 e 8 min que o motor
 * ligado na época simplesmente não entregava.
 *
 * O teto agora é indexado pelo motor, então o anúncio acompanha a configuração
 * sozinho. Estes testes fixam as duas pontas: o motor nunca promete além do que
 * entrega, e o teto do motor nunca vira um upgrade silencioso de plano.
 *
 * Por cima de tudo há o teto do PRODUTO (MAX_DURATION_SECONDS = 360 s, 6 min):
 * o ACE-Step aguenta 480 s, mas o que vendemos para em 6 min, e nenhum plano
 * nem motor pode passar disso.
 */

const CODIGOS = ['free', 'pro', 'premier'] as const;

describe('maxDurationFor', () => {
  it('nunca promete mais do que o motor ligado entrega', () => {
    for (const engine of Object.keys(ENGINE_MAX_DURATION_SECONDS)) {
      for (const code of CODIGOS) {
        expect(maxDurationFor(code, engine)).toBeLessThanOrEqual(
          ENGINE_MAX_DURATION_SECONDS[engine],
        );
      }
    }
  });

  it('nunca promete mais do que o próprio plano dá direito', () => {
    // O teto do motor não pode virar upgrade silencioso: com o ACE-Step ligado
    // (480 s), o Free continua com os 120 s que ele tem direito.
    for (const engine of Object.keys(ENGINE_MAX_DURATION_SECONDS)) {
      for (const code of CODIGOS) {
        expect(maxDurationFor(code, engine)).toBeLessThanOrEqual(
          PLANS[code].features.maxDurationSeconds,
        );
      }
    }
  });

  it('nunca promete mais do que o teto do produto, em plano ou motor nenhum', () => {
    // O produto aceita músicas de até 6 min. O ACE-Step aguenta 8, e isso não
    // pode vazar para a vitrine nem para a validação da API.
    expect(MAX_DURATION_SECONDS).toBe(360);
    for (const code of CODIGOS) {
      expect(PLANS[code].features.maxDurationSeconds).toBeLessThanOrEqual(MAX_DURATION_SECONDS);
      for (const engine of Object.keys(ENGINE_MAX_DURATION_SECONDS)) {
        expect(maxDurationFor(code, engine)).toBeLessThanOrEqual(MAX_DURATION_SECONDS);
      }
    }
  });

  it('com o Lyria, o Premier cai para 3 min', () => {
    // O caso concreto que quebrou: o plano diz 360, o motor entrega 180.
    expect(PLANS.premier.features.maxDurationSeconds).toBe(360);
    expect(maxDurationFor('premier', 'lyria')).toBe(180);
  });

  it('com o ACE-Step, o Premier entrega os 6 min do plano', () => {
    // O motor chega a 480 s; o Premier para nos 360 s do produto.
    expect(ENGINE_MAX_DURATION_SECONDS.acestep).toBeGreaterThanOrEqual(360);
    expect(maxDurationFor('premier', 'acestep')).toBe(360);
    expect(maxDurationFor('pro', 'acestep')).toBe(240);
  });

  it('o Free não passa de 2 min em motor nenhum', () => {
    for (const engine of Object.keys(ENGINE_MAX_DURATION_SECONDS)) {
      expect(maxDurationFor('free', engine)).toBe(120);
    }
  });

  it('motor desconhecido cai no teto conservador, não no do plano', () => {
    // Uma configuração errada não pode liberar 6 min por acidente.
    expect(maxDurationFor('premier', 'motor-que-nao-existe')).toBe(180);
  });
});

describe('planos', () => {
  it('baixar em lote vale para todos os planos', () => {
    // É o diferencial da plataforma, e no Free custa quase nada: ele só baixa
    // MP3, que já é transcodificado na geração.
    for (const code of CODIGOS) {
      expect(PLANS[code].features.batchDownload).toBe(true);
    }
  });

  it('o Free baixa só MP3, que é o formato já pronto', () => {
    expect(PLANS.free.features.downloadFormats).toEqual(['mp3']);
  });
});
