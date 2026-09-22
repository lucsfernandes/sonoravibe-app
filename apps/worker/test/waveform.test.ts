import { describe, expect, it } from 'vitest';
import { peaksOfPcm } from '../src/audio/ffmpeg';
import { withInspiration } from '../src/generation/generation.processor';

/**
 * A forma de onda é o que o modo "onda" da biblioteca desenha, e a
 * inspiração é texto que vai para o motor: as duas são funções puras, e é
 * aqui que se garante que não mentem sobre o áudio nem sobre o pedido.
 */

/** Monta um buffer s16le a partir de amostras inteiras. */
function pcm(amostras: number[]): Buffer {
  const buf = Buffer.alloc(amostras.length * 2);
  amostras.forEach((v, i) => buf.writeInt16LE(v, i * 2));
  return buf;
}

describe('peaksOfPcm', () => {
  it('devolve um pico por fatia, normalizado pelo maior', () => {
    // Quatro fatias de duas amostras: picos 100, 400, 200, 0.
    const picos = peaksOfPcm(pcm([100, -50, 400, 10, -200, 100, 0, 0]), 4);
    expect(picos).toEqual([0.25, 1, 0.5, 0]);
  });

  it('usa o valor absoluto: uma onda negativa tem a mesma altura', () => {
    const picos = peaksOfPcm(pcm([-1000, 0, 1000, 0]), 2);
    expect(picos).toEqual([1, 1]);
  });

  it('silêncio total vira zeros, e não NaN', () => {
    expect(peaksOfPcm(pcm([0, 0, 0, 0]), 2)).toEqual([0, 0]);
  });

  it('buffer vazio devolve null', () => {
    expect(peaksOfPcm(Buffer.alloc(0), 10)).toBeNull();
  });

  it('sempre devolve exatamente o número de pontos pedido', () => {
    const amostras = Array.from({ length: 1000 }, (_, i) => (i % 7) * 100);
    expect(peaksOfPcm(pcm(amostras), 120)).toHaveLength(120);
  });
});

describe('withInspiration', () => {
  it('sem inspiração, o estilo sai como veio', () => {
    expect(withInspiration('forró pé de serra')).toBe('forró pé de serra');
    expect(withInspiration('forró', { playlistId: 'x', name: 'y', styles: [] })).toBe('forró');
  });

  it('acrescenta os estilos da playlist DEPOIS do que o usuário escreveu', () => {
    const texto = withInspiration('forró pé de serra.', {
      playlistId: 'x',
      name: 'Noite',
      styles: ['MPB anos 70', 'bossa nova'],
    });
    expect(texto).toBe('forró pé de serra, inspired by MPB anos 70; bossa nova');
    expect(texto.startsWith('forró')).toBe(true);
  });
});
