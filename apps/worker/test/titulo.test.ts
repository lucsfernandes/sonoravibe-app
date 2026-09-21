import { describe, expect, it } from 'vitest';
import { extractTitle } from '../src/providers/lyria.provider';

/**
 * O Lyria manda título, marcadores de conteúdo e o mapa de seções da música
 * pelo mesmo `delta.content`. Separar as três coisas é trabalho daqui.
 *
 * A versão anterior aceitava qualquer texto com menos de 120 caracteres, e
 * músicas em produção nasciam chamadas "[[A0]] [[B1]] [[C2]] [[B3]] [[C4]]".
 */

describe('extractTitle', () => {
  it('recusa o mapa de seções que virou título em produção', () => {
    expect(extractTitle('[[A0]] [[B1]] [[C2]] [[B3]] [[C4]] [[D5]] [[C6]] [[E7]]')).toBeUndefined();
  });

  it('recusa marcadores de conteúdo', () => {
    expect(extractTitle('<instrumental>')).toBeUndefined();
    expect(extractTitle('<vocal>')).toBeUndefined();
    expect(extractTitle('<music>')).toBeUndefined();
  });

  it('recusa marcadores de seção em colchete simples', () => {
    expect(extractTitle('[Verse 1] [Chorus] [Bridge]')).toBeUndefined();
  });

  it('aceita um título de verdade', () => {
    expect(extractTitle('Roda de Samba no Quintal')).toBe('Roda de Samba no Quintal');
  });

  it('aceita acento e alfabeto não latino', () => {
    // `\p{L}` e não `[a-z]`: um título em português ou japonês continua título.
    expect(extractTitle('Coração à Beira-Mar')).toBe('Coração à Beira-Mar');
    expect(extractTitle('サクラ')).toBe('サクラ');
  });

  it('limpa o título quando vem grudado num marcador', () => {
    // Caso comum: o modelo anuncia a seção e o nome na mesma mensagem.
    expect(extractTitle('[[A0]] Roda de Samba')).toBe('Roda de Samba');
    expect(extractTitle('<music> Baião do Sertão')).toBe('Baião do Sertão');
  });

  it('recusa texto sem duas letras seguidas', () => {
    // Um marcador mal formado pode deixar letras soltas para trás; elas não
    // formam palavra e não viram nome de música.
    expect(extractTitle('A 0 B 1 C 2')).toBeUndefined();
    expect(extractTitle('123 456')).toBeUndefined();
    expect(extractTitle('--- ***')).toBeUndefined();
  });

  it('recusa vazio e texto longo demais para ser nome', () => {
    expect(extractTitle('')).toBeUndefined();
    expect(extractTitle('   ')).toBeUndefined();
    expect(extractTitle('a'.repeat(121))).toBeUndefined();
  });
});
