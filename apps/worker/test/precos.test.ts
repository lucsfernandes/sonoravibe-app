import { describe, expect, it } from 'vitest';
import {
  CREDIT_PACKS,
  DURATION_BANDS,
  MODEL_CREDITS,
  MUSIC_MODEL_SPECS,
  MUSIC_MODELS,
  PLANS,
  durationBandOf,
  effectiveDuration,
  songCreditCost,
  type MusicModel,
} from '@sonora/shared';

/**
 * A tabela de preços não pode dar prejuízo.
 *
 * Os custos abaixo foram MEDIDOS na RunPod (L4, US$ 0,69/h, pedido de duas
 * faixas) nos benchmarks de 2026-09-24 (docs/BENCHMARK-MIDNIGHT.md) e acrescidos
 * de 30% de folga (cold start, tempo ocioso, capa, letra). Se alguém baixar um
 * preço ou subir os créditos de um plano, este teste diz quanto a margem caiu.
 */

/** US$ por minuto de áudio, pedido de 2 faixas, na L4, sem folga. */
const GPU_USD_POR_MINUTO: Record<'turbo' | 'sft32' | 'sft50', number> = {
  turbo: 0.0071 / 2, // REF: 2 min em US$ 0,0071
  sft32: 0.0159 / 2, // S32N: 2 min em US$ 0,0159
  sft50: 0.0629 / 6, // S50N360: 6 min em US$ 0,0629
};
const FOLGA = 1.3;
/** Câmbio assumido. Se o real cair, a margem cai junto: revisar este número. */
const BRL_POR_USD = 5.5;
/** Teto de custo de GPU sobre a receita: 30% (margem bruta de 70%). */
const TETO_CUSTO_SOBRE_RECEITA = 0.3;

function custoUsd(model: MusicModel, segundos: number): number {
  const spec = MUSIC_MODEL_SPECS[model];
  const taxa =
    spec.family === 'turbo' ? GPU_USD_POR_MINUTO.turbo : spec.steps <= 32 ? GPU_USD_POR_MINUTO.sft32 : GPU_USD_POR_MINUTO.sft50;
  return (segundos / 60) * taxa * FOLGA;
}

/** O crédito mais barato que vendemos, em R$ (o pior caso: quem gasta o plano inteiro). */
const creditoMaisBarato = Math.min(
  ...(['pro', 'premier'] as const).map((c) => PLANS[c].priceBrl / PLANS[c].monthlyCredits),
  ...CREDIT_PACKS.map((p) => p.priceBrl / p.credits),
);

describe('preço das versões', () => {
  it.each(MUSIC_MODELS.flatMap((m) => DURATION_BANDS.map((d) => [m, d] as const)))(
    '%s até %i s: GPU em até 30%% da receita',
    (model, segundos) => {
      const receitaBrl = songCreditCost(model, segundos) * creditoMaisBarato;
      const custoBrl = custoUsd(model, segundos) * BRL_POR_USD;
      expect(custoBrl / receitaBrl).toBeLessThanOrEqual(TETO_CUSTO_SOBRE_RECEITA);
    },
  );

  it('versão mais cara nunca custa menos que a mais barata', () => {
    for (let band = 0; band < DURATION_BANDS.length; band++) {
      const precos = MUSIC_MODELS.map((m) => MODEL_CREDITS[m][band]);
      expect([...precos].sort((a, b) => a - b)).toEqual(precos);
    }
  });

  it('a música de sempre (v1, até 2 min) continua custando 10', () => {
    expect(songCreditCost('v1', 120)).toBe(10);
  });

  it('duração no automático é cobrada como até 4 min', () => {
    expect(durationBandOf(undefined)).toBe(1);
    expect(songCreditCost('v2.5', undefined)).toBe(52);
  });

  it('no automático, plano com teto abaixo de 4 min gera e cobra pelo teto', () => {
    expect(effectiveDuration(undefined, 120)).toBe(120);
    expect(songCreditCost('v1', effectiveDuration(undefined, 120))).toBe(10);
    expect(effectiveDuration(undefined, 240)).toBeUndefined(); // Pro: fica no automático
    expect(effectiveDuration(undefined, 360)).toBeUndefined(); // Premier
    expect(effectiveDuration(90, 120)).toBe(90); // escolhida pelo usuário: é ela
  });

  it('faixas de duração: 120 é a primeira, 121 já é a segunda', () => {
    expect(durationBandOf(120)).toBe(0);
    expect(durationBandOf(121)).toBe(1);
    expect(durationBandOf(360)).toBe(2);
  });
});
