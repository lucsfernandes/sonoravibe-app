'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { BotaoIcone, CartaoSecao, Interruptor } from './controles';
import {
  BibliotecaIcone,
  BrilhoIcone,
  CarregandoIcone,
  DesfazerIcone,
  ExpandirIcone,
  LapisIcone,
  RefazerIcone,
} from './icones';
import { MenuSuspenso, ItemMenu } from './menu-suspenso';
import { Modal } from './modal';

const SECOES = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro'] as const;

/**
 * Cartão da letra, no desenho da referência: cabeçalho com desfazer, refazer,
 * escrever com IA, inserir seção e expandir; a caixa de texto; e o botão
 * redondo de IA no rodapé.
 *
 * O histórico de desfazer é por marco, não por tecla: cada geração por IA,
 * limpeza ou seção inserida vira um ponto, e o que foi digitado entre eles
 * vira outro quando o campo perde o foco. Desfazer tecla por tecla o
 * navegador já faz sozinho dentro da textarea.
 */
export function CartaoLetra({
  letra,
  onChange,
  instrumental,
  aoMudarInstrumental,
  escrevendo,
  aoGerar,
}: {
  letra: string;
  onChange: (v: string) => void;
  instrumental: boolean;
  aoMudarInstrumental: (v: boolean) => void;
  escrevendo: boolean;
  /** Pede a letra à IA a partir do tema. Quem chama troca o texto quando chegar. */
  aoGerar: (tema: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [historico, setHistorico] = useState<string[]>([letra]);
  const [indice, setIndice] = useState(0);
  const [pedindoTema, setPedindoTema] = useState(false);
  const [tema, setTema] = useState('');
  const [expandida, setExpandida] = useState(false);
  const campoTema = useRef<HTMLInputElement>(null);

  // Texto que chegou de fora (IA respondeu, "limpar tudo") vira um marco.
  const ultimoRef = useRef(letra);
  useEffect(() => {
    if (letra === ultimoRef.current) return;
    ultimoRef.current = letra;
    if (historico[indice] !== letra) marcar(letra);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reage ao texto
  }, [letra]);

  function marcar(valor: string) {
    setHistorico((h) => {
      const base = h.slice(0, indice + 1);
      if (base[base.length - 1] === valor) return base;
      return [...base, valor].slice(-50);
    });
    setIndice((i) => Math.min(i + 1, 49));
  }

  function irPara(novoIndice: number) {
    const valor = historico[novoIndice];
    if (valor === undefined) return;
    setIndice(novoIndice);
    ultimoRef.current = valor;
    onChange(valor);
  }

  function inserirSecao(secao: string) {
    const separador = !letra || letra.endsWith('\n\n') ? '' : letra.endsWith('\n') ? '\n' : '\n\n';
    const novo = `${letra}${separador}[${secao}]\n`;
    ultimoRef.current = novo;
    onChange(novo);
    marcar(novo);
  }

  function abrirTema() {
    // Um texto curto e sem marcação já é um tema: vai pré-preenchido.
    const curto = letra.trim().length > 0 && letra.trim().length <= 200 && !/\[\w/.test(letra);
    setTema(curto ? letra.trim() : '');
    setPedindoTema(true);
    setTimeout(() => campoTema.current?.focus(), 0);
  }

  function enviarTema() {
    const limpo = tema.trim();
    if (limpo.length < 3) return;
    setPedindoTema(false);
    aoGerar(limpo);
  }

  const podeDesfazer = indice > 0;
  const podeRefazer = indice < historico.length - 1;

  const caixa = (linhas: number, classe = '') => (
    <textarea
      id={id}
      value={letra}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => marcar(letra)}
      placeholder={t('criar.letraVazia')}
      rows={linhas}
      disabled={instrumental}
      className={`w-full resize-none bg-transparent px-1.5 text-sm leading-relaxed text-texto outline-none placeholder:text-texto-fraco disabled:cursor-not-allowed disabled:opacity-40 ${classe}`}
    />
  );

  return (
    <>
      <CartaoSecao
        titulo={t('criar.letra')}
        resumo={letra || undefined}
        aberta
        acoes={
          <>
            <BotaoIcone rotulo={t('criar.desfazer')} onClick={() => irPara(indice - 1)} desabilitado={!podeDesfazer}>
              <DesfazerIcone tamanho={15} />
            </BotaoIcone>
            <BotaoIcone rotulo={t('criar.refazer')} onClick={() => irPara(indice + 1)} desabilitado={!podeRefazer}>
              <RefazerIcone tamanho={15} />
            </BotaoIcone>
            <BotaoIcone rotulo={t('criar.gerarLetra')} onClick={abrirTema} desabilitado={instrumental || escrevendo}>
              <LapisIcone tamanho={15} />
            </BotaoIcone>
            <MenuSuspenso
              alinhamento="direita"
              largura="w-44"
              gatilho={(aberto) => (
                <BotaoIcone rotulo={t('criar.estrutura')} ativo={aberto} desabilitado={instrumental}>
                  <BibliotecaIcone tamanho={15} />
                </BotaoIcone>
              )}
            >
              {(fechar) =>
                SECOES.map((s) => (
                  <ItemMenu
                    key={s}
                    onClick={() => {
                      inserirSecao(s);
                      fechar();
                    }}
                  >
                    [{s}]
                  </ItemMenu>
                ))
              }
            </MenuSuspenso>
            <BotaoIcone rotulo={t('criar.expandir')} onClick={() => setExpandida(true)}>
              <ExpandirIcone tamanho={15} />
            </BotaoIcone>
          </>
        }
        rodape={
          <div className="relative mt-1 flex items-center justify-between px-1 pb-1">
            <Interruptor rotulo={t('criar.instrumental')} ligado={instrumental} onChange={aoMudarInstrumental} />
            <button
              type="button"
              onClick={abrirTema}
              disabled={instrumental || escrevendo}
              aria-label={t('criar.gerarLetra')}
              title={t('criar.gerarLetra')}
              className="absolute left-1/2 top-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-borda bg-superficie-alta text-texto transition-colors hover:border-texto-fraco hover:bg-borda disabled:cursor-not-allowed disabled:opacity-40"
            >
              {escrevendo ? <CarregandoIcone tamanho={18} /> : <BrilhoIcone tamanho={18} />}
            </button>
            <span className="w-9" aria-hidden />
          </div>
        }
      >
        {caixa(8, 'min-h-[176px]')}

        {pedindoTema && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enviarTema();
            }}
            className="mt-1 flex items-center gap-2 rounded-xl bg-superficie-alta/70 p-1.5 pl-3"
          >
            <BrilhoIcone tamanho={14} className="shrink-0 text-acento" />
            <input
              ref={campoTema}
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setPedindoTema(false)}
              placeholder={t('criar.temaLetra')}
              aria-label={t('criar.temaLetra')}
              maxLength={1000}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-texto-fraco"
            />
            <button
              type="submit"
              disabled={tema.trim().length < 3}
              className="rounded-lg gradiente-acento px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {t('criar.escreverComIA')}
            </button>
          </form>
        )}
      </CartaoSecao>

      {expandida && (
        <Modal titulo={t('criar.letra')} aoFechar={() => setExpandida(false)} largura="max-w-3xl">
          <div className="p-4">{caixa(22, 'min-h-[60vh] text-base')}</div>
        </Modal>
      )}
    </>
  );
}
