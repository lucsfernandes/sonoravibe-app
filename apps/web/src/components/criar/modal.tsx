'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FecharIcone } from './icones';

/**
 * Janela por cima da tela, para escolher uma referência, uma playlist ou
 * editar o perfil.
 *
 * Fecha no Esc e ao clicar no fundo escuro. O `role="dialog"` com o título
 * como nome acessível é o que faz o leitor de tela anunciar o que abriu; a
 * rolagem do corpo fica travada enquanto ela está aberta, senão a lista de
 * trás rola junto com a roda do mouse.
 *
 * Renderiza num portal no `body`, e não onde foi aberta: a barra lateral é
 * `sticky` e o player é `fixed`, e cada um cria um contexto de empilhamento.
 * Um modal aberto de dentro deles ficava pintado por baixo do resto da tela,
 * por mais alto que fosse o `z-index`.
 */
export function Modal({
  titulo,
  aoFechar,
  children,
  largura = 'max-w-xl',
}: {
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  largura?: string;
}) {
  // O portal só existe no navegador; no servidor não há `document`.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') aoFechar();
    }
    document.addEventListener('keydown', aoTeclar);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      document.body.style.overflow = anterior;
    };
  }, [aoFechar]);

  if (!montado) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={`flex max-h-[85vh] w-full ${largura} flex-col overflow-hidden rounded-2xl border border-borda bg-superficie shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-borda px-5 py-3.5">
          <h2 className="text-base font-semibold">{titulo}</h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-texto-suave transition-colors hover:bg-superficie-alta hover:text-texto"
          >
            <FecharIcone tamanho={16} />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
