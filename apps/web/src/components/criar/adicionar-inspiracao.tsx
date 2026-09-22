'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, type Playlist } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { BuscaIcone } from './icones';
import { Modal } from './modal';

export interface Inspiracao {
  id: string;
  name: string;
  songCount: number;
}

/**
 * "+ Inspiração": escolhe a playlist cujos estilos entram no prompt.
 *
 * Só playlists do próprio usuário: é onde ele já curou o que quer ouvir. A
 * contagem ao lado avisa quando a playlist está vazia, porque uma inspiração
 * sem faixas não acrescenta nada ao pedido.
 */
export function AdicionarInspiracao({
  aoFechar,
  aoEscolher,
}: {
  aoFechar: () => void;
  aoEscolher: (p: Inspiracao) => void;
}) {
  const { t } = useI18n();
  const [itens, setItens] = useState<Playlist[] | null>(null);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    void api
      .get<Playlist[]>('/playlists')
      .then(setItens)
      .catch(() => setItens([]));
  }, []);

  const filtradas = (itens ?? []).filter((p) =>
    p.name.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  return (
    <Modal titulo={`+ ${t('criar.inspiracao')}`} aoFechar={aoFechar} largura="max-w-lg">
      <div className="space-y-3 p-4">
        <p className="text-sm text-texto-suave">{t('criar.inspiracaoDica')}</p>

        <div className="flex items-center gap-2 rounded-full border border-borda bg-fundo px-3.5 py-2">
          <BuscaIcone tamanho={15} className="shrink-0 text-texto-fraco" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t('playlists.nome')}
            aria-label={t('playlists.nome')}
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-texto-fraco"
          />
        </div>

        {itens === null ? (
          <p className="py-8 text-center text-sm text-texto-fraco pulsando">{t('geral.carregando')}</p>
        ) : itens.length === 0 ? (
          <p className="py-8 text-center text-sm text-texto-suave">
            {t('criar.semPlaylists')}{' '}
            <Link href="/playlists" className="text-acento hover:underline">
              {t('nav.playlists')}
            </Link>
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
            {filtradas.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={p.songCount === 0}
                  onClick={() => {
                    aoEscolher({ id: p.id, name: p.name, songCount: p.songCount });
                    aoFechar();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-superficie-alta disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg gradiente-acento text-base font-black text-white/90"
                    aria-hidden
                  >
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-texto-fraco">
                      {p.songCount} {t(p.songCount === 1 ? 'playlists.musica' : 'playlists.musicas')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
