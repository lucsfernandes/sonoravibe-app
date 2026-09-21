import { describe, expect, it } from 'vitest';
import type { Song } from '@sonora/db';
import { filenameFor } from '../src/songs/downloads.service';

/** Só o título importa para o nome do arquivo. */
const musica = (title: string) => ({ title }) as Song;

describe('filenameFor', () => {
  it('não deixa hífen solto quando o corte cai no meio da palavra', () => {
    // Bug visto em produção: o título de 96 caracteres virava
    // "samba-de-raiz-...-voz-masculina-grave-.mp3", com o hífen pendurado.
    const nome = filenameFor(
      musica('samba de raiz com cavaquinho e pandeiro, voz masculina grave, clima de roda'),
      'mp3',
    );

    expect(nome).not.toMatch(/-\.mp3$/);
    expect(nome).toBe('samba-de-raiz-com-cavaquinho-e-pandeiro-voz-masculina-grave.mp3');
  });

  it('tira acento e pontuação, mantendo o nome legível', () => {
    expect(filenameFor(musica('Coração à Beira-Mar!'), 'flac')).toBe('Coracao-a-Beira-Mar.flac');
  });

  it('cai num nome padrão quando não sobra nada do título', () => {
    expect(filenameFor(musica('♪♫★'), 'wav')).toBe('sonora.wav');
  });

  it('respeita o teto de 60 caracteres no nome base', () => {
    const nome = filenameFor(musica('a'.repeat(200)), 'mp3');
    expect(nome.length).toBe(60 + '.mp3'.length);
  });
});
