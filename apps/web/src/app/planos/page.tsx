'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';
import { MODEL_CREDITS } from '@sonora/shared';

/**
 * Página de vendas dos planos. Pública, sem a casca do aplicativo.
 *
 * Antes, quem clicava em "Ver todos os planos" caía em `/creditos`, que mostra
 * a navegação lateral inteira com Biblioteca, Criar e Playlists. Um visitante
 * via um menu de portas trancadas antes de ter conta.
 *
 * Nada aqui é escrito à mão. Preço, créditos e recursos vêm de `GET /plans`,
 * que lê a tabela `plans`. É o que garante que esta página, a tela de créditos
 * e a validação da API digam o mesmo número, e que mudar um preço seja um
 * UPDATE e não um deploy.
 *
 * Sem contador regressivo, sem "últimas vagas", sem depoimento. Não existe lote
 * real aqui, e urgência inventada derruba anúncio no Meta além de violar o CDC.
 */

interface PlanoApi {
  code: string;
  name: string;
  priceBrl: number;
  monthlyCredits: number;
  cycleCredits?: number;
  cycleDays?: number;
  features: {
    maxDurationSeconds: number;
    stems: boolean;
    batchDownload: boolean;
    maxMode: boolean;
    commercialUse: boolean;
    maxConcurrentGenerations: number;
    downloadFormats: string[];
    mp3Quality: string;
  };
}

/**
 * Base da conta "quantas músicas o plano dá": o pedido mais barato (v1, até
 * 2 min). Versões e durações maiores custam mais (models.ts); o número aqui é o
 * teto, e o botão Criar mostra o custo real de cada pedido.
 */
const CREDITOS_POR_MUSICA = MODEL_CREDITS.v1[0];

export default function Planos() {
  const { t, locale } = useI18n();
  const { usuario } = useSessao();
  const [planos, setPlanos] = useState<PlanoApi[] | null>(null);

  useEffect(() => {
    void api
      .get<{ plans: PlanoApi[] }>('/plans')
      .then((r) => setPlanos(r.plans))
      .catch(() => setPlanos([]));
  }, []);

  const dinheiro = (v: number) =>
    new Intl.NumberFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
      style: 'currency',
      currency: 'BRL',
    }).format(v);

  const numero = (v: number) => v.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US');

  return (
    <div className="min-h-screen">
      <Topo usuario={Boolean(usuario)} />

      <main className="mx-auto max-w-6xl px-5 pb-24 sm:px-6">
        <section className="mx-auto max-w-2xl pt-16 text-center sm:pt-24">
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
            {t('planos.titulo')}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-texto-suave">
            {t('planos.sub')}
          </p>
        </section>

        {planos === null ? (
          <p className="mt-16 text-center text-sm text-texto-fraco pulsando">
            {t('geral.carregando')}
          </p>
        ) : planos.length === 0 ? (
          <p className="mt-16 text-center text-sm text-texto-suave">{t('planos.semCatalogo')}</p>
        ) : (
          <>
            <section className="mt-14 grid gap-5 lg:grid-cols-3">
              {planos.map((p) => (
                <Cartao
                  key={p.code}
                  plano={p}
                  dinheiro={dinheiro}
                  numero={numero}
                  logado={Boolean(usuario)}
                />
              ))}
            </section>

            <Comparativo planos={planos} numero={numero} />
          </>
        )}

        <Perguntas />

        <section className="mt-20 rounded-2xl border border-borda bg-superficie px-6 py-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight">{t('planos.fechoTitulo')}</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-texto-suave">{t('planos.fechoTexto')}</p>
          <Link
            href={usuario ? '/criar' : '/criar-conta'}
            className="mt-7 inline-block rounded-xl gradiente-acento px-8 py-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {usuario ? t('planos.irCriar') : t('planos.comecarGratis')}
          </Link>
        </section>
      </main>

      <footer className="border-t border-borda px-5 py-8 text-center text-xs text-texto-fraco">
        <p>Arcobatrox Technology LTDA · CNPJ 53.940.885/0001-75 · Florianópolis/SC</p>
        <p className="mt-2">
          <a href="/politica-de-privacidade.html" className="hover:text-texto-suave">
            {t('auth.politica')}
          </a>
        </p>
      </footer>
    </div>
  );
}

