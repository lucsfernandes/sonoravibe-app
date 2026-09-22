'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, type Locale } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';
import { Avatar } from './avatar';
import { EditarPerfil } from './editar-perfil';

/**
 * O usuário na barra lateral: foto, primeiro nome e o botão de três pontos
 * que abre o submenu (ver perfil, editar, créditos, idioma, sair).
 *
 * Com o menu recolhido sobra só a foto, e clicar nela abre o mesmo submenu,
 * para o lado. Ele abre para cima porque o bloco fica no pé da barra: para
 * baixo não haveria tela.
 */
export function MenuUsuario({ recolhido }: { recolhido: boolean }) {
  const { t, locale } = useI18n();
  const { usuario, perfil, saldo } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicar(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  if (!usuario) return null;

  const nome = perfil?.displayName || usuario.name;
  const primeiroNome = nome.trim().split(/\s+/)[0] || nome;
  const foto = perfil?.avatarUrl ?? usuario.image ?? null;

  const submenu = (
    <div
      role="menu"
      aria-label={t('nav.menuUsuario')}
      className={`absolute z-40 w-60 rounded-xl border border-borda bg-superficie-alta p-1.5 shadow-xl ${
        recolhido ? 'bottom-0 left-full ml-2' : 'bottom-full left-0 mb-2 w-full'
      }`}
    >
      <ItensMenuUsuario
        aoEditar={() => {
          setAberto(false);
          setEditando(true);
        }}
        aoFechar={() => setAberto(false)}
      />
    </div>
  );

  return (
    <div ref={caixa} className="relative">
      {recolhido ? (
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={aberto}
          aria-label={t('nav.menuUsuario')}
          title={nome}
          className={`mx-auto flex rounded-full ring-2 ring-transparent transition-shadow hover:ring-borda ${
            aberto ? 'ring-acento' : ''
          }`}
        >
          <Avatar url={foto} nome={nome} tamanho={36} />
        </button>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-borda bg-superficie py-2 pl-2.5 pr-1.5">
          <Avatar url={foto} nome={nome} tamanho={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={nome}>
              {primeiroNome}
            </p>
            {saldo && (
              <p className="truncate text-xs text-texto-suave">
                {saldo.balance.total.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US')} {t('criar.custo')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={aberto}
            aria-label={t('nav.menuUsuario')}
            title={t('nav.menuUsuario')}
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-texto-suave transition-colors hover:bg-superficie-alta hover:text-texto ${
              aberto ? 'bg-superficie-alta text-texto' : ''
            }`}
          >
            <PontosVerticaisIcone />
          </button>
        </div>
      )}

      {aberto && submenu}
      {editando && <EditarPerfil aoFechar={() => setEditando(false)} />}
    </div>
  );
}

/**
 * Os itens do submenu, também usados no painel da barra inferior do celular.
 * O cabeçalho repete nome e e-mail: com o menu recolhido é a única pista de
 * qual conta está logada.
 */
export function ItensMenuUsuario({
  aoEditar,
  aoFechar,
}: {
  aoEditar: () => void;
  aoFechar: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const { usuario, perfil, sair } = useSessao();
  if (!usuario) return null;

  const nome = perfil?.displayName || usuario.name;
  const foto = perfil?.avatarUrl ?? usuario.image ?? null;

  return (
    <>
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar url={foto} nome={nome} tamanho={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{nome}</p>
          <p className="truncate text-xs text-texto-fraco">{usuario.email}</p>
        </div>
      </div>
      <div className="my-1 border-t border-borda" />

      {perfil?.handle && (
        <Item href={`/u/${perfil.handle}`} onClick={aoFechar} icone={<PessoaIcone />}>
          {t('perfil.ver')}
        </Item>
      )}
      <Item onClick={aoEditar} icone={<LapisIcone />}>
        {t('perfil.editar')}
      </Item>
      <Item href="/creditos" onClick={aoFechar} icone={<MoedaIcone />}>
        {t('creditos.titulo')}
      </Item>

      <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-sm text-texto-suave">
        <span>{t('nav.idioma')}</span>
        <div className="flex rounded-lg border border-borda p-0.5" role="group" aria-label={t('nav.idioma')}>
          {(['pt', 'en'] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => setLocale(opcao as Locale)}
              aria-pressed={locale === opcao}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
                locale === opcao ? 'bg-superficie text-texto' : 'text-texto-fraco hover:text-texto'
              }`}
            >
              {opcao === 'pt' ? 'PT-BR' : 'EN'}
            </button>
          ))}
        </div>
      </div>

      <div className="my-1 border-t border-borda" />
      <Item
        onClick={() => {
          aoFechar();
          void sair();
        }}
        icone={<SairIcone />}
        perigo
      >
        {t('nav.sair')}
      </Item>
    </>
  );
}

function Item({
  href,
  onClick,
  icone,
  perigo,
  children,
}: {
  href?: string;
  onClick: () => void;
  icone: ReactNode;
  perigo?: boolean;
  children: ReactNode;
}) {
  const classe = `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-superficie ${
    perigo ? 'text-perigo' : 'text-texto-suave hover:text-texto'
  }`;
  if (href) {
    return (
      <Link href={href} role="menuitem" onClick={onClick} className={classe}>
        <span className="shrink-0">{icone}</span>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={onClick} className={classe}>
      <span className="shrink-0">{icone}</span>
      {children}
    </button>
  );
}

function PontosVerticaisIcone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="6" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="18" r="1.6" />
    </svg>
  );
}

function PessoaIcone() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

function LapisIcone() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="m13.5 6.5 3 3" />
    </svg>
  );
}

function MoedaIcone() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h3.75a2 2 0 0 1 0 4H9.5h4.25a2 2 0 0 1 0 4H10" />
    </svg>
  );
}

function SairIcone() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
      <path d="M14 8l4 4-4 4M18 12H9" />
    </svg>
  );
}
