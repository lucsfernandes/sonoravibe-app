'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MaisIcone } from '@/components/criar/icones';
import { Avatar } from '@/components/shell/avatar';
import {
  api,
  ApiError,
  type Comentario as ComentarioDTO,
  type Comentarios as ComentariosDTO,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePlayer } from '@/lib/player';
import { useSessao } from '@/lib/sessao';

/** As reações de um toque, como na referência. */
const REACOES = ['🔥', '😍', '😱', '👏', '👍', '😎', '🤯'];
const MAIS_REACOES = ['❤️', '💜', '🎉', '🎶', '🕺', '😢', '🙌', '✨'];

/**
 * Comentários de uma música, no cartão da referência: a fileira de reações,
 * o campo em pílula com a foto de quem escreve e, sem nenhum comentário, o
 * aviso grande no meio.
 *
 * As reações não são um sistema à parte: cada emoji entra no texto do
 * comentário. É o que dá o gesto rápido da referência sem inventar uma
 * segunda tabela para "reagiu com 🔥".
 *
 * Um comentário pode estar ancorado num instante da faixa (`timestampMs`): é
 * assim que alguém diz "o refrão em 1:12 ficou ótimo" sem descrever onde. Por
 * isso o instante é clicável e leva o player até lá, e o campo oferece
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
  const { usuario, perfil } = useSessao();
  const { faixa, posicaoMs, buscar } = usePlayer();

  const [dados, setDados] = useState<ComentariosDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [comInstante, setComInstante] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [maisReacoes, setMaisReacoes] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

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

  async function enviar() {
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
      if (campo.current) campo.current.style.height = 'auto';
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

  function reagir(emoji: string) {
    setTexto((atual) => (atual && !atual.endsWith(' ') ? `${atual} ${emoji}` : `${atual}${emoji}`));
    campo.current?.focus();
  }

  /** O campo cresce com o texto, até umas seis linhas; depois rola. */
  function ajustarAltura(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  const podeEscrever = Boolean(dados?.allowed && usuario);

  return (
    <section id="comentarios" className="scroll-mt-6 rounded-3xl bg-superficie p-4 sm:p-5">
      <h2 className="sr-only">
        {t('comentarios.titulo')}
        {dados && dados.items.length > 0 ? ` ${dados.items.length}` : ''}
      </h2>

      {podeEscrever && (
        <div className="flex flex-wrap items-center gap-1" aria-label={t('comentarios.reagir')}>
          {[...REACOES, ...(maisReacoes ? MAIS_REACOES : [])].map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => reagir(emoji)}
              aria-label={`${t('comentarios.reagir')} ${emoji}`}
              className="flex size-9 items-center justify-center rounded-full text-xl transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMaisReacoes((v) => !v)}
            aria-expanded={maisReacoes}
            aria-label={t('comentarios.maisReacoes')}
            title={t('comentarios.maisReacoes')}
            className="flex size-8 items-center justify-center rounded-full border border-borda text-texto-suave transition-colors hover:bg-superficie-alta hover:text-texto"
          >
            <MaisIcone tamanho={14} />
          </button>
        </div>
      )}

      {dados && !dados.allowed ? (
        <p className="py-6 text-center text-sm text-texto-fraco">{t('comentarios.desativados')}</p>
      ) : usuario ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
          className="mt-3 flex items-end gap-3 rounded-3xl bg-superficie-alta py-2 pl-2.5 pr-2.5"
        >
          <Avatar
            url={perfil?.avatarUrl ?? usuario.image}
            nome={perfil?.displayName || usuario.name}
            tamanho={34}
            className="mb-0.5"
          />
          <label htmlFor="novo-comentario" className="sr-only">
            {t('comentarios.placeholder')}
          </label>
          <textarea
            id="novo-comentario"
            ref={campo}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              ajustarAltura(e.target);
            }}
            onKeyDown={(e) => {
              // Enter envia, como num chat; Shift+Enter quebra a linha.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder={t('comentarios.placeholder')}
            title={t('comentarios.dicaEnvio')}
            rows={1}
            maxLength={2000}
            disabled={!dados || !dados.allowed || enviando}
            className="min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed outline-none placeholder:text-texto-fraco disabled:opacity-60"
          />

          {instanteAtual !== null && (
            <button
              type="button"
              onClick={() => setComInstante((v) => !v)}
              aria-pressed={comInstante}
              title={t('comentarios.marcarInstante')}
              className={`mb-0.5 flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] tabular-nums transition-colors ${
                comInstante
                  ? 'bg-acento-suave text-acento'
                  : 'bg-fundo/60 text-texto-fraco hover:text-texto'
              }`}
            >
              <RelogioIcone />
              {formatarInstante(instanteAtual)}
            </button>
          )}

          {texto.trim() && (
            <button
              type="submit"
              disabled={enviando}
              aria-label={t('comentarios.enviar')}
              title={t('comentarios.enviar')}
              className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full gradiente-acento text-white disabled:opacity-50"
            >
              <EnviarIcone />
            </button>
          )}
        </form>
      ) : (
        <p className="mt-3 rounded-3xl bg-superficie-alta px-4 py-3 text-sm text-texto-suave">
          <Link href="/entrar" className="text-acento hover:underline">
            {t('nav.entrar')}
          </Link>{' '}
          {t('comentarios.paraComentar')}
        </p>
      )}

      {erro && (
        <p role="alert" className="mt-3 text-sm text-perigo">
          {erro}
        </p>
      )}

      {!dados ? (
        <p className="py-8 text-center text-sm text-texto-fraco pulsando">{t('geral.carregando')}</p>
      ) : dados.items.length === 0 ? (
        dados.allowed && (
          <p className="py-8 text-center font-serif text-2xl text-texto sm:text-3xl">
            {t('comentarios.vazio')}
          </p>
        )
      ) : (
        <ul className="mt-5 space-y-4">
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
      <Link href={`/u/${c.author.handle}`} className="shrink-0" aria-hidden tabIndex={-1}>
        <Avatar url={c.author.avatarUrl} nome={c.author.displayName} tamanho={32} />
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

function RelogioIcone() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function EnviarIcone() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 11.5 21 3l-8.5 18-2.5-7.5z" />
    </svg>
  );
}
