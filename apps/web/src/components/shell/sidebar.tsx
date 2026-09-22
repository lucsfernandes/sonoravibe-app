'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';
import { Avatar } from './avatar';
import { EditarPerfil } from './editar-perfil';
import { ItensMenuUsuario, MenuUsuario } from './menu-usuario';

/**
 * Navegação lateral.
 *
 * Em telas estreitas vira uma barra inferior: a lateral fixa do desktop comeria
 * metade da largura de um celular, e as cinco seções principais cabem numa
 * barra de ícones.
 */

const CHAVE_RECOLHIDO = 'sonora_menu_recolhido';

const ITENS = [
  { href: '/inicio', chave: 'nav.inicio', icone: CasaIcone, soDesktop: false },
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
  const { t } = useI18n();
  const { usuario, saldo, perfil } = useSessao();
  const caminho = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);
  const [editandoPerfil, setEditandoPerfil] = useState(false);

  /**
   * Menu lateral recolhido, em ícones só.
   *
   * Começa aberto e lê a preferência depois da montagem, não durante. Ler o
   * localStorage no primeiro render faria o servidor renderizar aberto e o
   * cliente trocar para fechado, o que o React acusa como divergência de
   * hidratação — e o usuário vê o menu piscar.
   */
  const [recolhido, setRecolhido] = useState(false);

  useEffect(() => {
    try {
      setRecolhido(localStorage.getItem(CHAVE_RECOLHIDO) === '1');
    } catch {
      // Janela anônima ou cookies bloqueados: segue aberto, que é o padrão.
    }
  }, []);

  function alternarRecolhido() {
    setRecolhido((atual) => {
      const novo = !atual;
      try {
        localStorage.setItem(CHAVE_RECOLHIDO, novo ? '1' : '0');
      } catch {
        // A preferência só não sobrevive ao recarregamento.
      }
      return novo;
    });
  }

  const ehAtivo = (href: string) => caminho.startsWith(href);

  return (
    <>
      {/* Desktop. A altura desconta o player fixo: sem isso o bloco do usuário,
          no pé da barra, ficava escondido atrás dele enquanto uma faixa
          tocava. */}
      {/* `z-20`: a barra é sticky, o que cria um contexto de empilhamento
          próprio; sem um z-index nela, o submenu do usuário (que abre para o
          lado com o menu recolhido) ficava pintado por baixo do conteúdo. */}
      <aside
        className={`sticky top-0 z-20 hidden h-[calc(100vh-var(--altura-player))] shrink-0 flex-col border-r border-borda bg-fundo py-5 transition-[width] duration-200 md:flex ${
          recolhido ? 'w-[4.5rem] px-2' : 'w-60 px-3'
        }`}
      >
        {/* O logo leva ao site institucional, não ao feed: é a saída de quem
            quer reler a proposta, ver preços ou achar o contato. O caminho de
            volta ao aplicativo é o "Início" logo abaixo. */}
        <div className={`mb-7 flex items-center ${recolhido ? 'flex-col gap-3' : 'gap-2 px-3'}`}>
          <Link
            href="/"
            // `whitespace-nowrap` e um corpo menor: o botão de recolher tirou
            // largura da linha e "SONORA VIBE" quebrava em duas.
            className="flex items-center gap-2 whitespace-nowrap text-base font-black tracking-tight"
          >
            <MarcaIcone />
            {!recolhido && 'SONORA VIBE'}
          </Link>
          <button
            type="button"
            onClick={alternarRecolhido}
            aria-expanded={!recolhido}
            aria-label={recolhido ? t('nav.expandirMenu') : t('nav.recolherMenu')}
            title={recolhido ? t('nav.expandirMenu') : t('nav.recolherMenu')}
            className={`flex size-7 items-center justify-center rounded-lg text-texto-fraco transition-colors hover:bg-superficie hover:text-texto ${
              recolhido ? '' : 'ml-auto'
            }`}
          >
            <SetaRecolher apontandoParaDireita={recolhido} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {ITENS.map(({ href, chave, icone: Icone }) => (
            <Link
              key={href}
              href={href}
              aria-current={ehAtivo(href) ? 'page' : undefined}
              // `title` é o que dá nome ao item quando só o ícone aparece.
              title={recolhido ? t(chave) : undefined}
              className={`flex items-center rounded-xl py-2.5 text-sm font-medium transition-colors ${
                recolhido ? 'justify-center px-0' : 'gap-3 px-3'
              } ${
                ehAtivo(href)
                  ? 'bg-superficie-alta text-texto'
                  : 'text-texto-suave hover:bg-superficie hover:text-texto'
              }`}
            >
              <Icone />
              {!recolhido && t(chave)}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          {/* O convite ao Premier some com o menu recolhido: em 4.5rem viraria
              um alvo pequeno demais para acertar. */}
          {usuario && saldo?.planCode === 'free' && !recolhido && (
            <Link
              href="/creditos"
              className="rounded-xl border border-acento/40 px-4 py-2.5 text-center text-sm font-semibold text-acento transition-colors hover:bg-acento-suave"
            >
              {t('nav.upgrade')}
            </Link>
          )}

          {usuario ? (
            <MenuUsuario recolhido={recolhido} />
          ) : (
            <Link
              href="/entrar"
              title={t('nav.entrar')}
              className={`rounded-xl gradiente-acento py-2.5 text-center text-sm font-semibold text-white ${
                recolhido ? 'px-0' : 'px-4'
              }`}
            >
              {recolhido ? '→' : t('nav.entrar')}
            </Link>
          )}
        </div>
      </aside>

      {/* Celular: barra inferior, colada no rodapé ou logo acima do player
          quando há faixa tocando. */}
      <nav className="fixed inset-x-0 bottom-[var(--altura-player)] z-30 flex items-center justify-around border-t border-borda bg-fundo/95 px-2 py-2 backdrop-blur md:hidden">
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
          aria-haspopup="menu"
          aria-label={t('nav.menuUsuario')}
          className={`flex min-w-16 flex-col items-center gap-1 px-2 py-1.5 text-[10px] ${
            menuAberto ? 'text-acento' : 'text-texto-fraco'
          }`}
        >
          {usuario ? (
            <Avatar url={perfil?.avatarUrl ?? usuario.image} nome={perfil?.displayName || usuario.name} tamanho={20} />
          ) : (
            <PessoaIcone />
          )}
          {usuario ? (perfil?.displayName || usuario.name).split(' ')[0] : t('nav.entrar')}
        </button>
      </nav>

      {menuAberto && (
        <div
          role="menu"
          aria-label={t('nav.menuUsuario')}
          className="fixed inset-x-0 bottom-[calc(var(--altura-player)+4.5rem)] z-40 mx-3 rounded-xl border border-borda bg-superficie-alta p-1.5 shadow-xl md:hidden"
        >
          {usuario ? (
            <ItensMenuUsuario
              aoEditar={() => {
                setMenuAberto(false);
                setEditandoPerfil(true);
              }}
              aoFechar={() => setMenuAberto(false)}
            />
          ) : (
            <Link
              href="/entrar"
              onClick={() => setMenuAberto(false)}
              className="block rounded-lg gradiente-acento py-2 text-center text-sm font-semibold text-white"
            >
              {t('nav.entrar')}
            </Link>
          )}
        </div>
      )}

      {editandoPerfil && <EditarPerfil aoFechar={() => setEditandoPerfil(false)} />}
    </>
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

/** A marca, igual ao favicon e ao site: quatro barras desiguais. */
function MarcaIcone() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="marca-sidebar" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7B54F7" />
          <stop offset="1" stopColor="#B235EC" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#marca-sidebar)" />
      <g fill="#fff">
        <rect x="7" y="11.5" width="3" height="9" rx="1.5" />
        <rect x="12" y="7.5" width="3" height="17" rx="1.5" />
        <rect x="17" y="9.5" width="3" height="13" rx="1.5" />
        <rect x="22" y="12.5" width="3" height="7" rx="1.5" />
      </g>
    </svg>
  );
}

/** Seta do botão de recolher. Aponta para onde o menu vai. */
function SetaRecolher({ apontandoParaDireita }: { apontandoParaDireita: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={apontandoParaDireita ? 'rotate-180' : ''}
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
