'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { AdicionarAPlaylist } from '@/components/musica/adicionar-playlist';
import { Comentarios } from '@/components/musica/comentarios';
import { BotaoCurtir } from '@/components/musica/curtir';
import { GerenciarMusica } from '@/components/musica/gerenciar';
import { ApiError, api, type MusicaDetalhe } from '@/lib/api';
import { formatarDuracao, useI18n } from '@/lib/i18n';
import { paraFaixa, usePlayer } from '@/lib/player';
import { useSessao } from '@/lib/sessao';

/**
 * Detalhe da música: tocar, letra, downloads e as ações de edição.
 *
 * Os formatos de download vêm do backend já sabendo o que o plano libera, com
 * um aviso honesto por formato — inclusive o de que converter um master MP3
 * para WAV não melhora a qualidade, só aumenta o arquivo.
 */
export default function PaginaMusica({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { usuario } = useSessao();
  const { tocar, faixa, tocando, alternar } = usePlayer();

  const [musica, setMusica] = useState<MusicaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setMusica(await api.get<MusicaDetalhe>(`/songs/${id}`));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }, [id, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <p className="p-8 text-sm text-perigo">{erro}</p>;
  if (!musica) return <p className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</p>;

  // `isMine` vem do backend. Antes isto era só `usuario != null`, o que fazia
  // Publicar, Estender e Separar stems aparecerem na música dos outros.
  const minha = musica.isMine;
  const posso = minha && musica.status === 'complete';
  const pronta = musica.status === 'complete';
  const estaTocando = faixa?.id === musica.id && tocando;

  /**
   * Baixa um formato.
   *
   * Pede JSON para conseguir distinguir "pronto" de "convertendo": com o 302
   * puro o navegador seguiria o redirect e o 202 viraria um JSON numa aba nova.
   */
  async function baixar(formato: string) {
    setOcupado(formato);
    setAviso(null);
    try {
      const resposta = await api.get<{ status: string; url?: string; message?: string }>(
        `/songs/${id}/download?format=${formato}`,
      );
      if (resposta.url) window.location.href = resposta.url;
      else setAviso(resposta.message ?? t('musica.convertendo'));
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
    }
  }

  async function acao(chamada: () => Promise<unknown>, chave: string) {
    setOcupado(chave);
    setAviso(null);
    try {
      await chamada();
      await carregar();
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl sm:w-64">
          {musica.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada, expira
            <img src={musica.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center gradiente-acento">
              <span className="text-6xl font-black text-white/90">
                {musica.title.slice(0, 1).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{musica.title}</h1>
          {/* Sem título sugerido pelo motor, o título nasce igual ao prompt. */}
          {musica.stylePrompt && musica.stylePrompt.trim() !== musica.title.trim() && (
            <p className="mt-1 text-sm text-texto-suave">{musica.stylePrompt}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-texto-fraco">
            {musica.durationMs > 0 && <span>{formatarDuracao(musica.durationMs)}</span>}
            <span>
              {musica.playCount} {t(musica.playCount === 1 ? 'musica.reproducao' : 'musica.reproducoes')}
            </span>
            <span>
              {musica.likeCount} {t(musica.likeCount === 1 ? 'musica.curtida' : 'musica.curtidas')}
            </span>
            {musica.providerId && <span>{musica.providerId}</span>}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {musica.audioUrl && (
              <button
                type="button"
                onClick={() => {
                  if (faixa?.id === musica.id) {
                    alternar();
                    return;
                  }
                  const nova = paraFaixa(musica);
                  if (nova) tocar(nova, [nova]);
                }}
                className="rounded-xl gradiente-acento px-5 py-2.5 text-sm font-semibold text-white"
              >
                {estaTocando ? 'Pausar' : 'Tocar'}
              </button>
            )}

            {/* Curtir vale para qualquer pessoa que alcance a música: se ela
                é privada, só o dono chega até aqui de qualquer forma. */}
            <BotaoCurtir
              songId={musica.id}
              curtidoInicial={musica.likedByMe}
              contagemInicial={musica.likeCount}
              tamanho="grande"
            />

            {/* Playlist é do ouvinte, não do autor: dá para organizar a música
                de outra pessoa na sua própria lista. */}
            {usuario && pronta && <AdicionarAPlaylist songId={musica.id} />}

            {posso && (
              <>
                <BotaoAcao
                  rotulo={musica.isPublic ? t('musica.despublicar') : t('musica.publicar')}
                  ocupado={ocupado === 'publicar'}
                  onClick={() =>
                    void acao(
                      () => api.post(`/songs/${musica.id}/publish`, { isPublic: !musica.isPublic }),
                      'publicar',
                    )
                  }
                />
                <BotaoAcao
                  rotulo={t('musica.estender')}
                  ocupado={ocupado === 'estender'}
                  onClick={() =>
                    void acao(
                      () => api.post(`/songs/${musica.id}/extend`, { addSeconds: 30 }),
                      'estender',
                    )
                  }
                />
                <BotaoAcao
                  rotulo={t('musica.stems')}
                  ocupado={ocupado === 'stems'}
                  onClick={() => void acao(() => api.post(`/songs/${musica.id}/stems`, {}), 'stems')}
                />
              </>
            )}
          </div>

          {aviso && (
            <p role="alert" className="mt-4 rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-perigo">
              {aviso}
            </p>
          )}
        </div>
      </div>

      {usuario && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">{t('musica.baixar')}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {musica.downloads.map((d) => (
              <li key={d.format} className="card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{d.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-texto-suave">{d.note}</p>
                  <p className="mt-0.5 text-[11px] text-texto-fraco">~{d.estimatedMb} MB</p>
                </div>
                {d.allowed ? (
                  <button
                    type="button"
                    onClick={() => void baixar(d.format)}
                    disabled={ocupado === d.format}
                    className="shrink-0 rounded-lg border border-borda px-3 py-1.5 text-xs transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
                  >
                    {ocupado === d.format ? t('musica.convertendo') : t('musica.baixar')}
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-texto-fraco">
                    {t('musica.somenteePagos')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {musica.lyrics && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">{t('criar.letra')}</h2>
          <pre className="card mt-3 whitespace-pre-wrap p-4 font-sans text-sm leading-relaxed text-texto-suave">
            {musica.lyrics}
          </pre>
        </section>
      )}

      {musica.stems.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">{t('musica.stems')}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {musica.stems.map((s) => (
              <li key={s.kind} className="card flex items-center justify-between p-3 text-sm">
                <span className="capitalize">{s.kind}</span>
                <a href={s.url} className="text-xs text-acento hover:underline">
                  {t('musica.baixar')}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Comentários só depois do conteúdo: quem abre a página quer ouvir a
          música, não ler a conversa sobre ela. */}
      <Comentarios songId={musica.id} />

      {minha && <GerenciarMusica musica={musica} aoAtualizar={carregar} />}

      <p className="mt-10 text-xs text-texto-fraco">
        {new Date(musica.createdAt).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US')}
      </p>
    </div>
  );
}

function BotaoAcao({
  rotulo,
  onClick,
  ocupado,
}: {
  rotulo: string;
  onClick: () => void;
  ocupado: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      className="rounded-xl border border-borda px-4 py-2.5 text-sm transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
    >
      {rotulo}
    </button>
  );
}
