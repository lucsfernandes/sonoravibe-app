'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type Comentario as ComentarioDTO,
  type Comentarios as ComentariosDTO,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePlayer } from '@/lib/player';
import { useSessao } from '@/lib/sessao';

/**
 * Comentários de uma música.
 *
 * Um comentário pode estar ancorado num instante da faixa (`timestampMs`): é
 * assim que alguém diz "o refrão em 1:12 ficou ótimo" sem descrever onde. Por
 * isso o instante é clicável e leva o player até lá, e o formulário oferece
 * marcar o ponto em que a faixa está tocando agora.
 *
 * Carrega sob demanda, não junto com a música: a maioria das visitas é para
 * ouvir, e uma segunda requisição em toda abertura de página custaria mais do
 * que vale.
 */
export function Comentarios({
  songId,
  aoMudarTotal,
}: {
  songId: string;
  aoMudarTotal?: (delta: number) => void;
}) {
  const { t } = useI18n();
  const { usuario } = useSessao();
  const { faixa, posicaoMs, buscar } = usePlayer();

  const [dados, setDados] = useState<ComentariosDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [comInstante, setComInstante] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await api.get<ComentariosDTO>(`/songs/${songId}/comments`));
      setErro(null);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }, [songId, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O instante só faz sentido se for desta faixa: marcar 1:12 de outra música
  // apontaria para um lugar que não existe aqui.
  const instanteAtual = faixa?.id === songId ? posicaoMs : null;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const corpo = texto.trim();
    if (!corpo || enviando) return;

    setEnviando(true);
    try {
      await api.post(`/songs/${songId}/comments`, {
        body: corpo,
        ...(comInstante && instanteAtual !== null
          ? { timestampMs: Math.floor(instanteAtual) }
          : {}),
      });
      setTexto('');
      setComInstante(false);
      aoMudarTotal?.(1);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setEnviando(false);
    }
  }

  async function apagar(id: string) {
    // Some da tela antes da confirmação do servidor: apagar o próprio
    // comentário quase nunca falha, e esperar a rede parece travamento.
    const antes = dados;
    setDados((d) => (d ? { ...d, items: d.items.filter((c) => c.id !== id) } : d));
    try {
      await api.delete(`/songs/${songId}/comments/${id}`);
      aoMudarTotal?.(-1);
    } catch (err) {
      setDados(antes);
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }

  if (!dados) {
    return (
      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t('comentarios.titulo')}</h2>
        <p className="mt-3 text-sm text-texto-fraco pulsando">{t('geral.carregando')}</p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">
        {t('comentarios.titulo')}
        {dados.items.length > 0 && (
          <span className="ml-2 text-sm font-normal text-texto-fraco">{dados.items.length}</span>
        )}
      </h2>

      {!dados.allowed ? (
        <p className="mt-3 text-sm text-texto-fraco">{t('comentarios.desativados')}</p>
      ) : usuario ? (
        <form onSubmit={enviar} className="mt-4">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={t('comentarios.placeholder')}
            aria-label={t('comentarios.placeholder')}
            rows={3}
            maxLength={2000}
            className="w-full resize-y rounded-xl border border-borda bg-superficie px-3 py-2 text-sm outline-none placeholder:text-texto-fraco focus:border-texto-fraco"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!texto.trim() || enviando}
              className="rounded-xl gradiente-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {enviando ? t('geral.enviando') : t('comentarios.enviar')}
            </button>

            {instanteAtual !== null && (
              <label className="flex items-center gap-2 text-xs text-texto-suave">
                <input
                  type="checkbox"
                  checked={comInstante}
                  onChange={(e) => setComInstante(e.target.checked)}
                  className="accent-acento"
                />
                {t('comentarios.marcarInstante')} {formatarInstante(instanteAtual)}
              </label>
            )}
          </div>
        </form>
      ) : (
        <p className="mt-3 text-sm text-texto-suave">
          <Link href="/entrar" className="text-acento hover:underline">
            {t('nav.entrar')}
          </Link>{' '}
          {t('comentarios.paraComentar')}
        </p>
      )}

      {erro && <p className="mt-3 text-sm text-perigo">{erro}</p>}

      {dados.items.length === 0 ? (
        dados.allowed && <p className="mt-6 text-sm text-texto-fraco">{t('comentarios.vazio')}</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {dados.items.map((c) => (
            <ItemComentario
              key={c.id}
              comentario={c}
              podeIrPara={faixa?.id === songId}
              aoIrPara={(ms) => buscar(ms)}
              aoApagar={() => apagar(c.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ItemComentario({
  comentario: c,
  podeIrPara,
  aoIrPara,
  aoApagar,
}: {
  comentario: ComentarioDTO;
  podeIrPara: boolean;
  aoIrPara: (ms: number) => void;
  aoApagar: () => void;
}) {
  const { t, locale } = useI18n();

  return (
    <li className="flex gap-3">
      <Link
        href={`/u/${c.author.handle}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-superficie-alta text-xs font-semibold"
        aria-hidden
      >
        {c.author.displayName.slice(0, 1).toUpperCase()}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link href={`/u/${c.author.handle}`} className="text-sm font-medium hover:underline">
            {c.author.displayName}
          </Link>

          {c.timestampMs !== null &&
            (podeIrPara ? (
              <button
                type="button"
                onClick={() => aoIrPara(c.timestampMs as number)}
                className="rounded bg-superficie-alta px-1.5 py-0.5 text-[11px] tabular-nums text-acento hover:brightness-125"
              >
                {formatarInstante(c.timestampMs)}
              </button>
            ) : (
              // Sem a faixa tocando não há para onde pular; vira só um rótulo.
              <span className="rounded bg-superficie-alta px-1.5 py-0.5 text-[11px] tabular-nums text-texto-fraco">
                {formatarInstante(c.timestampMs)}
              </span>
            ))}

          <span className="text-[11px] text-texto-fraco">
            {new Date(c.createdAt).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US')}
          </span>

          {c.isMine && (
            <button
              type="button"
              onClick={aoApagar}
              className="ml-auto text-[11px] text-texto-fraco hover:text-perigo"
            >
              {t('geral.excluir')}
            </button>
          )}
        </div>

        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-texto-suave">{c.body}</p>
      </div>
    </li>
  );
}

function formatarInstante(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
