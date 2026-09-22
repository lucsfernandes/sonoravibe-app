'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { API_URL, type ProgressoGeracao } from './api';
import { useSessao } from './sessao';

/**
 * Progresso das gerações, por SSE.
 *
 * Uma conexão só para todas as gerações do usuário — é assim que o backend
 * expõe `/generations/stream`. Abrir uma conexão por música em andamento
 * multiplicaria as conexões sem necessidade, e navegadores limitam quantas
 * ficam abertas por origem.
 *
 * O EventSource não manda cabeçalho, mas manda cookie com
 * `withCredentials: true`, que é como a sessão viaja aqui.
 */

interface Progresso {
  /** Gerações em andamento, por generationId. */
  emAndamento: Record<string, ProgressoGeracao>;
  /** Registra interesse numa geração recém-enfileirada. */
  acompanhar: (generationId: string, songId: string) => void;
  /**
   * O progresso de uma música, se ela estiver sendo gerada agora.
   *
   * A indexação é por `generationId`, que é o que o SSE manda, mas quem
   * desenha o card só tem o `songId` em mãos. Sem esta busca, o card teria que
   * receber a lista inteira de gerações como prop e filtrar sozinho.
   */
  progressoDaMusica: (songId: string) => ProgressoGeracao | undefined;
  /** Avisa quando uma geração termina — usado para recarregar a biblioteca. */
  aoConcluir: (callback: (evento: ProgressoGeracao) => void) => () => void;
}

const Contexto = createContext<Progresso | null>(null);

export function ProgressoProvider({ children }: { children: ReactNode }) {
  const { usuario } = useSessao();
  const [emAndamento, setEmAndamento] = useState<Record<string, ProgressoGeracao>>({});
  const ouvintesRef = useRef(new Set<(evento: ProgressoGeracao) => void>());

  useEffect(() => {
    if (!usuario) {
      setEmAndamento({});
      return;
    }

    const fonte = new EventSource(`${API_URL}/generations/stream`, {
      withCredentials: true,
    });

    fonte.addEventListener('progress', (evento) => {
      const dados = JSON.parse((evento as MessageEvent<string>).data) as ProgressoGeracao;

      setEmAndamento((atual) => {
        const anterior = atual[dados.generationId];
        // A capa pode chegar num evento do meio da geração, e o evento seguinte
        // vir sem `song`: o que já se sabe da música fica, senão a capa piscaria
        // no card e sumiria na etapa seguinte.
        const song = dados.song
          ? { ...dados.song, coverUrl: dados.song.coverUrl ?? anterior?.song?.coverUrl ?? null }
          : anterior?.song;
        const proximo = { ...atual, [dados.generationId]: { ...dados, ...(song ? { song } : {}) } };
        // Terminou: sai da lista depois de um instante, para a interface ter
        // tempo de mostrar 100% antes do item sumir.
        if (['complete', 'failed', 'canceled'].includes(dados.status)) {
          setTimeout(() => {
            setEmAndamento((depois) => {
              const copia = { ...depois };
              delete copia[dados.generationId];
              return copia;
            });
          }, 1500);
          for (const ouvinte of ouvintesRef.current) ouvinte(dados);
        }
        return proximo;
      });
    });

    // O navegador reconecta sozinho depois de um erro de rede; não fechamos a
    // fonte aqui para não transformar uma oscilação de rede em silêncio
    // permanente até a próxima navegação.
    return () => fonte.close();
  }, [usuario]);

  const valor = useMemo<Progresso>(
    () => ({
      emAndamento,
      progressoDaMusica: (songId) =>
        Object.values(emAndamento).find((g) => g.songId === songId),
      acompanhar: (generationId, songId) => {
        // Entra na lista já como "na fila", antes do primeiro evento chegar:
        // sem isso o cartão da música nova só apareceria segundos depois.
        setEmAndamento((atual) => ({
          ...atual,
          [generationId]: { generationId, songId, status: 'queued', progress: 5 },
        }));
      },
      aoConcluir: (callback) => {
        ouvintesRef.current.add(callback);
        return () => ouvintesRef.current.delete(callback);
      },
    }),
    [emAndamento],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useProgresso(): Progresso {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useProgresso precisa estar dentro de <ProgressoProvider>.');
  return contexto;
}

/** Rótulo de cada etapa, nos dois idiomas. */
export const ROTULOS_STATUS: Record<string, { pt: string; en: string }> = {
  queued: { pt: 'Na fila', en: 'Queued' },
  compiling_prompt: { pt: 'Interpretando o estilo', en: 'Interpreting style' },
  writing_lyrics: { pt: 'Escrevendo a letra', en: 'Writing lyrics' },
  generating_audio: { pt: 'Compondo a música', en: 'Composing' },
  uploading: { pt: 'Finalizando o áudio', en: 'Finalizing audio' },
  generating_cover: { pt: 'Criando a capa', en: 'Creating cover art' },
  complete: { pt: 'Pronta', en: 'Ready' },
  failed: { pt: 'Falhou', en: 'Failed' },
  canceled: { pt: 'Cancelada', en: 'Canceled' },
};

export function useAoConcluirGeracao(callback: (evento: ProgressoGeracao) => void): void {
  const { aoConcluir } = useProgresso();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(
    // O wrapper lê da ref para o efeito não reassinar a cada render quando o
    // componente passa uma função nova (o caso comum).
    () => aoConcluir((evento) => callbackRef.current(evento)),
    [aoConcluir],
  );
}
