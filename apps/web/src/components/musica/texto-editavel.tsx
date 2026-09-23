'use client';

import { useEffect, useRef, useState } from 'react';
import { LapisIcone } from '@/components/criar/icones';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Texto que vira campo ao clicar, para o autor editar o título e o estilo na
 * própria página da música.
 *
 * Salva ao sair do campo ou no Enter (Ctrl+Enter quando é multilinha); Esc
 * desfaz. Quem não é o autor vê só o texto, sem lápis e sem cursor de clique:
 * um título que parece editável e não é confunde mais do que ajuda.
 *
 * Não tem botão de salvar. O que a pessoa digitou é o que fica; se ela
 * apagou tudo num campo que não pode ficar vazio (o título), volta o anterior.
 */
export function TextoEditavel({
  valor,
  podeEditar,
  aoSalvar,
  rotulo,
  multilinha = false,
  maxLength = 160,
  classeTexto = '',
  vazio = '',
}: {
  valor: string | null;
  podeEditar: boolean;
  aoSalvar: (novo: string) => Promise<void>;
  /** Nome acessível do campo. */
  rotulo: string;
  multilinha?: boolean;
  maxLength?: number;
  /** Classes do texto, aplicadas também ao campo para ele não pular de tamanho. */
  classeTexto?: string;
  /** O que mostrar quando não há valor e dá para editar. */
  vazio?: string;
}) {
  const { t } = useI18n();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(valor ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Esc desmonta o campo, e alguns navegadores disparam o blur nessa hora:
  // sem a marca, o blur salvaria o que o Esc acabou de descartar.
  const cancelandoRef = useRef(false);

  useEffect(() => {
    if (!editando) setRascunho(valor ?? '');
  }, [valor, editando]);

  useEffect(() => {
    if (!editando) return;
    campo.current?.focus();
    campo.current?.select();
  }, [editando]);

  async function salvar() {
    if (cancelandoRef.current) {
      cancelandoRef.current = false;
      return;
    }
    const limpo = rascunho.trim();
    if (limpo === (valor ?? '').trim() || (!multilinha && !limpo)) {
      setRascunho(valor ?? '');
      setEditando(false);
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await aoSalvar(limpo);
      setEditando(false);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setSalvando(false);
    }
  }

  function cancelar() {
    cancelandoRef.current = true;
    setRascunho(valor ?? '');
    setErro(null);
    setEditando(false);
  }

  if (editando) {
    const comum = {
      ref: campo,
      value: rascunho,
      maxLength,
      disabled: salvando,
      'aria-label': rotulo,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setRascunho(e.target.value),
      onBlur: () => void salvar(),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelar();
        } else if (e.key === 'Enter' && (!multilinha || e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void salvar();
        }
      },
      className: `w-full min-w-0 rounded-lg border border-acento bg-fundo px-2 py-1 outline-none disabled:opacity-60 ${classeTexto}`,
    };
    return (
      <span className="block">
        {multilinha ? <textarea {...comum} rows={4} /> : <input {...comum} type="text" />}
        {erro && (
          <span role="alert" className="mt-1 block text-xs text-perigo">
            {erro}
          </span>
        )}
      </span>
    );
  }

  if (!podeEditar) {
    return valor ? <span className={classeTexto}>{valor}</span> : null;
  }

  return (
    <button
      type="button"
      onClick={() => setEditando(true)}
      title={rotulo}
      className={`group inline-flex max-w-full items-start gap-2 rounded-lg text-left transition-colors hover:bg-superficie/70 ${
        multilinha ? '-mx-2 px-2 py-1' : '-mx-2 px-2 py-0.5'
      }`}
    >
      <span className={`min-w-0 ${classeTexto} ${valor ? '' : 'text-texto-fraco'}`}>
        {valor || vazio}
      </span>
      <LapisIcone
        tamanho={14}
        className="mt-1.5 shrink-0 text-texto-fraco opacity-60 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}
