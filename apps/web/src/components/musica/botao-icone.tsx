import type { ButtonHTMLAttributes } from 'react';

/**
 * Botão redondo só com o ícone, da fileira de ações do player e da página da
 * música. O nome acessível vai em `rotulo` e vira `aria-label` e `title`: o
 * desenho sozinho não diz nada a quem usa leitor de tela nem a quem passa o
 * mouse sem reconhecer o glifo.
 */
export function BotaoIcone({
  rotulo,
  ativo,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { rotulo: string; ativo?: boolean }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-superficie disabled:cursor-not-allowed disabled:opacity-40 ${
        ativo ? 'text-acento' : 'text-texto-suave hover:text-texto'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
