import { describe, expect, it } from 'vitest';
import { jobId } from '@sonora/shared';
import { argsForOperation } from '../src/audio/operations';

describe('argsForOperation', () => {
  it('corta pela duração, não pelo instante final', () => {
    // O `-t` do FFmpeg é duração, não fim. Passar o fim absoluto aqui daria um
    // trecho de 20s onde o usuário pediu 15s.
    const { args } = argsForOperation('crop', { startMs: 5000, endMs: 20000 }, 30000);
    expect(args).toEqual(['-ss', '5.000', '-t', '15.000']);
  });

  it('recusa corte invertido', () => {
    expect(() => argsForOperation('crop', { startMs: 20000, endMs: 5000 }, 30000)).toThrow(
      /depois do início/,
    );
  });

  it('posiciona o fade-out pelo fim da faixa', () => {
    const { args } = argsForOperation('fade-out', { durationMs: 3000 }, 30000);
    expect(args[1]).toBe('afade=t=out:st=27.000:d=3');
  });

  it('não deixa o fade-out começar antes do zero numa faixa curta', () => {
    // Faixa de 2s com fade de 3s: sem o clamp, `st` ficaria negativo e o FFmpeg
    // aplicaria o filtro no lugar errado.
    const { args } = argsForOperation('fade-out', { durationMs: 3000 }, 2000);
    expect(args[1]).toBe('afade=t=out:st=0.000:d=3');
  });

  it('recusa velocidade fora da faixa que o atempo aceita', () => {
    expect(() => argsForOperation('speed', { factor: 3 }, 30000)).toThrow(/0.5x e 2x/);
    expect(argsForOperation('speed', { factor: 1.25 }, 30000).args[1]).toBe('atempo=1.25');
  });

  it('normaliza no alvo de streaming', () => {
    expect(argsForOperation('normalize', {}, 30000).args[1]).toContain('I=-14');
  });
});

describe('jobId', () => {
  it('nunca produz o separador que o BullMQ rejeita', () => {
    // O BullMQ aceita ':' apenas quando o id tem exatamente 3 partes, então
    // 'musica:crop' explodiria e 'musica:mp3:128' passaria. Não usamos ':'.
    expect(jobId('musica', 'crop')).toBe('musica-crop');
    expect(jobId('musica', 'mp3', 128)).toBe('musica-mp3-128');
    expect(jobId('a:b', 'c')).not.toContain(':');
  });
});
