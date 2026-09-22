'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CartaoMusica } from '@/components/musica/cartao';
import { ApiError, api, type Musica, type Ordem, type Pagina, type Workspace } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
import { useAoConcluirGeracao } from '@/lib/progresso';
import { useSessao } from '@/lib/sessao';
import { LapisIcone, SetaDireitaIcone } from '../icones';
import { ItemMenu, MenuSuspenso } from '../menu-suspenso';
import {
  BarraBiblioteca,
  FILTROS_PADRAO,
  type Filtros,
  type ModoBiblioteca,
  type Pilula,
} from './barra';
import { LinhaBiblioteca } from './linha';

const CHAVE_MODO = 'sonora_visualizacao_criar';
const POR_PAGINA = 20;

/**
 * A biblioteca ao lado do painel de criação: o que já foi feito, com busca,
 * filtros, ordem, três modos de ver, atalhos e páginas numeradas.
 *
 * A lista recarrega sozinha em três momentos: quando uma geração entra na
 * fila (`versao` muda), quando uma termina (SSE) e quando o worker acaba de
 * calcular uma forma de onda que a tela pediu.
 */
export function BibliotecaCriar({
  versao,
  aoUsarReferencia,
}: {
  /** Incrementado pela página a cada geração enfileirada. */
  versao: number;
  aoUsarReferencia: (m: Musica) => void;
}) {
  const { t, locale } = useI18n();
  const { usuario } = useSessao();

  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_PADRAO);
  const [pilula, setPilula] = useState<Pilula>('all');
  const [ordem, setOrdem] = useState<Ordem>('newest');
  const [modo, setModo] = useState<ModoBiblioteca>('lista');
  const [pagina, setPagina] = useState(1);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');

  const [dados, setDados] = useState<Pagina<Musica> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const recarga = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A busca espera a pessoa parar de digitar: uma requisição por tecla
  // devolveria páginas fora de ordem.
  useEffect(() => {
    const id = setTimeout(() => setTermo(busca.trim()), 300);
    return () => clearTimeout(id);
  }, [busca]);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE_MODO);
      if (salvo === 'lista' || salvo === 'onda' || salvo === 'grade') setModo(salvo);
    } catch {
      // Janela anônima: segue no padrão.
    }
  }, []);

  function escolherModo(novo: ModoBiblioteca) {
    setModo(novo);
    try {
      localStorage.setItem(CHAVE_MODO, novo);
    } catch {
      // A preferência só não sobrevive ao recarregamento.
    }
  }

  const carregarWorkspaces = useCallback(async () => {
    try {
      setWorkspaces(await api.get<Workspace[]>('/workspaces'));
    } catch {
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    if (usuario) void carregarWorkspaces();
  }, [usuario, carregarWorkspaces]);

  const buscar = useCallback(async () => {
    if (!usuario) return;
    const params = new URLSearchParams({
      page: String(pagina),
      limit: String(POR_PAGINA),
      filter: pilula,
      sort: ordem,
      kind: filtros.kind,
      vocals: filtros.vocals,
      status: filtros.status,
    });
    if (termo) params.set('q', termo);
    if (workspace) params.set('workspaceId', workspace);
    try {
      const pg = await api.get<Pagina<Musica>>(`/songs?${params}`);
      setDados(pg);
      setErro(null);
      // Pediram a página 5 e agora só existem 3: volta para a última que existe.
      if (pg.pageCount > 0 && pagina > pg.pageCount) setPagina(pg.pageCount);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }, [usuario, pagina, pilula, ordem, filtros, termo, workspace, t]);

  useEffect(() => {
    void buscar();
  }, [buscar, versao]);

  useAoConcluirGeracao(() => void buscar());

  // Página 1 sempre que a pergunta muda; só a paginação anda de página.
  function redefinindoPagina<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPagina(1);
    };
  }

  /** A onda foi pedida ao worker: recarrega daqui a alguns segundos, uma vez só. */
  const agendarRecarga = useCallback(() => {
    if (recarga.current) return;
    recarga.current = setTimeout(() => {
      recarga.current = null;
      void buscar();
    }, 4000);
  }, [buscar]);

  useEffect(() => () => {
    if (recarga.current) clearTimeout(recarga.current);
  }, []);

  async function renomearWorkspace() {
    const limpo = nomeNovo.trim();
    setRenomeando(false);
    if (!workspace || !limpo) return;
    try {
      await api.patch(`/workspaces/${workspace}`, { name: limpo });
      await carregarWorkspaces();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }

  const atual = workspaces.find((w) => w.id === workspace) ?? null;
  const itens = dados?.items ?? [];
  const grupos = agruparPorDia(itens, locale, t);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[70px] shrink-0 items-center gap-2 border-b border-borda px-5 text-[15px] font-semibold">
        <MenuSuspenso
          largura="w-64"
          gatilho={(aberto) => (
            <button
              type="button"
              aria-expanded={aberto}
              className="rounded-lg bg-superficie-alta px-2.5 py-1 transition-colors hover:bg-borda"
            >
              {t('lib.workspaces')}
            </button>
          )}
        >
          {(fechar) => (
            <>
              <ItemMenu
                ativo={workspace === null}
                onClick={() => {
                  redefinindoPagina(setWorkspace)(null);
                  fechar();
                }}
              >
                {t('lib.todosWorkspaces')}
              </ItemMenu>
              {workspaces.map((w) => (
                <ItemMenu
                  key={w.id}
                  ativo={workspace === w.id}
                  onClick={() => {
                    redefinindoPagina(setWorkspace)(w.id);
                    fechar();
                  }}
                >
                  {w.name}
                  <span className="ml-1.5 text-xs tabular-nums text-texto-fraco">{w.songCount}</span>
                </ItemMenu>
              ))}
            </>
          )}
        </MenuSuspenso>
        <SetaDireitaIcone tamanho={14} className="text-texto-fraco" />
        {renomeando && atual ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void renomearWorkspace();
            }}
          >
            <input
              value={nomeNovo}
              onChange={(e) => setNomeNovo(e.target.value)}
              onBlur={() => void renomearWorkspace()}
              onKeyDown={(e) => e.key === 'Escape' && setRenomeando(false)}
              maxLength={100}
              autoFocus
              aria-label={t('lib.renomearWorkspace')}
              className="rounded-lg border border-borda bg-fundo px-2 py-1 text-[15px] font-semibold outline-none focus:border-acento"
            />
          </form>
        ) : (
          <span className="truncate">{atual?.name ?? t('lib.todosWorkspaces')}</span>
        )}
        {atual && !renomeando && (
          <button
            type="button"
            onClick={() => {
              setNomeNovo(atual.name);
              setRenomeando(true);
            }}
            aria-label={t('lib.renomearWorkspace')}
            title={t('lib.renomearWorkspace')}
            className="flex size-7 items-center justify-center rounded-md text-texto-fraco transition-colors hover:bg-superficie-alta hover:text-texto"
          >
            <LapisIcone tamanho={14} />
          </button>
        )}
      </div>

      <div className="shrink-0 px-5 py-3">
        <BarraBiblioteca
          busca={busca}
          aoBuscar={redefinindoPagina(setBusca)}
          filtros={filtros}
          aoFiltrar={redefinindoPagina(setFiltros)}
          ordem={ordem}
          aoOrdenar={redefinindoPagina(setOrdem)}
          modo={modo}
          aoMudarModo={escolherModo}
          pilula={pilula}
          aoMudarPilula={redefinindoPagina(setPilula)}
          pagina={pagina}
          totalPaginas={dados?.pageCount ?? 1}
          aoMudarPagina={(p) => setPagina(Math.max(1, Math.min(dados?.pageCount ?? 1, p)))}
        />
      </div>

      {/* `relative`: contém os elementos absolutos (rótulos `sr-only`, menus)
          dentro do recorte, senão eles esticam a rolagem da página. */}
      <div className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {erro && (
          <p role="alert" className="mb-3 rounded-xl border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-perigo">
            {erro}
          </p>
        )}

        {dados === null ? (
          <p className="py-20 text-center text-sm text-texto-fraco pulsando">{t('geral.carregando')}</p>
        ) : itens.length === 0 ? (
          <p className="py-20 text-center text-sm text-texto-suave">
            {termo || pilula !== 'all' || filtros !== FILTROS_PADRAO ? t('lib.nenhuma') : t('lib.vazia')}
          </p>
        ) : modo === 'grade' ? (
          grupos.map((g) => (
            <section key={g.rotulo} className="mb-6">
              <h2 className="mb-3 text-sm font-semibold text-texto-suave">{g.rotulo}</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {g.itens.map((m) => (
                  <CartaoMusica key={m.id} musica={m} fila={itens} href={`/musica/${m.id}`} />
                ))}
              </div>
            </section>
          ))
        ) : (
          grupos.map((g) => (
            <section key={g.rotulo} className="mb-4">
              <h2 className="mb-1 text-sm font-semibold text-texto-suave">{g.rotulo}</h2>
              <div className="flex flex-col">
                {g.itens.map((m) => (
                  <LinhaBiblioteca
                    key={m.id}
                    musica={m}
                    fila={itens}
                    modo={modo}
                    aoAtualizar={() => void buscar()}
                    aoUsarReferencia={aoUsarReferencia}
                    aoPedirOnda={agendarRecarga}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Agrupa por dia de criação: "Hoje", "Ontem", o dia da semana até uma semana
 * atrás, e a data por extenso depois disso. Só faz sentido na ordem
 * cronológica; nas outras ordens, a lista sai num grupo só, sem título.
 */
function agruparPorDia(
  itens: Musica[],
  locale: Locale,
  t: (c: string) => string,
): { rotulo: string; itens: Musica[] }[] {
  if (itens.length === 0) return [];
  const idioma = locale === 'pt' ? 'pt-BR' : 'en-US';
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const ordemCronologica = itens.every(
    (m, i) => i === 0 || new Date(itens[i - 1].createdAt).getTime() >= new Date(m.createdAt).getTime(),
  );
  if (!ordemCronologica) return [{ rotulo: '', itens }];

  const grupos = new Map<string, Musica[]>();
  for (const m of itens) {
    const dia = new Date(m.createdAt);
    dia.setHours(0, 0, 0, 0);
    const diff = Math.round((hoje.getTime() - dia.getTime()) / 86_400_000);
    let rotulo: string;
    if (diff <= 0) rotulo = t('lib.hoje');
    else if (diff === 1) rotulo = t('lib.ontem');
    else if (diff < 7) {
      const nome = new Intl.DateTimeFormat(idioma, { weekday: 'long' }).format(dia);
      rotulo = nome.charAt(0).toUpperCase() + nome.slice(1);
    } else {
      rotulo = new Intl.DateTimeFormat(idioma, {
        day: 'numeric',
        month: 'long',
        ...(dia.getFullYear() !== hoje.getFullYear() ? { year: 'numeric' } : {}),
      }).format(dia);
    }
    const lista = grupos.get(rotulo) ?? [];
    lista.push(m);
    grupos.set(rotulo, lista);
  }
  return [...grupos.entries()].map(([rotulo, lista]) => ({ rotulo, itens: lista }));
}
