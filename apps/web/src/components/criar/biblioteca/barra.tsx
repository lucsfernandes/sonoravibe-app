'use client';

import { FILTROS_STATUS, FILTROS_TIPO, FILTROS_VOZ, ORDENS, type Ordem } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import {
  BuscaIcone,
  FunilIcone,
  GradeIcone,
  ListaIcone,
  OndaIcone,
  OrdenarIcone,
  SetaBaixoIcone,
  SetaDireitaIcone,
  SetaEsquerdaIcone,
} from '../icones';
import { ItemMenu, MenuSuspenso } from '../menu-suspenso';

export type ModoBiblioteca = 'lista' | 'onda' | 'grade';
export type Pilula = 'all' | 'liked' | 'public' | 'uploads';

export interface Filtros {
  kind: (typeof FILTROS_TIPO)[number];
  vocals: (typeof FILTROS_VOZ)[number];
  status: (typeof FILTROS_STATUS)[number];
}

export const FILTROS_PADRAO: Filtros = { kind: 'all', vocals: 'all', status: 'all' };

/** Quantos filtros estão fora do padrão: é o número entre parênteses. */
export function filtrosAtivos(f: Filtros): number {
  return (Object.keys(FILTROS_PADRAO) as (keyof Filtros)[]).filter((k) => f[k] !== 'all').length;
}

/**
 * A barra de ferramentas da biblioteca, na ordem da referência: busca,
 * Filtros (n), ordenação, modo de visualização, as pílulas de atalho e a
 * paginação.
 */
