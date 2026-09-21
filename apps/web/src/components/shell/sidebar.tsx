'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useI18n, type Locale } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/**
 * Navegação lateral.
 *
 * Em telas estreitas vira uma barra inferior: a lateral fixa do desktop comeria
 * metade da largura de um celular, e as cinco seções principais cabem numa
 * barra de ícones.
 */

const ITENS = [
  { href: '/', chave: 'nav.inicio', icone: CasaIcone, soDesktop: false },
  { href: '/explorar', chave: 'nav.explorar', icone: BussolaIcone, soDesktop: false },
  { href: '/criar', chave: 'nav.criar', icone: NotaIcone, soDesktop: false },
  { href: '/biblioteca', chave: 'nav.biblioteca', icone: BibliotecaIcone, soDesktop: false },
  // A barra inferior do celular já carrega cinco alvos mais o botão de conta.
  // Um sétimo deixaria cada um com menos de 50px numa tela de 390 — abaixo do
  // mínimo confortável para o dedo. No celular, as playlists se alcançam pela
  // biblioteca.
  { href: '/playlists', chave: 'nav.playlists', icone: ListaIcone, soDesktop: true },
  { href: '/creditos', chave: 'nav.creditos', icone: MoedaIcone, soDesktop: false },
] as const;

export function Sidebar() {
  const { t, locale, setLocale } = useI18n();
  const { usuario, saldo, sair } = useSessao();
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);

  const ehAtivo = (href: string) =>
    href === '/' ? caminho === '/' : caminho.startsWith(href);

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-borda bg-fundo px-3 py-5 md:flex">
        <Link href="/" className="mb-7 px-3 text-2xl font-black tracking-tight">
          SONORA
        </Link>

        <nav className="flex flex-col gap-1">
          {ITENS.map(({ href, chave, icone: Icone }) => (
            <Link
              key={href}
              href={href}
              aria-current={ehAtivo(href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                ehAtivo(href)
                  ? 'bg-superficie-alta text-texto'
                  : 'text-texto-suave hover:bg-superficie hover:text-texto'
              }`}
            >
              <Icone />
              {t(chave)}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <SeletorIdioma locale={locale} setLocale={setLocale} />

          {usuario ? (
            <div className="rounded-xl border border-borda bg-superficie p-3">
              <p className="truncate text-sm font-medium">{usuario.name}</p>
              {saldo && (
                <p className="mt-0.5 text-xs text-texto-suave">
                  {saldo.balance.total.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US')}{' '}
                  {t('criar.custo')}
                </p>
              )}
              <button
                type="button"
                onClick={() => void sair()}
                className="mt-2 text-xs text-texto-fraco transition-colors hover:text-texto"
              >
                {t('nav.sair')}
              </button>
            </div>
          ) : (
            <Link
              href="/entrar"
              className="rounded-xl gradiente-acento px-4 py-2.5 text-center text-sm font-semibold text-white"
            >
              {t('nav.entrar')}
            </Link>
          )}

          {usuario && saldo?.planCode === 'free' && (
            <Link
              href="/creditos"
              className="rounded-xl border border-acento/40 px-4 py-2.5 text-center text-sm font-semibold text-acento transition-colors hover:bg-acento-suave"
            >
              {t('nav.upgrade')}
            </Link>
          )}
        </div>
      </aside>

      {/* Celular: barra inferior, acima do player */}
      <nav className="fixed inset-x-0 bottom-20 z-30 flex items-center justify-around border-t border-borda bg-fundo/95 px-2 py-2 backdrop-blur md:hidden">
        {ITENS.filter((i) => !i.soDesktop).map(({ href, chave, icone: Icone }) => (
          <Link
            key={href}
            href={href}
            aria-current={ehAtivo(href) ? 'page' : undefined}
            className={`flex min-w-16 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] ${
              ehAtivo(href) ? 'text-acento' : 'text-texto-fraco'
            }`}
          >
            <Icone />
            {t(chave)}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMenuAberto((v) => !v)}
          aria-expanded={menuAberto}
          aria-label={t('geral.fechar')}
          className="flex min-w-16 flex-col items-center gap-1 px-2 py-1.5 text-[10px] text-texto-fraco"
        >
          <PessoaIcone />
          {usuario ? usuario.name.split(' ')[0] : t('nav.entrar')}
        </button>
      </nav>

      {menuAberto && (
        <div className="fixed inset-x-0 bottom-36 z-40 mx-3 rounded-xl border border-borda bg-superficie p-3 md:hidden">
          <SeletorIdioma locale={locale} setLocale={setLocale} />
          {usuario ? (
            <button
              type="button"
              onClick={() => void sair()}
              className="mt-3 w-full rounded-lg border border-borda py-2 text-sm"
            >
              {t('nav.sair')}
            </button>
          ) : (
            <Link
              href="/entrar"
              onClick={() => setMenuAberto(false)}
              className="mt-3 block rounded-lg gradiente-acento py-2 text-center text-sm font-semibold text-white"
            >
              {t('nav.entrar')}
            </Link>
          )}
        </div>
      )}
    </>
  );
}

function SeletorIdioma({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
}) {
  return (
    <div className="flex rounded-lg border border-borda p-0.5" role="group" aria-label="Idioma">
      {(['pt', 'en'] as const).map((opcao) => (
        <button
          key={opcao}
          type="button"
          onClick={() => setLocale(opcao)}
          aria-pressed={locale === opcao}
          className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
            locale === opcao ? 'bg-superficie-alta text-texto' : 'text-texto-fraco'
          }`}
        >
          {opcao === 'pt' ? 'PT-BR' : 'EN'}
        </button>
      ))}
    </div>
  );
}

/* Ícones em SVG inline: cinco traços simples não justificam uma dependência de
   biblioteca de ícones, que traria centenas de KB para usar meia dúzia. */

function CasaIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    </svg>
  );
}

function BussolaIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" strokeLinejoin="round" />
    </svg>
  );
}

function NotaIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M9 18V5l11-2v13" strokeLinejoin="round" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </svg>
  );
}

function BibliotecaIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 5v14M9 5v14M14 6l5 13" strokeLinecap="round" />
    </svg>
  );
}

function MoedaIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h3.75a2 2 0 0 1 0 4H9.5h4.25a2 2 0 0 1 0 4H10" strokeLinecap="round" />
    </svg>
  );
}

function PessoaIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  );
}

function ListaIcone() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 6h11M4 12h11M4 18h7" />
      <circle cx="18" cy="17" r="3" />
      <path d="M21 17V8l-3 1" />
    </svg>
  );
}
