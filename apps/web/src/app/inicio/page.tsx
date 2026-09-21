'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CartaoMusica } from '@/components/musica/cartao';
import { api, type ItemExplore, type Musica, type Pagina } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/** Home: o campo de criação em destaque, depois o que está em alta e o que é seu. */
export default function Home() {
  const { t } = useI18n();
  const { usuario } = useSessao();
  const [descricao, setDescricao] = useState('');
  const [emAlta, setEmAlta] = useState<ItemExplore[]>([]);
  const [minhas, setMinhas] = useState<Musica[]>([]);

  useEffect(() => {
    void api.get<ItemExplore[]>('/explore?tab=trending&limit=12').then(setEmAlta).catch(() => setEmAlta([]));
  }, []);

  useEffect(() => {
    if (!usuario) return;
    void api
      .get<Pagina<Musica>>('/songs?limit=6')
      .then((p) => setMinhas(p.items))
      .catch(() => setMinhas([]));
  }, [usuario]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('home.titulo')}</h1>

        <form
          className="mt-7"
          onSubmit={(e) => {
            e.preventDefault();
            // A descrição viaja na URL para a página de criação já abrir preenchida.
            const destino = descricao.trim()
              ? `/criar?prompt=${encodeURIComponent(descricao.trim())}`
              : '/criar';
            window.location.href = destino;
          }}
        >
          <div className="card flex items-center gap-2 p-2">
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder={t('home.placeholder')}
              aria-label={t('home.placeholder')}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none placeholder:text-texto-fraco"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl gradiente-acento px-5 py-3 text-sm font-semibold text-white"
            >
              {t('criar.botao')}
            </button>
          </div>
        </form>
      </section>

      {minhas.length > 0 && (
        <Secao titulo={t('home.recentes')} verMais="/biblioteca">
          {minhas.map((m) => (
            <CartaoMusica key={m.id} musica={m} fila={minhas} />
          ))}
        </Secao>
      )}

      {emAlta.length > 0 && (
        <Secao titulo={t('home.destaques')} verMais="/explorar">
          {emAlta.map((m) => (
            <CartaoMusica key={m.id} musica={m} fila={emAlta} autor={m.author} />
          ))}
        </Secao>
      )}
    </div>
  );
}

function Secao({
  titulo,
  verMais,
  children,
}: {
  titulo: string;
  verMais: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{titulo}</h2>
        <Link href={verMais} className="text-sm text-texto-suave hover:text-texto">
          →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}
