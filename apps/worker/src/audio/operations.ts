import type { EditOperation } from '@sonora/shared';

/**
 * Tradução de cada edição mecânica para argumentos do FFmpeg.
 *
 * Fica separado do processador para poder ser testado sem banco, sem fila e sem
 * FFmpeg instalado: o que importa verificar aqui é o filtro gerado.
 */
export function argsForOperation(
  operation: EditOperation,
  params: Record<string, number>,
  sourceDurationMs: number,
): { args: string[]; label: string } {
  const segundos = (ms: number): string => (ms / 1000).toFixed(3);

  switch (operation) {
    case 'crop': {
      const start = params.startMs ?? 0;
      const end = params.endMs ?? sourceDurationMs;
      if (end <= start) throw new Error('O fim do corte precisa vir depois do início.');
      // -ss antes de -t: o FFmpeg corta a partir do ponto e pela duração.
      return {
        args: ['-ss', segundos(start), '-t', segundos(end - start)],
        label: `corte ${segundos(start)}s–${segundos(end)}s`,
      };
    }

    case 'trim-silence':
      // Remove silêncio nas duas pontas. O `areverse` no meio é o jeito
      // padrão de aplicar o silenceremove também no fim do arquivo.
      return {
        args: [
          '-af',
          'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1,' +
            'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1,areverse',
        ],
        label: 'silêncio removido das pontas',
      };

    case 'fade-in': {
      const duracao = (params.durationMs ?? 2000) / 1000;
      return { args: ['-af', `afade=t=in:st=0:d=${duracao}`], label: `fade-in de ${duracao}s` };
    }

    case 'fade-out': {
      const duracao = (params.durationMs ?? 3000) / 1000;
      const inicio = Math.max(0, sourceDurationMs / 1000 - duracao);
      return {
        args: ['-af', `afade=t=out:st=${inicio.toFixed(3)}:d=${duracao}`],
        label: `fade-out de ${duracao}s`,
      };
    }

    case 'speed': {
      const fator = params.factor ?? 1;
      if (fator < 0.5 || fator > 2) {
        // O atempo aceita 0.5–2.0 por chamada; fora disso exigiria encadear
        // filtros, e mudanças além dessa faixa já deformam o timbre.
        throw new Error('A velocidade precisa ficar entre 0.5x e 2x.');
      }
      return { args: ['-af', `atempo=${fator}`], label: `velocidade ${fator}x` };
    }

    case 'reverse':
      return { args: ['-af', 'areverse'], label: 'invertida' };

    case 'normalize':
      // loudnorm no padrão de streaming (-14 LUFS): é o alvo do Spotify e do
      // YouTube, então a faixa não soa mais baixa que as outras da playlist.
      return {
        args: ['-af', 'loudnorm=I=-14:TP=-1:LRA=11'],
        label: 'normalizada para -14 LUFS',
      };
  }
}
