'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { API_URL, type Musica } from './api';

/**
 * Player global.
 *
 * Uma única tag `<audio>` vive fora da árvore de páginas, criada aqui: assim a
 * música não para quando o usuário navega entre biblioteca, explorar e criação.
 * Um `<audio>` dentro de uma página seria desmontado a cada troca de rota.
 */

export interface FaixaTocando {
  id: string;
  title: string;
  audioUrl: string;
  coverUrl: string | null;
  durationMs: number;
  autor?: string;
}

interface Player {
  faixa: FaixaTocando | null;
  fila: FaixaTocando[];
  tocando: boolean;
  posicaoMs: number;
  duracaoMs: number;
  volume: number;
  tocar: (faixa: FaixaTocando, fila?: FaixaTocando[]) => void;
  alternar: () => void;
  proxima: () => void;
  anterior: () => void;
  buscar: (ms: number) => void;
  setVolume: (v: number) => void;
}

const Contexto = createContext<Player | null>(null);

/** Tempo mínimo de escuta para a reprodução contar — o backend usa o mesmo corte. */
const MIN_ESCUTA_MS = 5_000;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const escutadoRef = useRef(0);
  const registradoRef = useRef<string | null>(null);

  const [faixa, setFaixa] = useState<FaixaTocando | null>(null);
  const [fila, setFila] = useState<FaixaTocando[]>([]);
  const [tocando, setTocando] = useState(false);
  const [posicaoMs, setPosicaoMs] = useState(0);
  const [duracaoMs, setDuracaoMs] = useState(0);
  const [volume, setVolumeEstado] = useState(1);

  // O elemento é criado uma vez e nunca é desmontado enquanto o app viver.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;

    const aoTempo = () => {
      setPosicaoMs(audio.currentTime * 1000);
      escutadoRef.current = audio.currentTime * 1000;
    };
    const aoCarregar = () => {
      // `audio.duration` volta Infinity enquanto o navegador não sabe o tamanho
      // real — acontece com FLAC servido sem Content-Length, que é o caso das
      // URLs assinadas do R2. Aceitar esse valor deixava a barra de busca com
      // max="Infinity", que o navegador descarta: a barra nunca saía do zero.
      // Nesses casos fica valendo a duração que o backend mediu no arquivo.
      const medida = audio.duration * 1000;
      if (Number.isFinite(medida) && medida > 0) setDuracaoMs(medida);
    };
    const aoTocar = () => setTocando(true);
    const aoPausar = () => setTocando(false);

    audio.addEventListener('timeupdate', aoTempo);
    audio.addEventListener('loadedmetadata', aoCarregar);
    audio.addEventListener('play', aoTocar);
    audio.addEventListener('pause', aoPausar);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', aoTempo);
      audio.removeEventListener('loadedmetadata', aoCarregar);
      audio.removeEventListener('play', aoTocar);
      audio.removeEventListener('pause', aoPausar);
    };
  }, []);

  /**
   * Conta a reprodução depois de 5 s de escuta, uma vez por faixa.
   *
   * O backend deduplica por 30 s de qualquer jeito, mas mandar a cada
   * `timeupdate` seria uma requisição a cada 250 ms — barulho de rede sem ganho.
   */
  const registrarPlay = useCallback((id: string, escutadoMs: number) => {
    if (escutadoMs < MIN_ESCUTA_MS || registradoRef.current === id) return;
    registradoRef.current = id;
    void fetch(`${API_URL}/songs/${id}/play`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listenedMs: Math.round(escutadoMs) }),
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!faixa) return;
    const id = setInterval(() => registrarPlay(faixa.id, escutadoRef.current), 2000);
    return () => clearInterval(id);
  }, [faixa, registrarPlay]);

  const tocarFaixa = useCallback((nova: FaixaTocando) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = nova.audioUrl;
    audio.currentTime = 0;
    escutadoRef.current = 0;
    registradoRef.current = null;
    setFaixa(nova);
    setPosicaoMs(0);
    setDuracaoMs(nova.durationMs);
    void audio.play().catch(() => setTocando(false));
  }, []);

  const proxima = useCallback(() => {
    if (!faixa) return;
    const atual = fila.findIndex((f) => f.id === faixa.id);
    const seguinte = fila[atual + 1];
    if (seguinte) tocarFaixa(seguinte);
  }, [faixa, fila, tocarFaixa]);

  // Avanço automático ao terminar a faixa.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const aoTerminar = () => proxima();
    audio.addEventListener('ended', aoTerminar);
    return () => audio.removeEventListener('ended', aoTerminar);
  }, [proxima]);

  const valor = useMemo<Player>(
    () => ({
      faixa,
      fila,
      tocando,
      posicaoMs,
      duracaoMs,
      volume,
      tocar: (nova, novaFila) => {
        setFila(novaFila ?? [nova]);
        tocarFaixa(nova);
      },
      alternar: () => {
        const audio = audioRef.current;
        if (!audio || !faixa) return;
        if (audio.paused) void audio.play().catch(() => setTocando(false));
        else audio.pause();
      },
      proxima,
      anterior: () => {
        const audio = audioRef.current;
        if (!audio || !faixa) return;
        // Volta ao início primeiro, como qualquer player: só pula para a
        // anterior quando a faixa mal começou.
        if (audio.currentTime > 3) {
          audio.currentTime = 0;
          return;
        }
        const atual = fila.findIndex((f) => f.id === faixa.id);
        const anterior = fila[atual - 1];
        if (anterior) tocarFaixa(anterior);
      },
      buscar: (ms) => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = ms / 1000;
      },
      setVolume: (v) => {
        const audio = audioRef.current;
        if (audio) audio.volume = v;
        setVolumeEstado(v);
      },
    }),
    [faixa, fila, tocando, posicaoMs, duracaoMs, volume, proxima, tocarFaixa],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePlayer(): Player {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('usePlayer precisa estar dentro de <PlayerProvider>.');
  return contexto;
}

/** Converte uma música da API no formato que o player entende. */
export function paraFaixa(musica: Musica, autor?: string): FaixaTocando | null {
  if (!musica.audioUrl) return null;
  return {
    id: musica.id,
    title: musica.title,
    audioUrl: musica.audioUrl,
    coverUrl: musica.coverUrl,
    durationMs: musica.durationMs,
    autor,
  };
}
