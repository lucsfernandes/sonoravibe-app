import { describe, expect, it } from 'vitest';
import { termosDeEstilo } from '../src/social/social.service';

/**
 * A lista de "similares" da página da música nasce dos termos do estilo.
 *
 * O que importa fixar: termos vazios não podem virar coringa ("with" casaria
 * com o catálogo inteiro), números soltos também não (todo estilo com BPM
 * casaria com todo outro), e a lista tem um teto para a consulta não crescer
 * com o tamanho do prompt.
 */
describe('termosDeEstilo', () => {
  it('extrai os termos que descrevem o estilo, sem repetir', () => {
    expect(termosDeEstilo('Ambient, warm synths, ambient pads and unhurried 62 BPM drift')).toEqual([
      'ambient',
      'warm',
      'synths',
      'pads',
      'unhurried',
      'drift',
    ]);
  });

  it('ignora palavras vazias em português e em inglês', () => {
    expect(termosDeEstilo('forró com sanfona e zabumba, para dançar')).toEqual([
      'forró',
      'sanfona',
      'zabumba',
      'dançar',
    ]);
  });

  it('descarta números e termos curtos', () => {
    // "62", "4/4" e "pé" não dizem nada sobre o estilo sozinhos.
    expect(termosDeEstilo('62 BPM, 4/4, pé de serra')).toEqual(['serra']);
  });

  it('limita a quantidade de termos', () => {
    const longo = Array.from({ length: 20 }, (_, i) => `estilo${i}`).join(', ');
    expect(termosDeEstilo(longo)).toHaveLength(8);
  });

  it('sem estilo, sem termos', () => {
    expect(termosDeEstilo(null)).toEqual([]);
    expect(termosDeEstilo('')).toEqual([]);
    expect(termosDeEstilo('com para the and')).toEqual([]);
  });
});
