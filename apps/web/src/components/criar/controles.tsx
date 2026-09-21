'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * Controles do painel de criação.
 *
 * Todos amarram rótulo e campo por `id`/`htmlFor` gerado com `useId`: sem isso,
 * leitor de tela anuncia "caixa de texto, em branco" e quem navega por teclado
 * não sabe o que está preenchendo.
 */

export function Campo({
  rotulo,
  valor,
  onChange,
  placeholder,
  multilinha,
  linhas = 3,
  tipo = 'text',
  desabilitado,
  acao,
}: {
  rotulo?: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multilinha?: boolean;
  linhas?: number;
  tipo?: string;
  desabilitado?: boolean;
  acao?: { rotulo: string; onClick: () => void; desabilitado?: boolean };
}) {
  const id = useId();
  const classe =
    'w-full rounded-xl border border-borda bg-superficie px-3 py-2.5 text-sm text-texto ' +
    'placeholder:text-texto-fraco focus:border-acento/60 focus:outline-none ' +
    'disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div>
      {(rotulo || acao) && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          {rotulo ? (
            <label htmlFor={id} className="text-xs font-medium text-texto-suave">
              {rotulo}
            </label>
          ) : (
            <span />
          )}
          {acao && (
            <button
              type="button"
              onClick={acao.onClick}
              disabled={acao.desabilitado}
              className="rounded-lg border border-borda px-2 py-1 text-xs text-texto-suave transition-colors hover:border-acento/50 hover:text-acento disabled:opacity-40"
            >
              {acao.rotulo}
            </button>
          )}
        </div>
      )}

      {multilinha ? (
        <textarea
          id={id}
          value={valor}
          rows={linhas}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={desabilitado}
          className={`${classe} resize-y`}
        />
      ) : (
        <input
          id={id}
          type={tipo}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={desabilitado}
          className={classe}
        />
      )}
    </div>
  );
}

export function Secao({
  titulo,
  resumo,
  aberta = false,
  children,
}: {
  titulo: string;
  resumo?: string;
  aberta?: boolean;
  children: ReactNode;
}) {
  const [expandida, setExpandida] = useState(aberta);
  const id = useId();

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpandida((v) => !v)}
        aria-expanded={expandida}
        aria-controls={id}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`shrink-0 text-texto-fraco transition-transform ${expandida ? 'rotate-90' : ''}`}
          aria-hidden
        >
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{titulo}</span>
          {/* O resumo fechado mostra o que já foi preenchido, para não obrigar a
              abrir cada seção só para conferir. */}
          {!expandida && resumo && (
            <span className="mt-0.5 line-clamp-1 block text-xs text-texto-fraco">{resumo}</span>
          )}
        </span>
      </button>

      {expandida && (
        <div id={id} className="space-y-3 border-t border-borda px-3.5 py-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function Seletor({
  rotulo,
  valor,
  onChange,
  opcoes,
  desabilitado,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
  desabilitado?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-texto-suave">
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        disabled={desabilitado}
        className="w-full rounded-xl border border-borda bg-superficie px-3 py-2.5 text-sm text-texto focus:border-acento/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor} className="bg-superficie">
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Deslizante({
  rotulo,
  valor,
  min,
  max,
  passo = 1,
  onChange,
  sufixo = '',
}: {
  rotulo: string;
  valor: number;
  min: number;
  max: number;
  passo?: number;
  onChange: (v: number) => void;
  sufixo?: string;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-texto-suave">
          {rotulo}
        </label>
        <span className="text-xs tabular-nums text-texto-fraco">
          {valor}
          {sufixo}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={passo}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-acento"
      />
    </div>
  );
}

export function Interruptor({
  rotulo,
  ligado,
  onChange,
  aviso,
}: {
  rotulo: string;
  ligado: boolean;
  onChange: (v: boolean) => void;
  aviso?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">
        {rotulo}
        {aviso && <span className="ml-2 text-xs text-texto-fraco">({aviso})</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        onClick={() => onChange(!ligado)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          ligado ? 'bg-acento' : 'bg-borda'
        }`}
      >
        {/* `left-0.5` é obrigatório: sem ele o elemento absoluto herda a posição
            estática, que num botão com conteúdo centralizado cai no meio da
            trilha — o knob aparecia à direita mesmo desligado. */}
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${
            ligado ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
