'use client';

import { useId, useState, type ReactNode } from 'react';
import { InfoIcone, LixeiraIcone, RedefinirIcone, SetaDireitaIcone } from './icones';

/**
 * Controles do painel de criação, no desenho da referência: cartões escuros
 * sem borda forte, linhas de opção com o rótulo à esquerda e o controle à
 * direita, sliders com marcas e um cursor alto.
 *
 * Todos amarram rótulo e campo por `id`/`htmlFor` gerado com `useId`: sem isso,
 * leitor de tela anuncia "controle deslizante" sem dizer de quê.
 */

/** Cartão recolhível com título, ações no cabeçalho e um resumo quando fechado. */
export function CartaoSecao({
  titulo,
  resumo,
  aberta = false,
  acoes,
  aoLimpar,
  podeLimpar = true,
  children,
  rodape,
}: {
  titulo: string;
  /** Linha pequena sob o título quando fechado (ex.: "Variedade alta · 3:00"). */
  resumo?: string;
  aberta?: boolean;
  /** Botões de ícone à direita do título, visíveis com a seção aberta. */
  acoes?: ReactNode;
  /** Quando presente, mostra a lixeira que zera o conteúdo da seção. */
  aoLimpar?: () => void;
  /** A lixeira aparece apagada quando não há nada a zerar. */
  podeLimpar?: boolean;
  children: ReactNode;
  /** Conteúdo colado no fim do cartão (ex.: o botão de IA da letra). */
  rodape?: ReactNode;
}) {
  const [expandida, setExpandida] = useState(aberta);
  const id = useId();

  return (
    <section className="rounded-2xl bg-superficie">
      {/* O cabeçalho é uma div com botões irmãos, e não um botão com outro
          dentro: botão aninhado é HTML inválido e o clique se perde. */}
      <div className="flex items-center gap-1 pr-3">
        <button
          type="button"
          onClick={() => setExpandida((v) => !v)}
          aria-expanded={expandida}
          aria-controls={id}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3.5 text-left"
        >
          <SetaDireitaIcone
            tamanho={14}
            className={`shrink-0 text-texto transition-transform ${expandida ? 'rotate-90' : ''}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight">{titulo}</span>
            {!expandida && resumo && (
              <span className="mt-0.5 line-clamp-1 block text-xs text-texto-fraco">{resumo}</span>
            )}
          </span>
        </button>

        {expandida && acoes}

        {aoLimpar && (
          <BotaoIcone
            rotulo={`Limpar ${titulo}`}
            onClick={aoLimpar}
            desabilitado={!podeLimpar}
            className="hover:text-perigo"
          >
            <LixeiraIcone tamanho={15} />
          </BotaoIcone>
        )}
      </div>

      {expandida && (
        <div id={id} className="px-3 pb-3">
          {children}
          {rodape}
        </div>
      )}
    </section>
  );
}

/** Botão quadrado só com ícone, para cabeçalhos e barras de ferramentas. */
export function BotaoIcone({
  rotulo,
  onClick,
  desabilitado,
  ativo,
  className = '',
  children,
}: {
  rotulo: string;
  onClick?: () => void;
  desabilitado?: boolean;
  ativo?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      title={rotulo}
      aria-pressed={ativo}
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-texto-suave transition-colors hover:bg-superficie-alta hover:text-texto disabled:cursor-not-allowed disabled:opacity-35 ${
        ativo ? 'bg-superficie-alta text-texto' : ''
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Uma linha de "Mais opções": rótulo (com dica e reset opcionais) à esquerda,
 * o controle à direita. Quando `abaixo` é dado, o controle ocupa a linha de
 * baixo inteira (é o caso dos sliders).
 */
export function LinhaOpcao({
  rotulo,
  dica,
  aoRedefinir,
  direita,
  direitaLarga,
  abaixo,
  desabilitada,
}: {
  rotulo: string;
  dica?: string;
  aoRedefinir?: () => void;
  direita?: ReactNode;
  /** O controle da direita ocupa o resto da linha (é o caso dos sliders). */
  direitaLarga?: boolean;
  abaixo?: ReactNode;
  desabilitada?: boolean;
}) {
  return (
    <div
      className={`rounded-xl bg-superficie-alta/60 px-3.5 py-3 ${desabilitada ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex min-w-0 items-center gap-1.5 text-sm font-medium ${
            direitaLarga ? 'w-[118px] shrink-0' : ''
          }`}
        >
          <span className="truncate">{rotulo}</span>
          {dica && (
            <span
              title={dica}
              aria-label={dica}
              className="flex size-4 shrink-0 cursor-help items-center justify-center text-texto-fraco"
            >
              <InfoIcone tamanho={14} />
            </span>
          )}
          {aoRedefinir && (
            <button
              type="button"
              onClick={aoRedefinir}
              aria-label={`Redefinir ${rotulo}`}
              title={`Redefinir ${rotulo}`}
              className="flex size-5 shrink-0 items-center justify-center text-texto-fraco transition-colors hover:text-texto"
            >
              <RedefinirIcone tamanho={13} />
            </button>
          )}
        </span>
        {direita && (
          <span
            className={`ml-auto flex items-center gap-2 ${direitaLarga ? 'min-w-0 flex-1' : 'shrink-0'}`}
          >
            {direita}
          </span>
        )}
      </div>
      {abaixo && <div className="mt-2">{abaixo}</div>}
    </div>
  );
}

/** Slider com marcas na trilha e o valor formatado à direita. */
export function DeslizanteMarcas({
  rotulo,
  valor,
  min,
  max,
  passo = 1,
  onChange,
  formatar,
  desabilitado,
}: {
  rotulo: string;
  valor: number;
  min: number;
  max: number;
  passo?: number;
  onChange: (v: number) => void;
  /** Como mostrar o valor: "3:00", "50%", "Alta"... */
  formatar: (v: number) => string;
  desabilitado?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={passo}
        value={valor}
        disabled={desabilitado}
        onChange={(e) => onChange(Number(e.target.value))}
        className="deslizante-marcas min-w-0 flex-1"
      />
      <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums">
        {formatar(valor)}
      </span>
    </div>
  );
}

/**
 * Escolha entre poucas opções, só texto: a escolhida fica branca, as outras
 * apagadas. Clicar na escolhida de novo volta para "nenhuma" quando
 * `permiteNenhuma` é dado (é o caso da voz: masculina, feminina ou tanto faz).
 */
export function EscolhaTexto<T extends string>({
  rotulo,
  valor,
  opcoes,
  onChange,
  permiteNenhuma,
  desabilitado,
}: {
  rotulo: string;
  valor: T | null;
  opcoes: { valor: T; rotulo: string }[];
  onChange: (v: T | null) => void;
  permiteNenhuma?: boolean;
  desabilitado?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="flex items-center gap-1">
      {opcoes.map((o) => {
        const ativa = valor === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativa}
            disabled={desabilitado}
            onClick={() => onChange(ativa && permiteNenhuma ? null : o.valor)}
            className={`rounded-lg px-2.5 py-1 text-sm transition-colors disabled:cursor-not-allowed ${
              ativa ? 'bg-superficie-alta font-semibold text-texto' : 'text-texto-fraco hover:text-texto'
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Off | On, no desenho da referência: o escolhido ganha fundo. */
export function LigaDesliga({
  rotulo,
  ligado,
  onChange,
  desabilitado,
  rotulos = { desligado: 'Off', ligado: 'On' },
}: {
  rotulo: string;
  ligado: boolean;
  onChange: (v: boolean) => void;
  desabilitado?: boolean;
  rotulos?: { desligado: string; ligado: string };
}) {
  return (
    <EscolhaTexto
      rotulo={rotulo}
      valor={ligado ? 'on' : 'off'}
      opcoes={[
        { valor: 'off', rotulo: rotulos.desligado },
        { valor: 'on', rotulo: rotulos.ligado },
      ]}
      onChange={(v) => onChange(v === 'on')}
      desabilitado={desabilitado}
    />
  );
}

/** Interruptor compacto (trilho e bolinha), para "Instrumental". */
export function Interruptor({
  rotulo,
  ligado,
  onChange,
  desabilitado,
}: {
  rotulo: string;
  ligado: boolean;
  onChange: (v: boolean) => void;
  desabilitado?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-texto-suave">
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        disabled={desabilitado}
        onClick={() => onChange(!ligado)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          ligado ? 'bg-acento' : 'bg-borda'
        }`}
      >
        {/* `left-0.5` é obrigatório: sem ele o elemento absoluto herda a posição
            estática e o knob cai no meio da trilha. */}
        <span
          className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform ${
            ligado ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
      {rotulo}
    </label>
  );
}

/** Campo de uma linha com ícone à esquerda, no desenho dos cartões de baixo. */
export function CampoComIcone({
  icone,
  valor,
  onChange,
  placeholder,
  rotulo,
  maxLength,
  className = '',
}: {
  icone: ReactNode;
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
  rotulo: string;
  maxLength?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-center gap-3 rounded-2xl bg-superficie px-4 py-3 ${className}`}>
      <span className="shrink-0 text-texto-suave">{icone}</span>
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-texto-fraco"
      />
    </div>
  );
}

/** Seletor nativo vestido de chip, para "Salvar em". */
export function SeletorChip({
  rotulo,
  valor,
  onChange,
  opcoes,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
}) {
  const id = useId();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-44 cursor-pointer appearance-none truncate rounded-xl bg-superficie-alta px-3.5 py-2 text-sm font-medium outline-none"
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor} className="bg-superficie">
            {o.rotulo}
          </option>
        ))}
      </select>
    </>
  );
}
