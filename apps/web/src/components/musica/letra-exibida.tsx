'use client';

import { useEffect, useState } from 'react';
import { LapisIcone } from '@/components/criar/icones';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * A letra embaixo da capa, com o botão "Editar letra exibida" para o autor.
 *
 * Editar aqui não regera a música: o áudio já existe, e o que muda é o texto
 * que a página mostra. Por isso o botão diz "exibida" e não só "editar" — a
 * pessoa precisa saber que não vai ouvir a letra nova.
 */
export function LetraExibida({
  letra,
  podeEditar,
  aoSalvar,
}: {
  letra: string | null;
  podeEditar: boolean;
  aoSalvar: (letra: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(letra ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!editando) setRascunho(letra ?? '');
  }, [letra, editando]);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await aoSalvar(rascunho);
      setEditando(false);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setSalvando(false);
    }
  }

  if (!podeEditar && !letra) return null;

  return (
    <section className="mt-4">
      {podeEditar && !editando && (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-superficie px-4 text-sm font-medium transition-colors hover:bg-superficie-alta"
        >
          <LapisIcone tamanho={15} />
          {t('musica.editarLetra')}
        </button>
      )}

      {editando ? (
        <div className="mt-3">
          <label htmlFor="letra-exibida" className="sr-only">
            {t('criar.letra')}
          </label>
          <textarea
            id="letra-exibida"
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            placeholder={t('criar.letraPlaceholder')}
            rows={16}
            maxLength={6000}
            autoFocus
            disabled={salvando}
            className="w-full resize-y rounded-2xl border border-borda bg-superficie px-3.5 py-3 font-sans text-sm leading-relaxed outline-none placeholder:text-texto-fraco focus:border-acento disabled:opacity-60"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={salvando}
              className="rounded-xl gradiente-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {salvando ? t('geral.enviando') : t('geral.salvar')}
            </button>
            <button
              type="button"
              onClick={() => {
                setRascunho(letra ?? '');
                setErro(null);
                setEditando(false);
              }}
              disabled={salvando}
              className="rounded-xl px-3 py-2 text-sm text-texto-suave hover:text-texto"
            >
              {t('geral.cancelar')}
            </button>
          </div>
          {erro && (
            <p role="alert" className="mt-2 text-xs text-perigo">
              {erro}
            </p>
          )}
        </div>
      ) : letra ? (
        <pre className="mt-3 whitespace-pre-wrap px-1 font-sans text-sm leading-relaxed text-texto-suave">
          {letra}
        </pre>
      ) : (
        <p className="mt-3 px-1 text-sm text-texto-fraco">{t('musica.semLetra')}</p>
      )}
    </section>
  );
}
