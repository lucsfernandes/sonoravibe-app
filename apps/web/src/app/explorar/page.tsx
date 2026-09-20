'use client';

import { useEffect, useState } from 'react';
import { CartaoMusica } from '@/components/musica/cartao';
import { api, type ItemExplore } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

type Aba = 'trending' | 'new' | 'following';

export default function Explorar() {
  const { t } = useI18n();
  const { usuario } = useSessao();
  const [aba, setAba] = useState<Aba>('trending');
  const [itens, setItens] = useState<ItemExplore[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    void api
      .get<ItemExplore[]>(`/explore?tab=${aba}&limit=36`)
      .then(setItens)
      .catch(() => setItens([]))
      .finally(() => setCarregando(false));
  }, [aba]);

  const abas: { valor: Aba; rotulo: string }[] = [
    { valor: 'trending', rotulo: t('explorar.emAlta') },
    { valor: 'new', rotulo: t('explorar.novas') },
    ...(usuario ? [{ valor: 'following' as const, rotulo: t('explorar.seguindo') }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">{t('explorar.titulo')}</h1>

      <div className="mt-5 flex gap-1 border-b border-borda" role="tablist">
        {abas.map((a) => (
          <button
            key={a.valor}
            type="button"
            role="tab"
            aria-selected={aba === a.valor}
            onClick={() => setAba(a.valor)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              aba === a.valor
                ? 'border-acento text-texto'
                : 'border-transparent text-texto-suave hover:text-texto'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      {carregando ? (
        <p className="py-20 text-center text-sm text-texto-suave">{t('geral.carregando')}</p>
      ) : itens.length === 0 ? (
        <p className="py-20 text-center text-sm text-texto-suave">
          {aba === 'following' ? t('explorar.seguindoVazio') : t('lib.vazia')}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {itens.map((m) => (
            <CartaoMusica key={m.id} musica={m} fila={itens} autor={m.author} href={`/musica/${m.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
