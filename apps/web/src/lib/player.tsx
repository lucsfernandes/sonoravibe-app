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
import { API_URL, type ItemExplore, type Musica } from './api';

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
  /** Para o player levar ao perfil e mostrar a foto, quando a lista os trouxe. */
  autorHandle?: string;
  autorAvatarUrl?: string | null;
  /** O botão de curtir do player precisa saber por onde começar. */
  likedByMe?: boolean;
  likeCount?: number;
  commentCount?: number;
}

/** Como a fila continua quando a faixa acaba. */
export type Repeticao = 'off' | 'all' | 'one';

interface Player {
  faixa: FaixaTocando | null;
  fila: FaixaTocando[];
  tocando: boolean;
  posicaoMs: number;
  duracaoMs: number;
  volume: number;
  mudo: boolean;
  embaralhando: boolean;
  repeticao: Repeticao;
  tocar: (faixa: FaixaTocando, fila?: FaixaTocando[]) => void;
  /** Toca uma faixa que já está na fila, sem trocar a fila. */
  tocarDaFila: (id: string) => void;
  alternar: () => void;
  proxima: () => void;
  anterior: () => void;
  buscar: (ms: number) => void;
  setVolume: (v: number) => void;
  alternarMudo: () => void;
  alternarEmbaralhar: () => void;
  /** Desligado → repetir tudo → repetir esta → desligado. */
  alternarRepeticao: () => void;
}

const Contexto = createContext<Player | null>(null);

/** Tempo mínimo de escuta para a reprodução contar — o backend usa o mesmo corte. */
const MIN_ESCUTA_MS = 5_000;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const escutadoRef = useRef(0);
  const registradoRef = useRef<string | null>(null);
  /** Volume de antes de silenciar, para o som voltar onde estava. */
  const volumeAnteriorRef = useRef(1);

  const [faixa, setFaixa] = useState<FaixaTocando | null>(null);
  const [fila, setFila] = useState<FaixaTocando[]>([]);
  const [tocando, setTocando] = useState(false);
  const [posicaoMs, setPosicaoMs] = useState(0);
  const [duracaoMs, setDuracaoMs] = useState(0);
  const [volume, setVolumeEstado] = useState(1);
  const [embaralhando, setEmbaralhando] = useState(false);
  const [repeticao, setRepeticao] = useState<Repeticao>('off');

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

  /**
   * A faixa seguinte, respeitando embaralhar e repetir.
   *
   * `automatico` é o fim natural da faixa: só aí "repetir esta" recomeça a
   * mesma. Quem clica em "próxima" com "repetir esta" ligado quer mesmo a
   * próxima, senão o botão não faria nada.
   */
  const avancar = useCallback(
    (automatico: boolean) => {
      const audio = audioRef.current;
      if (!faixa || !audio) return;

      if (automatico && repeticao === 'one') {
        audio.currentTime = 0;
        void audio.play().catch(() => setTocando(false));
        return;
      }

      const atual = fila.findIndex((f) => f.id === faixa.id);
      let seguinte: FaixaTocando | undefined;
      if (embaralhando && fila.length > 1) {
        // Qualquer outra da fila, nunca a que acabou de tocar.
        const candidatas = fila.filter((_, i) => i !== atual);
        seguinte = candidatas[Math.floor(Math.random() * candidatas.length)];
      } else {
        seguinte = fila[atual + 1];
        if (!seguinte && repeticao === 'all') seguinte = fila[0];
      }
      if (seguinte) tocarFaixa(seguinte);
    },
    [faixa, fila, embaralhando, repeticao, tocarFaixa],
  );

  // Avanço automático ao terminar a faixa.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const aoTerminar = () => avancar(true);
    audio.addEventListener('ended', aoTerminar);
    return () => audio.removeEventListener('ended', aoTerminar);
  }, [avancar]);

  const valor = useMemo<Player>(
    () => ({
      faixa,
      fila,
      tocando,
      posicaoMs,
      duracaoMs,
      volume,
      mudo: volume === 0,
      embaralhando,
      repeticao,
      tocar: (nova, novaFila) => {
        setFila(novaFila ?? [nova]);
        tocarFaixa(nova);
      },
      tocarDaFila: (id) => {
        const alvo = fila.find((f) => f.id === id);
        if (alvo) tocarFaixa(alvo);
      },
      alternar: () => {
        const audio = audioRef.current;
        if (!audio || !faixa) return;
        if (audio.paused) void audio.play().catch(() => setTocando(false));
        else audio.pause();
      },
      proxima: () => avancar(false),
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
        const anterior = fila[atual - 1] ?? (repeticao === 'all' ? fila[fila.length - 1] : undefined);
        if (anterior) tocarFaixa(anterior);
      },
      buscar: (ms) => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = ms / 1000;
      },
      setVolume: (v) => {
        const audio = audioRef.current;
        if (audio) audio.volume = v;
        if (v > 0) volumeAnteriorRef.current = v;
        setVolumeEstado(v);
      },
      alternarMudo: () => {
        const audio = audioRef.current;
        const novo = volume === 0 ? volumeAnteriorRef.current || 1 : 0;
        if (audio) audio.volume = novo;
        setVolumeEstado(novo);
      },
      alternarEmbaralhar: () => setEmbaralhando((v) => !v),
      alternarRepeticao: () =>
        setRepeticao((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')),
    }),
    [faixa, fila, tocando, posicaoMs, duracaoMs, volume, embaralhando, repeticao, avancar, tocarFaixa],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function usePlayer(): Player {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('usePlayer precisa estar dentro de <PlayerProvider>.');
  return contexto;
}

/** Quem fez a faixa, como o player mostra. */
export interface AutorFaixa {
  displayName: string;
  handle?: string;
  avatarUrl?: string | null;
}

/**
 * Converte uma música da API no formato que o player entende.
 *
 * O autor pode vir por parâmetro (a página de perfil sabe de quem são todas)
 * ou da própria música, quando ela veio do Explore e traz `author`.
 */
export function paraFaixa(
  musica: Musica | ItemExplore,
  autor?: string | AutorFaixa,
): FaixaTocando | null {
  if (!musica.audioUrl) return null;
  const quem: AutorFaixa | undefined =
    typeof autor === 'string'
      ? { displayName: autor }
      : (autor ?? ('author' in musica ? musica.author : undefined));
  return {
    id: musica.id,
    title: musica.title,
    audioUrl: musica.audioUrl,
    coverUrl: musica.coverUrl,
    durationMs: musica.durationMs,
    autor: quem?.displayName,
    autorHandle: quem?.handle,
    autorAvatarUrl: quem?.avatarUrl ?? null,
    likedByMe: musica.likedByMe,
    likeCount: musica.likeCount,
    commentCount: musica.commentCount,
  };
}
