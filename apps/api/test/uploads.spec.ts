import { describe, expect, it } from 'vitest';
import { extensionOf, titleOf } from '../src/songs/uploads.service';

/**
 * O upload decide a extensão pelo tipo declarado e, na falta dele, pelo nome
 * do arquivo. Errar aqui grava o bruto com a extensão errada e o FFmpeg do
 * worker falha ao importar.
 */
describe('extensionOf', () => {
  it('prefere o tipo MIME quando é conhecido', () => {
    expect(extensionOf('audio/mpeg', 'musica.wav')).toBe('mp3');
    expect(extensionOf('audio/wav')).toBe('wav');
    expect(extensionOf('audio/flac')).toBe('flac');
  });

  it('ignora parâmetros do tipo, como o codec da gravação do navegador', () => {
    expect(extensionOf('audio/webm;codecs=opus', 'gravacao.webm')).toBe('webm');
    expect(extensionOf('video/webm', undefined)).toBe('webm');
  });

  it('cai na extensão do nome quando o navegador não reconhece o tipo', () => {
    expect(extensionOf('application/octet-stream', 'ideia.FLAC')).toBe('flac');
    expect(extensionOf(undefined, 'loop.m4a')).toBe('m4a');
  });

  it('recusa o que não é áudio', () => {
    expect(extensionOf('image/png', 'capa.png')).toBeNull();
    expect(extensionOf('application/octet-stream', 'arquivo.exe')).toBeNull();
    expect(extensionOf(undefined, undefined)).toBeNull();
  });
});

describe('titleOf', () => {
  it('tira a extensão do nome do arquivo', () => {
    expect(titleOf('Minha ideia.mp3')).toBe('Minha ideia');
  });

  it('gravação sem nome ganha um título', () => {
    expect(titleOf(undefined)).toBe('Gravação');
    expect(titleOf('.webm')).toBe('Gravação');
  });

  it('respeita o limite da coluna', () => {
    expect(titleOf(`${'a'.repeat(200)}.wav`)).toHaveLength(160);
  });
});
