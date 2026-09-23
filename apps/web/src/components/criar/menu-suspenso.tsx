'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Botão que abre um painel flutuante logo abaixo.
 *
 * Fecha ao clicar fora e no Esc, que é o que se espera de um menu; sem isso
 * ele ficaria aberto por cima da lista enquanto a pessoa mexe no resto. A
 * abertura é controlada por estado interno, e o conteúdo recebe `fechar`
 * para se fechar depois de uma escolha.
 */
export function MenuSuspenso({
  gatilho,
  alinhamento = 'esquerda',
  direcao = 'baixo',
  largura = 'w-56',
  children,
}: {
  /** Recebe se está aberto, para o botão marcar o estado. */
  gatilho: (aberto: boolean) => ReactNode;
  alinhamento?: 'esquerda' | 'direita';
  /** 'cima' para menus no player do rodapé, que não têm espaço embaixo. */
  direcao?: 'baixo' | 'cima';
  largura?: string;
  children: (fechar: () => void) => ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
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

  return (
    <div ref={caixa} className="relative">
      <div onClick={() => setAberto((v) => !v)}>{gatilho(aberto)}</div>
      {aberto && (
        <div
          role="menu"
          className={`absolute z-30 ${largura} rounded-xl border border-borda bg-superficie-alta p-1.5 shadow-xl ${
            direcao === 'cima' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } ${alinhamento === 'direita' ? 'right-0' : 'left-0'}`}
        >
          {children(() => setAberto(false))}
        </div>
      )}
    </div>
  );
}

/** Um item de menu: ícone opcional, texto, marca quando escolhido. */
export function ItemMenu({
  onClick,
  ativo,
  perigo,
  icone,
  children,
}: {
  onClick: () => void;
  ativo?: boolean;
  perigo?: boolean;
  icone?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-superficie ${
        ativo ? 'text-texto' : perigo ? 'text-perigo' : 'text-texto-suave hover:text-texto'
      }`}
    >
      {icone && <span className="shrink-0">{icone}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {ativo && <span aria-hidden className="text-acento">•</span>}
    </button>
  );
}
