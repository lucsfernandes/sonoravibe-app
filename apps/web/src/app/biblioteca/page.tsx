'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarraSelecao } from '@/components/biblioteca/barra-selecao';
import { Workspaces } from '@/components/biblioteca/workspaces';
import { CartaoMusica } from '@/components/musica/cartao';
import { api, type Musica, type Pagina } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useAoConcluirGeracao } from '@/lib/progresso';
import { useSessao } from '@/lib/sessao';

type Filtro = 'all' | 'public' | 'private' | 'liked';

export default function Biblioteca() {
  const { t } = useI18n();
  const { usuario, carregando } = useSessao();
  const [filtro, setFiltro] = useState<Filtro>('all');
  const [itens, setItens] = useState<Musica[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(null);

  const buscar = useCallback(
    async (proximo?: string) => {
      if (!usuario) return;
      setBuscando(true);
      try {
        const busca = new URLSearchParams({ limit: '24', filter: filtro });
        if (workspace) busca.set('workspaceId', workspace);
        if (proximo) busca.set('cursor', proximo);
        const pagina = await api.get<Pagina<Musica>>(`/songs?${busca}`);
        // Sem cursor é primeira página (troca de filtro): substitui em vez de
        // concatenar, senão o filtro novo apareceria empilhado no antigo.
        setItens((atual) => (proximo ? [...atual, ...pagina.items] : pagina.items));
        setCursor(pagina.nextCursor);
      } catch {
        setItens([]);
      } finally {
        setBuscando(false);
      }
    },
    [usuario, filtro, workspace],
  );

  useEffect(() => {
    void buscar();
  }, [buscar]);

  useAoConcluirGeracao(() => void buscar());

  if (carregando) return <p className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</p>;

  if (!usuario) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-texto-suave">{t('auth.comeceDica')}</p>
        <a
          href="/entrar"
          className="mt-5 inline-block rounded-xl gradiente-acento px-6 py-3 text-sm font-semibold text-white"
        >
          {t('auth.criarConta')}
        </a>
      </div>
    );
  }

  const filtros: { valor: Filtro; rotulo: string }[] = [
    { valor: 'all', rotulo: t('lib.todas') },
    { valor: 'public', rotulo: t('lib.publicas') },
    { valor: 'private', rotulo: t('lib.privadas') },
    { valor: 'liked', rotulo: t('lib.curtidas') },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">{t('lib.titulo')}</h1>

      <Workspaces
        selecionado={workspace}
        aoSelecionar={(id) => {
          setWorkspace(id);
          setSelecionadas([]);
        }}
      />

      <div className="mt-5 flex flex-wrap gap-2">
        {filtros.map((f) => (
          <button
            key={f.valor}
            type="button"
            aria-pressed={filtro === f.valor}
            onClick={() => {
              setFiltro(f.valor);
              // Sem isto, o lote levaria músicas que sumiram da tela ao trocar
              // de filtro — o usuário baixaria o que não consegue mais ver.
              setSelecionadas([]);
            }}
            className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
              filtro === f.valor
                ? 'border-acento bg-acento-suave text-acento'
                : 'border-borda text-texto-suave hover:text-texto'
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>

      {itens.length === 0 && !buscando ? (
        <div className="py-24 text-center">
          <p className="text-sm text-texto-suave">{t('lib.vazia')}</p>
          <a
            href="/criar"
            className="mt-5 inline-block rounded-xl gradiente-acento px-6 py-3 text-sm font-semibold text-white"
          >
            {t('lib.vaziaAcao')}
          </a>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {itens.map((m) => (
              <CartaoMusica
                key={m.id}
                musica={m}
                fila={itens}
                href={`/musica/${m.id}`}
                selecionada={selecionadas.includes(m.id)}
                aoSelecionar={(id) =>
                  setSelecionadas((atual) =>
                    atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
                  )
                }
              />
            ))}
          </div>

          {cursor && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => void buscar(cursor)}
                disabled={buscando}
                className="rounded-xl border border-borda px-6 py-2.5 text-sm text-texto-suave transition-colors hover:text-texto disabled:opacity-50"
              >
                {buscando ? t('geral.carregando') : t('lib.carregarMais')}
              </button>
            </div>
          )}
        </>
      )}

      <BarraSelecao selecionadas={selecionadas} aoLimpar={() => setSelecionadas([])} />
    </div>
  );
}