export function BarraBiblioteca({
  busca,
  aoBuscar,
  filtros,
  aoFiltrar,
  ordem,
  aoOrdenar,
  modo,
  aoMudarModo,
  pilula,
  aoMudarPilula,
  pagina,
  totalPaginas,
  aoMudarPagina,
}: {
  busca: string;
  aoBuscar: (v: string) => void;
  filtros: Filtros;
  aoFiltrar: (f: Filtros) => void;
  ordem: Ordem;
  aoOrdenar: (o: Ordem) => void;
  modo: ModoBiblioteca;
  aoMudarModo: (m: ModoBiblioteca) => void;
  pilula: Pilula;
  aoMudarPilula: (p: Pilula) => void;
  pagina: number;
  totalPaginas: number;
  aoMudarPagina: (p: number) => void;
}) {
  const { t } = useI18n();
  const ativos = filtrosAtivos(filtros);

  const iconeModo = { lista: ListaIcone, onda: OndaIcone, grade: GradeIcone }[modo];
  const IconeModo = iconeModo;

  const pilulas: { valor: Pilula; rotulo: string }[] = [
    { valor: 'liked', rotulo: t('lib.curtidas') },
    { valor: 'public', rotulo: t('lib.publicas') },
    { valor: 'uploads', rotulo: t('lib.uploads') },
  ];

  const botao =
    'flex h-10 shrink-0 items-center gap-2 rounded-full border border-borda bg-superficie px-4 text-sm font-medium transition-colors hover:border-texto-fraco';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2.5 rounded-full border border-borda bg-superficie px-4 transition-colors focus-within:border-texto-fraco">
        <BuscaIcone tamanho={16} className="shrink-0 text-texto-fraco" />
        <span className="sr-only">{t('lib.buscar')}</span>
        <input
          type="search"
          value={busca}
          onChange={(e) => aoBuscar(e.target.value)}
          placeholder={t('lib.buscar')}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-texto-fraco"
        />
      </label>

      <MenuSuspenso
        largura="w-72"
        gatilho={(aberto) => (
          <button type="button" aria-expanded={aberto} className={`${botao} ${ativos > 0 ? 'text-texto' : ''}`}>
            <FunilIcone tamanho={15} />
            {t('lib.filtros')}
            {ativos > 0 && ` (${ativos})`}
            <SetaBaixoIcone tamanho={14} className="text-texto-fraco" />
          </button>
        )}
      >
        {() => (
          <div className="space-y-3 p-2">
            <GrupoFiltro
              titulo={t('lib.tipo')}
              opcoes={FILTROS_TIPO.map((v) => ({ valor: v, rotulo: t(`lib.tipo.${v}`) }))}
              valor={filtros.kind}
              onChange={(kind) => aoFiltrar({ ...filtros, kind })}
            />
            <GrupoFiltro
              titulo={t('lib.voz')}
              opcoes={FILTROS_VOZ.map((v) => ({ valor: v, rotulo: t(`lib.voz.${v}`) }))}
              valor={filtros.vocals}
              onChange={(vocals) => aoFiltrar({ ...filtros, vocals })}
            />
            <GrupoFiltro
              titulo={t('lib.status')}
              opcoes={FILTROS_STATUS.map((v) => ({ valor: v, rotulo: t(`lib.status.${v}`) }))}
              valor={filtros.status}
              onChange={(status) => aoFiltrar({ ...filtros, status })}
            />
            {ativos > 0 && (
              <button
                type="button"
                onClick={() => aoFiltrar(FILTROS_PADRAO)}
                className="text-xs text-texto-suave hover:text-texto"
              >
                {t('lib.limparFiltros')}
              </button>
            )}
          </div>
        )}
      </MenuSuspenso>

      <MenuSuspenso
        largura="w-48"
        gatilho={(aberto) => (
          <button
            type="button"
            aria-expanded={aberto}
            aria-label={`${t('lib.ordenar')}: ${t(`lib.ordem.${ordem}`)}`}
            className={botao}
          >
            <OrdenarIcone tamanho={15} />
            {t(`lib.ordem.${ordem}`)}
            <SetaBaixoIcone tamanho={14} className="text-texto-fraco" />
          </button>
        )}
      >
        {(fechar) =>
          ORDENS.map((o) => (
            <ItemMenu
              key={o}
              ativo={ordem === o}
              onClick={() => {
                aoOrdenar(o);
                fechar();
              }}
            >
              {t(`lib.ordem.${o}`)}
            </ItemMenu>
          ))
        }
      </MenuSuspenso>

      <MenuSuspenso
        largura="w-44"
        gatilho={(aberto) => (
          <button
            type="button"
            aria-expanded={aberto}
            aria-label={`${t('visual.titulo')}: ${t(`lib.modo.${modo}`)}`}
            className={botao}
          >
            <IconeModo tamanho={15} />
            {t(`lib.modo.${modo}`)}
            <SetaBaixoIcone tamanho={14} className="text-texto-fraco" />
          </button>
        )}
      >
        {(fechar) =>
          (['lista', 'onda', 'grade'] as const).map((m) => {
            const Icone = { lista: ListaIcone, onda: OndaIcone, grade: GradeIcone }[m];
            return (
              <ItemMenu
                key={m}
                ativo={modo === m}
                icone={<Icone tamanho={15} />}
                onClick={() => {
                  aoMudarModo(m);
                  fechar();
                }}
              >
                {t(`lib.modo.${m}`)}
              </ItemMenu>
            );
          })
        }
      </MenuSuspenso>

      {pilulas.map((p) => {
        const ativa = pilula === p.valor;
        return (
          <button
            key={p.valor}
            type="button"
            aria-pressed={ativa}
            onClick={() => aoMudarPilula(ativa ? 'all' : p.valor)}
            className={`h-10 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors ${
              ativa
                ? 'border-acento bg-acento-suave text-acento'
                : 'border-borda bg-superficie hover:border-texto-fraco'
            }`}
          >
            {p.rotulo}
          </button>
        );
      })}

      <nav className="ml-auto flex items-center gap-1.5" aria-label={t('lib.pagina')}>
        <button
          type="button"
          onClick={() => aoMudarPagina(pagina - 1)}
          disabled={pagina <= 1}
          aria-label={t('lib.anterior')}
          className="flex size-9 items-center justify-center rounded-full border border-borda bg-superficie text-texto-suave transition-colors hover:text-texto disabled:cursor-not-allowed disabled:opacity-35"
        >
          <SetaEsquerdaIcone tamanho={14} />
        </button>
        <span
          className="flex h-9 min-w-[52px] items-center justify-center rounded-full border border-borda bg-superficie px-3 text-sm font-medium tabular-nums"
          aria-current="page"
          title={`${t('lib.pagina')} ${pagina} / ${totalPaginas}`}
        >
          {pagina}
        </span>
        <button
          type="button"
          onClick={() => aoMudarPagina(pagina + 1)}
          disabled={pagina >= totalPaginas}
          aria-label={t('lib.proxima')}
          className="flex size-9 items-center justify-center rounded-full border border-borda bg-superficie text-texto-suave transition-colors hover:text-texto disabled:cursor-not-allowed disabled:opacity-35"
        >
          <SetaDireitaIcone tamanho={14} />
        </button>
      </nav>
    </div>
  );
}

function GrupoFiltro<T extends string>({
  titulo,
  opcoes,
  valor,
  onChange,
}: {
  titulo: string;
  opcoes: { valor: T; rotulo: string }[];
  valor: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-texto-fraco">{titulo}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={titulo}>
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={valor === o.valor}
            onClick={() => onChange(o.valor)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              valor === o.valor
                ? 'border-acento bg-acento-suave text-acento'
                : 'border-borda text-texto-suave hover:text-texto'
            }`}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
