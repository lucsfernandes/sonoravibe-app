'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import {
  BaixarIcone,
  CompartilharIcone,
  ComentarioIcone,
  ConfirmarIcone,
  CopiarIcone,
  GloboIcone,
  CadeadoIcone,
  LapisIcone,
  PausarIcone,
  PontosIcone,
  TocarIcone,
} from '@/components/criar/icones';
import { ItemMenu, MenuSuspenso } from '@/components/criar/menu-suspenso';
import { Modal } from '@/components/criar/modal';
import { AdicionarAPlaylist } from '@/components/musica/adicionar-playlist';
import { BotaoIcone } from '@/components/musica/botao-icone';
import { Comentarios } from '@/components/musica/comentarios';
import { BotaoCurtir } from '@/components/musica/curtir';
import { Derivar } from '@/components/musica/derivar';
import { EditarAudio } from '@/components/musica/editar-audio';
import { GerenciarMusica } from '@/components/musica/gerenciar';
import { LetraExibida } from '@/components/musica/letra-exibida';
import { Relacionadas } from '@/components/musica/relacionadas';
import { TextoEditavel } from '@/components/musica/texto-editavel';
import { Avatar } from '@/components/shell/avatar';
import { ApiError, api, type ItemExplore, type MusicaDetalhe } from '@/lib/api';
import { CREDIT_COSTS } from '@sonora/shared';
import { formatarContagem, useI18n } from '@/lib/i18n';
import { paraFaixa, usePlayer, type FaixaTocando } from '@/lib/player';
import { useAoConcluirGeracao } from '@/lib/progresso';
import { useSessao } from '@/lib/sessao';

