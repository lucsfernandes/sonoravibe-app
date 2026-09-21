'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Musica, type PlaylistDetalhe } from '@/lib/api';
import { formatarDuracao, useI18n } from '@/lib/i18n';
import { paraFaixa, usePlayer, type FaixaTocando } from '@/lib/player';

/**
 * Uma playlist: tocar em sequência, reordenar e remover faixas.
 *
 * A reordenação é por botões de subir e descer, não por arrastar-e-soltar.
 * Arrastar exige uma biblioteca ou muito código de ponteiro, quebra no toque
 * com frequência e é inacessível pelo teclado; dois botões funcionam em tudo.
 *
 * A ordem nova vai inteira para o backend (`PATCH /playlists/:id/order`), que
 * é o formato que ele espera — mandar só o par trocado exigiria que os dois
 * lados concordassem sobre o estado anterior.
 */
export default function PaginaPlaylist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const router = useRouter();
  const { tocar } = usePlayer();

  const [playlist, setPlaylist] = useState<PlaylistDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setPlaylist(await api.get<PlaylistDetalhe>(`/playlists/${id}`));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }, [id, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <p className="p-8 text-sm text-perigo">{erro}</p>;
  if (!playlist) return <p className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</p>;

  const tocaveis = playlist.songs.filter((m) => m.status === 'complete' && m.audioUrl);

  function tocarDe(indice: number) {
    const fila = tocaveis
      .map((m) => paraFaixa(m))
      .filter((f): f is FaixaTocando => f !== null);
    if (fila[indice]) tocar(fila[indice], fila);
  }

  /** Move uma faixa e manda a ordem inteira. */
  async function mover(de: number, para: number) {
    if (!playlist || para < 0 || para >= playlist.songs.length || ocupado) return;

    const nova = [...playlist.songs];
    [nova[de], nova[para]] = [nova[para], nova[de]];

    // Reordena na tela antes da rede: a lista tem que acompanhar o clique, e o
    // recarregamento no fim corrige se o servidor discordar.
    setPlaylist({ ...playlist, songs: nova });
    setOcupado(true);
    try {
      await api.patch(`/playlists/${id}/order`, { songIds: nova.map((m) => m.id) });
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
      await carregar();
    } finally {
      setOcupado(false);
    }
  }

  async function remover(songId: string) {
    if (!playlist) return;
    const antes = playlist;
    setPlaylist({
      ...playlist,
      songs: playlist.songs.filter((m) => m.id !== songId),
      songCount: Math.max(0, playlist.songCount - 1),
    });
    try {
      await api.delete(`/playlists/${id}/songs/${songId}`);
    } catch (err) {
      setPlaylist(antes);
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }

  async function excluir() {
    setOcupado(true);
    try {
      await api.delete(`/playlists/${id}`);
      router.push('/playlists');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link href="/playlists" className="text-sm text-texto-suave hover:text-texto">
        ← {t('playlists.titulo')}
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{playlist.name}</h1>
          {playlist.description && (
            <p className="mt-1 text-sm text-texto-suave">{playlist.description}</p>
          )}
          <p className="mt-1 text-xs text-texto-fraco">
            {playlist.songCount}{' '}
            {t(playlist.songCount === 1 ? 'playlists.musica' : 'playlists.musicas')}
          </p>
        </div>

        <div className="flex gap-2">
          {tocaveis.length > 0 && (
            <button
              type="button"
              onClick={() => tocarDe(0)}
              className="rounded-xl gradiente-acento px-5 py-2.5 text-sm font-semibold text-white"
            >
              {t('playlists.tocarTudo')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void excluir()}
            disabled={ocupado}
            className="rounded-xl border border-borda px-4 py-2.5 text-sm text-texto-fraco transition-colors hover:border-perigo hover:text-perigo disabled:opacity-50"
          >
            {t('geral.excluir')}
          </button>
        </div>
      </div>

      {playlist.songs.length === 0 ? (
        <p className="mt-12 text-sm text-texto-suave">{t('playlists.semMusicas')}</p>
      ) : (
        <ol className="mt-8 divide-y divide-borda overflow-hidden rounded-xl border border-borda">
          {playlist.songs.map((m, i) => (
            <Faixa
              key={m.id}
              musica={m}
              posicao={i + 1}
              primeira={i === 0}
              ultima={i === playlist.songs.length - 1}
              ocupado={ocupado}
              aoTocar={() => {
                const indice = tocaveis.findIndex((x) => x.id === m.id);
                if (indice >= 0) tocarDe(indice);
              }}
              aoSubir={() => void mover(i, i - 1)}
              aoDescer={() => void mover(i, i + 1)}
              aoRemover={() => void remover(m.id)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function Faixa({
  musica,
  posicao,
  primeira,
  ultima,
  ocupado,
  aoTocar,
  aoSubir,
  aoDescer,
  aoRemover,
}: {
  musica: Musica;
  posicao: number;
  primeira: boolean;
  ultima: boolean;
  ocupado: boolean;
  aoTocar: () => void;
  aoSubir: () => void;
  aoDescer: () => void;
  aoRemover: () => void;
}) {
  const { t } = useI18n();
  const pronta = musica.status === 'complete' && Boolean(musica.audioUrl);

  return (
    <li className="flex items-center gap-3 bg-superficie px-3 py-2.5">
      <span className="w-6 shrink-0 text-center text-xs tabular-nums text-texto-fraco">
        {posicao}
      </span>

      <button
        type="button"
        onClick={aoTocar}
        disabled={!pronta}
        aria-label={`${t('musica.tocar')} ${musica.title}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-superficie-alta text-texto-suave transition-colors hover:text-texto disabled:opacity-40"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </button>

      <Link href={`/musica/${musica.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
        {musica.title}
      </Link>

      {musica.durationMs > 0 && (
        <span className="shrink-0 text-xs tabular-nums text-texto-fraco">
          {formatarDuracao(musica.durationMs)}
        </span>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        <BotaoMover direcao="subir" desabilitado={primeira || ocupado} onClick={aoSubir} />
        <BotaoMover direcao="descer" desabilitado={ultima || ocupado} onClick={aoDescer} />
        <button
          type="button"
          onClick={aoRemover}
          aria-label={`${t('playlists.remover')} ${musica.title}`}
          className="flex size-7 items-center justify-center rounded text-texto-fraco transition-colors hover:text-perigo"
        >
          ×
        </button>
      </div>
    </li>
  );
}

function BotaoMover({
  direcao,
  desabilitado,
  onClick,
}: {
  direcao: 'subir' | 'descer';
  desabilitado: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={t(direcao === 'subir' ? 'playlists.subir' : 'playlists.descer')}
      className="flex size-7 items-center justify-center rounded text-texto-fraco transition-colors hover:text-texto disabled:opacity-25"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={direcao === 'descer' ? 'rotate-180' : ''}
      >
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
  );
}
