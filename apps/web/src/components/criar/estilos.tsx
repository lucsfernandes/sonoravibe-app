'use client';

import { useId, useMemo, useState } from 'react';
import { ALL_STYLE_TAGS, styleLabel } from '@sonora/shared';
import { useI18n } from '@/lib/i18n';
import { BotaoIcone, CartaoSecao } from './controles';
import { EstilosSalvos } from './estilos-salvos';
import { BibliotecaIcone, BrilhoIcone, CarregandoIcone, EmbaralharIcone } from './icones';

/** Quantas sugestões aparecem na fileira de chips. */
const SUGESTOES = 10;

/**
 * Cartão de estilos, no desenho da referência.
 *
 * Embaixo da caixa: presets salvos, aprimorar com IA (o botão colorido),
 * sortear, e uma fileira de chips com sugestões do catálogo. Clicar num chip
 * acrescenta o estilo ao texto e o chip some, dando lugar a outro. As
 * sugestões são sorteadas uma vez por montagem: reembaralhar a cada tecla
 * faria a fileira pular enquanto a pessoa lê.
 */
export function CartaoEstilos({
  estilos,
  excluir,
  onChange,
  aoAplicarPreset,
  aoAprimorar,
  aprimorando,
  aoSortear,
  sorteando,
  placeholder,
  titulo,
  linhas = 3,
}: {
  estilos: string;
  excluir: string;
  onChange: (v: string) => void;
  aoAplicarPreset: (estilos: string, excluir: string) => void;
  aoAprimorar: () => void;
  aprimorando: boolean;
  aoSortear: () => void;
  sorteando: boolean;
  placeholder: string;
  titulo: string;
  linhas?: number;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const [mostrarSalvos, setMostrarSalvos] = useState(false);
  const [semente] = useState(() => Math.random());
  const [usados, setUsados] = useState<string[]>([]);

  const catalogo = useMemo(() => embaralhar(ALL_STYLE_TAGS, semente), [semente]);

  const jaNoTexto = estilos.toLowerCase();
  const sugestoes = catalogo
    .filter((tag) => !usados.includes(tag.slug))
    .filter((tag) => !jaNoTexto.includes(styleLabel(tag, locale).toLowerCase()))
    .slice(0, SUGESTOES);

  function acrescentar(slug: string, rotulo: string) {
    const base = estilos.trim().replace(/,\s*$/, '');
    onChange(base ? `${base}, ${rotulo}` : rotulo);
    setUsados((u) => [...u, slug]);
  }

  return (
    <CartaoSecao
      titulo={titulo}
      resumo={estilos || undefined}
      aberta
      acoes={
        <BotaoIcone
          rotulo={t('criar.estilosSalvos')}
          ativo={mostrarSalvos}
          onClick={() => setMostrarSalvos((v) => !v)}
        >
          <BibliotecaIcone tamanho={15} />
        </BotaoIcone>
      }
    >
      <label htmlFor={id} className="sr-only">
        {titulo}
      </label>
      <textarea
        id={id}
        value={estilos}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={linhas}
        maxLength={1000}
        className="w-full resize-none bg-transparent px-1.5 text-sm leading-relaxed text-texto outline-none placeholder:text-texto-fraco"
      />

      <div className="mt-2 flex items-center gap-1.5">
        <BotaoIcone
          rotulo={t('criar.estilosSalvos')}
          ativo={mostrarSalvos}
          onClick={() => setMostrarSalvos((v) => !v)}
          className="size-9 rounded-full bg-superficie-alta"
        >
          <BibliotecaIcone tamanho={15} />
        </BotaoIcone>
        <button
          type="button"
          onClick={aoAprimorar}
          disabled={aprimorando || estilos.trim().length < 2}
          aria-label={t('criar.aprimorar')}
          title={t('criar.aprimorar')}
          className="flex size-9 shrink-0 items-center justify-center rounded-full gradiente-acento text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {aprimorando ? <CarregandoIcone tamanho={16} /> : <BrilhoIcone tamanho={16} />}
        </button>
        <BotaoIcone
          rotulo={t('criar.sortear')}
          onClick={aoSortear}
          desabilitado={sorteando}
          className="size-9 rounded-full bg-superficie-alta"
        >
          {sorteando ? <CarregandoIcone tamanho={15} /> : <EmbaralharIcone tamanho={15} />}
        </BotaoIcone>

        <div
          className="sem-barra flex min-w-0 flex-1 gap-1.5 overflow-x-auto"
          role="group"
          aria-label={t('criar.sugestoes')}
        >
          {sugestoes.map((tag) => {
            const rotulo = styleLabel(tag, locale);
            return (
              <button
                key={tag.slug}
                type="button"
                onClick={() => acrescentar(tag.slug, rotulo)}
                className="shrink-0 rounded-full bg-superficie-alta px-3.5 py-2 text-xs font-medium text-texto transition-colors hover:bg-borda"
              >
                {rotulo}
              </button>
            );
          })}
        </div>
      </div>

      {mostrarSalvos && (
        <div className="mt-2 rounded-xl bg-superficie-alta/60 px-3 py-2">
          <p className="text-xs font-medium text-texto-suave">{t('criar.estilosSalvos')}</p>
          <EstilosSalvos
            estilosAtuais={estilos}
            excluirAtuais={excluir}
            aoAplicar={(novo, exclusao) => {
              aoAplicarPreset(novo, exclusao);
              setMostrarSalvos(false);
            }}
          />
        </div>
      )}
    </CartaoSecao>
  );
}

/** Embaralhamento determinístico a partir da semente: mesma semente, mesma ordem. */
function embaralhar<T>(lista: readonly T[], semente: number): T[] {
  const copia = [...lista];
  let estado = Math.floor(semente * 2 ** 31) || 1;
  const proximo = () => {
    estado = (Math.imul(estado, 1103515245) + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(proximo() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