function Topo({ usuario }: { usuario: boolean }) {
  const { t } = useI18n();
  return (
    <header className="flex items-center justify-between border-b border-borda px-5 py-4 sm:px-8">
      <Link href="/" className="text-lg font-black tracking-tight">
        SONORA VIBE
      </Link>
      <nav className="flex items-center gap-3 text-sm">
        {usuario ? (
          <Link href="/criar" className="text-texto-suave hover:text-texto">
            {t('nav.criar')}
          </Link>
        ) : (
          <>
            <Link href="/entrar" className="text-texto-suave hover:text-texto">
              {t('auth.entrar')}
            </Link>
            <Link
              href="/criar-conta"
              className="rounded-lg gradiente-acento px-4 py-2 font-semibold text-white"
            >
              {t('auth.criarConta')}
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

function Cartao({
  plano,
  dinheiro,
  numero,
  logado,
}: {
  plano: PlanoApi;
  dinheiro: (v: number) => string;
  numero: (v: number) => string;
  logado: boolean;
}) {
  const { t } = useI18n();
  const gratis = plano.priceBrl === 0;
  const destaque = plano.code === 'pro';

  // Quantas músicas o plano dá por ciclo. É o número que importa para decidir,
  // e nenhum concorrente mostra: todos falam em créditos, que não significam
  // nada para quem está chegando.
  const creditos = gratis ? (plano.cycleCredits ?? 0) : plano.monthlyCredits;
  const musicas = Math.floor(creditos / CREDITOS_POR_MUSICA);
  const periodo = gratis
    ? plano.cycleDays === 1
      ? t('planos.porDia')
      : t('planos.porMes')
    : t('planos.porMes');

  // Preço por música: aritmética dos preços reais, não estimativa de mercado.
  const porMusica = !gratis && musicas > 0 ? plano.priceBrl / musicas : null;

  return (
    <article
      className={`relative flex flex-col rounded-2xl border p-7 ${
        destaque ? 'border-acento bg-acento-suave' : 'border-borda bg-superficie'
      }`}
    >
      {destaque && (
        <span className="absolute -top-3 left-7 rounded-full gradiente-acento px-3 py-1 text-[11px] font-semibold text-white">
          {t('planos.sugerido')}
        </span>
      )}

      <h2 className="text-lg font-bold">{plano.name}</h2>

      <p className="mt-3 text-4xl font-bold tracking-tight">
        {gratis ? t('planos.gratis') : dinheiro(plano.priceBrl)}
        {!gratis && (
          <span className="text-base font-normal text-texto-suave">{t('creditos.porMes')}</span>
        )}
      </p>

      <p className="mt-2 text-sm text-texto-suave">
        <strong className="text-texto">
          {numero(musicas)} {musicas === 1 ? t('planos.musica') : t('planos.musicas')}
        </strong>{' '}
        {periodo}
      </p>

      {porMusica !== null && (
        <p className="mt-1 text-xs text-texto-fraco">
          {t('planos.saiPor')} {dinheiro(porMusica)} {t('planos.porMusica')}
        </p>
      )}

      <ul className="mt-6 flex-1 space-y-2.5 text-sm text-texto-suave">
        <Item>
          {Math.round(plano.features.maxDurationSeconds / 60)} {t('creditos.minPorMusica')}
        </Item>
        <Item>
          {plano.features.downloadFormats.length === 1
            ? t('planos.soMp3')
            : `${plano.features.downloadFormats.length} ${t('planos.formatos')}`}
        </Item>
        <Item>{t('planos.baixarLote')}</Item>
        <Item ativo={plano.features.commercialUse}>{t('planos.usoComercial')}</Item>
        <Item ativo={plano.features.stems}>{t('musica.stems')}</Item>
        <Item>
          {plano.features.maxConcurrentGenerations}{' '}
          {plano.features.maxConcurrentGenerations === 1
            ? t('planos.simultanea')
            : t('planos.simultaneas')}
        </Item>
        {plano.features.maxMode && <Item>Max Mode</Item>}
      </ul>

      <Link
        href={
          gratis
            ? logado
              ? '/criar'
              : '/criar-conta'
            : `/assinar?plano=${plano.code}`
        }
        className={`mt-7 rounded-xl py-3 text-center text-sm font-semibold transition-opacity hover:opacity-90 ${
          destaque || !gratis
            ? 'gradiente-acento text-white'
            : 'border border-borda text-texto-suave'
        }`}
      >
        {gratis ? t('planos.comecarGratis') : `${t('creditos.assinar')} ${plano.name}`}
      </Link>
    </article>
  );
}

/** Item da lista. `ativo={false}` mostra o que o plano NÃO tem, em cinza. */
function Item({ children, ativo = true }: { children: React.ReactNode; ativo?: boolean }) {
  return (
    <li className={`flex items-start gap-2 ${ativo ? '' : 'text-texto-fraco line-through'}`}>
      <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${ativo ? 'gradiente-acento' : 'bg-texto-fraco'}`} />
      <span>{children}</span>
    </li>
  );
}

function Comparativo({
  planos,
  numero,
}: {
  planos: PlanoApi[];
  numero: (v: number) => string;
}) {
  const { t } = useI18n();

  const linhas = [
    {
      rotulo: t('planos.linhaMusicas'),
      valor: (p: PlanoApi) =>
        numero(
          Math.floor((p.priceBrl === 0 ? (p.cycleCredits ?? 0) : p.monthlyCredits) / CREDITOS_POR_MUSICA),
        ),
    },
    {
      rotulo: t('planos.linhaDuracao'),
      valor: (p: PlanoApi) => String(Math.round(p.features.maxDurationSeconds / 60)),
    },
    { rotulo: t('planos.linhaFormatos'), valor: (p: PlanoApi) => String(p.features.downloadFormats.length) },
    { rotulo: t('planos.usoComercial'), valor: (p: PlanoApi) => (p.features.commercialUse ? '✓' : '—') },
    { rotulo: t('musica.stems'), valor: (p: PlanoApi) => (p.features.stems ? '✓' : '—') },
    { rotulo: t('planos.baixarLote'), valor: (p: PlanoApi) => (p.features.batchDownload ? '✓' : '—') },
    {
      rotulo: t('planos.linhaSimultaneas'),
      valor: (p: PlanoApi) => String(p.features.maxConcurrentGenerations),
    },
  ];

  return (
    <section className="mt-20">
      <h2 className="text-center text-2xl font-bold tracking-tight">{t('planos.comparar')}</h2>
      {/* Tabela rola sozinha no celular em vez de espremer as colunas. */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-borda">
              <th scope="col" className="py-3 text-left font-medium text-texto-suave" />
              {planos.map((p) => (
                <th key={p.code} scope="col" className="py-3 text-center font-semibold">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.rotulo} className="border-b border-borda">
                <th scope="row" className="py-3 pr-4 text-left font-normal text-texto-suave">
                  {linha.rotulo}
                </th>
                {planos.map((p) => (
                  <td key={p.code} className="py-3 text-center tabular-nums">
                    {linha.valor(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Perguntas() {
  const { t } = useI18n();
  const itens = [1, 2, 3, 4, 5, 6] as const;

  return (
    <section className="mx-auto mt-20 max-w-2xl">
      <h2 className="text-center text-2xl font-bold tracking-tight">{t('planos.duvidas')}</h2>
      <div className="mt-8 divide-y divide-borda border-y border-borda">
        {itens.map((n) => (
          <details key={n} className="group py-4">
            <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-medium marker:content-['']">
              {t(`planos.p${n}`)}
              <span
                aria-hidden
                className="shrink-0 text-texto-fraco transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-texto-suave">{t(`planos.r${n}`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
