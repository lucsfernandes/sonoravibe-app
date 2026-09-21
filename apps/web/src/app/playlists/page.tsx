'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Playlist } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/**
 * Playlists do usuário.
 *
 * A criação fica num formulário sempre visível, e não atrás de um modal: a
 * primeira visita a esta tela é quase sempre com zero playlists, e esconder a
 * única ação útil atrás de um clique a mais não ajuda ninguém.
 */
export default function Playlists() {
  const { t } = useI18n();
  const { usuario, carregando } = useSessao();

  const [itens, setItens] = useState<Playlist[] | null>(null);
  const [nome, setNome] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    if (!usuario) return;
    try {
      setItens(await api.get<Playlist[]>('/playlists'));
    } catch {
      setItens([]);
    }
  }, [usuario]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  if (carregando) return <p className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</p>;

  if (!usuario) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-texto-suave">{t('auth.comeceDica')}</p>
        <Link
          href="/entrar"
          className="mt-5 inline-block rounded-xl gradiente-acento px-6 py-3 text-sm font-semibold text-white"
        >
          {t('auth.criarConta')}
        </Link>
      </div>
    );
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo || criando) return;

    setCriando(true);
    setErro(null);
    try {
      await api.post('/playlists', { name: limpo, isPublic: false });
      setNome('');
      await buscar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">{t('playlists.titulo')}</h1>

      <form onSubmit={criar} className="mt-5 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="nova-playlist">
          {t('playlists.nome')}
        </label>
        <input
          id="nova-playlist"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={t('playlists.nome')}
          maxLength={120}
          className="min-w-0 flex-1 rounded-xl border border-borda bg-superficie px-3 py-2.5 text-sm outline-none placeholder:text-texto-fraco focus:border-texto-fraco"
        />
        <button
          type="submit"
          disabled={!nome.trim() || criando}
          className="shrink-0 rounded-xl gradiente-acento px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {criando ? t('geral.enviando') : t('geral.criar')}
        </button>
      </form>

      {erro && (
        <p role="alert" className="mt-3 text-sm text-perigo">
          {erro}
        </p>
      )}

      {itens === null ? (
        <p className="mt-8 text-sm text-texto-fraco pulsando">{t('geral.carregando')}</p>
      ) : itens.length === 0 ? (
        <p className="mt-10 text-sm text-texto-suave">{t('playlists.vazia')}</p>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {itens.map((p) => (
            <li key={p.id}>
              <Link
                href={`/playlists/${p.id}`}
                className="card flex items-center gap-3 p-4 transition-colors hover:border-texto-fraco/40"
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg gradiente-acento text-lg font-black text-white/90"
                  aria-hidden
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block text-xs text-texto-fraco">
                    {p.songCount} {t(p.songCount === 1 ? 'playlists.musica' : 'playlists.musicas')}
                    {p.isPublic && ` · ${t('lib.publicas')}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