/**
 * Página da música, no desenho da referência: a capa e a letra à esquerda, o
 * título, o autor, o estilo, as ações e os comentários no meio, e a lateral
 * com as parecidas e as do mesmo autor à direita.
 *
 * O autor edita o título, o estilo e a letra clicando neles, sem sair da
 * página; a manutenção (áudio, remix, permissões, exclusão) e os downloads
 * ficam em janelas abertas pelos botões sobre a capa, para a página não
 * virar uma lista de painéis recolhidos como era antes.
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
  const [copiado, setCopiado] = useState<'link' | 'estilo' | null>(null);
  const [janela, setJanela] = useState<'editar' | 'baixar' | null>(null);
  const [similares, setSimilares] = useState<ItemExplore[]>([]);

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

  // Capa nova, remix ou trecho terminaram: recarrega sem a pessoa precisar
  // atualizar a página. É o que o aviso "aparece aqui quando ficar pronta"
  // promete.
  useAoConcluirGeracao(() => void carregar());

  useEffect(() => {
    if (!copiado) return;
    const timer = setTimeout(() => setCopiado(null), 1600);
    return () => clearTimeout(timer);
  }, [copiado]);

  if (erro) return <p className="p-8 text-sm text-perigo">{erro}</p>;
  if (!musica) return <p className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</p>;

  // `isMine` vem do backend. Antes isto era só `usuario != null`, o que fazia
  // Publicar, Estender e Separar stems aparecerem na música dos outros.
  const minha = musica.isMine;
  const pronta = musica.status === 'complete';
  const posso = minha && pronta;
  const estaTocando = faixa?.id === musica.id && tocando;
  const podeRemixar = Boolean(usuario) && pronta && (minha || musica.allowRemixes);

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

  /** Título, estilo ou letra: a API devolve a música inteira já atualizada. */
  async function salvarCampo(patch: Record<string, unknown>) {
    if (!musica) return;
    setMusica(await api.patch<MusicaDetalhe>(`/songs/${musica.id}`, patch));
  }

  function tocarEsta() {
    if (!musica) return;
    if (faixa?.id === musica.id) {
      alternar();
      return;
    }
    const nova = paraFaixa(musica, musica.author);
    if (!nova) return;
    // Depois desta, as parecidas: é o que a lateral está mostrando.
    const fila = [
      nova,
      ...similares.map((m) => paraFaixa(m)).filter((f): f is FaixaTocando => f !== null),
    ];
    tocar(nova, fila);
  }

  async function copiar(texto: string, o: 'link' | 'estilo') {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(o);
    } catch {
      setAviso(texto);
    }
  }

  const linkDaMusica = () => `${window.location.origin}/musica/${musica.id}`;
  const criadaEm = new Date(musica.createdAt).toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[288px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* Capa e letra */}
        <div>
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-superficie-alta">
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

            {(posso || (usuario && pronta)) && (
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
                {posso && (
                  <button
                    type="button"
                    onClick={() => setJanela('editar')}
                    className="flex h-10 items-center gap-2 rounded-full bg-black/70 px-4 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-black/85"
                  >
                    <LapisIcone tamanho={15} />
                    {t('musica.editar')}
                  </button>
                )}
                {usuario && pronta && (
                  <button
                    type="button"
                    onClick={() => setJanela('baixar')}
                    aria-label={t('musica.baixarTitulo')}
                    title={t('musica.baixarTitulo')}
                    className="flex size-10 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur transition-colors hover:bg-black/85"
                  >
                    <BaixarIcone tamanho={17} />
                  </button>
                )}
              </div>
            )}
          </div>

          <LetraExibida
            letra={musica.lyrics}
            podeEditar={posso}
            aoSalvar={(letra) => salvarCampo({ lyrics: letra })}
          />
        </div>

        {/* Título, autor, estilo, ações e comentários */}
        <div className="min-w-0">
          <h1 className="border-b border-borda pb-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            <TextoEditavel
              valor={musica.title}
              podeEditar={minha}
              aoSalvar={(v) => salvarCampo({ title: v })}
              rotulo={t('musica.editarTitulo')}
              maxLength={160}
              classeTexto="text-3xl font-semibold tracking-tight sm:text-4xl"
            />
          </h1>

          <Link
            href={`/u/${musica.author.handle}`}
            className="mt-4 inline-flex items-center gap-2.5 rounded-full pr-2 transition-colors hover:bg-superficie"
          >
            <Avatar url={musica.author.avatarUrl} nome={musica.author.displayName} tamanho={32} />
            <span className="text-sm font-medium">{musica.author.displayName}</span>
          </Link>

          {(musica.stylePrompt || minha) && (
            <div className="mt-4 flex items-start gap-2">
              <p className="min-w-0 flex-1 text-sm leading-relaxed text-texto-suave">
                <TextoEditavel
                  valor={musica.stylePrompt}
                  podeEditar={minha}
                  aoSalvar={(v) => salvarCampo({ stylePrompt: v })}
                  rotulo={t('musica.editarEstilo')}
                  multilinha
                  maxLength={1000}
                  vazio={t('musica.semEstilo')}
                  classeTexto="text-sm leading-relaxed"
                />
              </p>
              {musica.stylePrompt && (
                <BotaoIcone
                  rotulo={copiado === 'estilo' ? t('musica.copiado') : t('musica.copiarEstilo')}
                  ativo={copiado === 'estilo'}
                  onClick={() => void copiar(musica.stylePrompt ?? '', 'estilo')}
                  className="-mt-1 size-8"
                >
                  {copiado === 'estilo' ? <ConfirmarIcone tamanho={15} /> : <CopiarIcone tamanho={15} />}
                </BotaoIcone>
              )}
            </div>
          )}

          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-texto-fraco">
            <span>{criadaEm}</span>
            {!musica.isPublic && (
              <span className="inline-flex items-center gap-1 rounded bg-superficie-alta px-1.5 py-0.5">
                <CadeadoIcone tamanho={11} />
                {t('musica.privada')}
              </span>
            )}
            {/* O motor NÃO aparece. Qual modelo gerou a faixa é decisão nossa
                de infraestrutura, e pode mudar amanhã sem a música mudar;
                dizer "lyria" ao usuário cria expectativa sobre algo que ele
                não escolheu e não controla. O dado segue no banco para
                suporte e diagnóstico. */}
          </p>

          {/* A fileira de ações da referência: contagens à esquerda, os botões
              grandes à direita. */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span
              className="flex h-9 items-center gap-1.5 rounded-full bg-superficie-alta px-3 text-xs tabular-nums text-texto-suave"
              title={t('musica.reproducoes')}
            >
              <TocarIcone tamanho={12} />
              {formatarContagem(musica.playCount, locale)}
            </span>

            <a
              href="#comentarios"
              className="flex h-9 items-center gap-1.5 rounded-full bg-superficie-alta px-3 text-xs tabular-nums text-texto-suave transition-colors hover:bg-borda hover:text-texto"
              title={t('musica.abrirComentarios')}
            >
              <ComentarioIcone tamanho={15} />
              {formatarContagem(musica.commentCount, locale)}
            </a>

            {/* Curtir vale para qualquer pessoa que alcance a música: se ela
                é privada, só o dono chega até aqui de qualquer forma. */}
            <BotaoCurtir
              songId={musica.id}
              curtidoInicial={musica.likedByMe}
              contagemInicial={musica.likeCount}
              tamanho="linha"
            />

            <MenuSuspenso
              gatilho={(aberto) => (
                <BotaoIcone
                  rotulo={t('lib.maisAcoes')}
                  ativo={aberto}
                  aria-expanded={aberto}
                  className="bg-superficie-alta hover:bg-borda"
                >
                  <PontosIcone tamanho={18} />
                </BotaoIcone>
              )}
            >
              {(fechar) => (
                <>
                  <ItemMenu
                    icone={<CopiarIcone tamanho={15} />}
                    onClick={() => {
                      void copiar(linkDaMusica(), 'link');
                      fechar();
                    }}
                  >
                    {t('lib.compartilhar')}
                  </ItemMenu>
                  {usuario && pronta && (
                    <ItemMenu
                      icone={<BaixarIcone tamanho={15} />}
                      onClick={() => {
                        setJanela('baixar');
                        fechar();
                      }}
                    >
                      {t('musica.baixar')}
                    </ItemMenu>
                  )}
                  {posso && (
                    <>
                      <ItemMenu
                        icone={musica.isPublic ? <CadeadoIcone tamanho={15} /> : <GloboIcone tamanho={15} />}
                        onClick={() => {
                          fechar();
                          void acao(
                            () =>
                              api.post(`/songs/${musica.id}/publish`, { isPublic: !musica.isPublic }),
                            'publicar',
                          );
                        }}
                      >
                        {musica.isPublic ? t('musica.despublicar') : t('musica.publicar')}
                      </ItemMenu>
                      <ItemMenu
                        onClick={() => {
                          fechar();
                          void acao(
                            () => api.post(`/songs/${musica.id}/extend`, { addSeconds: 30 }),
                            'estender',
                          );
                        }}
                      >
                        {t('musica.estender')}
                      </ItemMenu>
                      <ItemMenu
                        onClick={() => {
                          fechar();
                          void acao(() => api.post(`/songs/${musica.id}/stems`, {}), 'stems');
                        }}
                      >
                        {t('musica.stems')}
                      </ItemMenu>
                      <ItemMenu
                        icone={<LapisIcone tamanho={15} />}
                        onClick={() => {
                          setJanela('editar');
                          fechar();
                        }}
                      >
                        {t('musica.edicaoTitulo')}
                      </ItemMenu>
                    </>
                  )}
                </>
              )}
            </MenuSuspenso>

            {ocupado && ocupado !== 'publicar' && (
              <span className="text-xs text-texto-fraco pulsando">{t('geral.enviando')}</span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* Playlist é do ouvinte, não do autor: dá para organizar a música
                  de outra pessoa na sua própria lista. */}
              {usuario && pronta && (
                <AdicionarAPlaylist songId={musica.id} compacto aparencia="quadrado" alinhamento="direita" />
              )}
              <button
                type="button"
                onClick={() => void copiar(linkDaMusica(), 'link')}
                aria-label={copiado === 'link' ? t('lib.linkCopiado') : t('lib.compartilhar')}
                title={copiado === 'link' ? t('lib.linkCopiado') : t('lib.compartilhar')}
                className={`flex size-11 items-center justify-center rounded-xl border border-borda transition-colors hover:bg-superficie-alta ${
                  copiado === 'link' ? 'text-acento' : ''
                }`}
              >
                {copiado === 'link' ? <ConfirmarIcone tamanho={18} /> : <CompartilharIcone tamanho={18} />}
              </button>
              {musica.audioUrl && (
                <button
                  type="button"
                  onClick={tocarEsta}
                  aria-label={estaTocando ? t('musica.pausar') : t('musica.tocar')}
                  title={estaTocando ? t('musica.pausar') : t('musica.tocar')}
                  className="flex h-11 w-16 items-center justify-center rounded-xl bg-texto text-fundo transition-transform hover:scale-105"
                >
                  {estaTocando ? <PausarIcone tamanho={20} /> : <TocarIcone tamanho={20} />}
                </button>
              )}
            </div>
          </div>

          {aviso && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-perigo"
            >
              {aviso}
            </p>
          )}

          <div className="mt-6">
            <Comentarios
              songId={musica.id}
              aoMudarTotal={(delta) =>
                setMusica((m) => (m ? { ...m, commentCount: Math.max(0, m.commentCount + delta) } : m))
              }
            />
          </div>
        </div>

        {/* Lateral: parecidas e do autor. No desktop largo fica presa ao lado;
            em telas menores desce para baixo das duas colunas. */}
        <aside className="lg:col-span-2 xl:col-span-1 xl:sticky xl:top-6 xl:h-[calc(100vh-var(--altura-player)-3rem)]">
          <Relacionadas
            songId={musica.id}
            autor={musica.author}
            podeRemixar={podeRemixar}
            aoCarregar={(dados) => setSimilares(dados.similar)}
          />
        </aside>
      </div>

      {janela === 'editar' && posso && (
        <Modal titulo={t('musica.edicaoTitulo')} aoFechar={() => setJanela(null)} largura="max-w-2xl">
          {/* Só o dono edita. A ordem segue o custo: primeiro o que é de graça
              (FFmpeg aqui), depois o que chama o motor e cobra crédito. */}
          <div className="px-5 pb-5">
            <EditarAudio songId={musica.id} duracaoMs={musica.durationMs} aoAplicar={carregar} />
            <Derivar
              songId={musica.id}
              duracaoMs={musica.durationMs}
              custoRemix={CREDIT_COSTS.remix}
              custoCapa={CREDIT_COSTS.cover}
              aoEnfileirar={carregar}
            />
            <GerenciarMusica musica={musica} aoAtualizar={carregar} />
          </div>
        </Modal>
      )}

      {janela === 'baixar' && usuario && (
        <Modal titulo={t('musica.baixarTitulo')} aoFechar={() => setJanela(null)}>
          <div className="px-5 py-4">
            <ul className="grid gap-2">
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

            {musica.stems.length > 0 && (
              <>
                <h3 className="mt-6 text-sm font-semibold">{t('musica.stems')}</h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {musica.stems.map((s) => (
                    <li key={s.kind} className="card flex items-center justify-between p-3 text-sm">
                      <span className="capitalize">{s.kind}</span>
                      <a href={s.url} className="text-xs text-acento hover:underline">
                        {t('musica.baixar')}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {aviso && (
              <p role="alert" className="mt-4 text-sm text-perigo">
                {aviso}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
