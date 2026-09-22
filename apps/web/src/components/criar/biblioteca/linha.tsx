'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AdicionarAPlaylist } from '@/components/musica/adicionar-playlist';
import { BotaoCurtir } from '@/components/musica/curtir';
import { ApiError, api, type Musica } from '@/lib/api';
import { formatarContagem, formatarDuracao, useI18n } from '@/lib/i18n';
import { paraFaixa, usePlayer, type FaixaTocando } from '@/lib/player';
import { ROTULOS_STATUS, useProgresso } from '@/lib/progresso';
import { BotaoCancelar } from '../cancelar';
import {
  AbrirIcone,
  BaixarIcone,
  BrilhoIcone,
  CadeadoIcone,
  CompartilharIcone,
  ConfirmarIcone,
  GloboIcone,
  LapisIcone,
  LixeiraIcone,
  PausarIcone,
  PontosIcone,
  TocarIcone,
} from '../icones';
import { ItemMenu, MenuSuspenso } from '../menu-suspenso';
import { FormaDeOnda } from './forma-de-onda';

/**
 * Uma faixa em linha, no desenho da referência: o ponto de "tocando" à
 * esquerda, a capa com a duração, o título com a etiqueta do tipo, a
 * descrição (ou a onda) e a fileira de ações; o menu "…" fica à direita.
 *
 * Enquanto gera, a mesma linha mostra a etapa e a barra de progresso no lugar
 * da capa: a faixa já existe na biblioteca desde que entrou na fila, e trocar
 * de componente quando ela fica pronta faria a lista pular.
 */
export function LinhaBiblioteca({
  musica,
  fila,
  modo,
  aoAtualizar,
  aoUsarReferencia,
  aoPedirOnda,
}: {
  musica: Musica;
  fila: Musica[];
  modo: 'lista' | 'onda';
  aoAtualizar: () => void;
  aoUsarReferencia: (m: Musica) => void;
  aoPedirOnda: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const { tocar, faixa, tocando, alternar } = usePlayer();
  const { progressoDaMusica } = useProgresso();

  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState(musica.title);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  const progresso = progressoDaMusica(musica.id);
  const capaUrl = progresso?.song?.coverUrl ?? musica.coverUrl;
  const pronta = musica.status === 'complete' && Boolean(musica.audioUrl);
  const falhou = musica.status === 'failed' || musica.status === 'canceled';
  const atual = faixa?.id === musica.id;
  const estaTocando = atual && tocando;

  function aoTocar() {
    if (!pronta) return;
    if (atual) {
      alternar();
      return;
    }
    const nova = paraFaixa(musica);
    if (!nova) return;
    const novaFila = fila.map((m) => paraFaixa(m)).filter((f): f is FaixaTocando => f !== null);
    tocar(nova, novaFila);
  }

  async function agir(chave: string, chamada: () => Promise<unknown>) {
    setOcupado(chave);
    setAviso(null);
    try {
      await chamada();
      aoAtualizar();
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
    }
  }

  async function compartilhar() {
    const url = `${window.location.origin}/musica/${musica.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    } catch {
      setAviso(url);
    }
  }

  async function baixarMp3() {
    setOcupado('baixar');
    setAviso(null);
    try {
      const r = await api.get<{ url?: string; message?: string }>(`/songs/${musica.id}/download?format=mp3`);
      if (r.url) window.location.href = r.url;
      else setAviso(r.message ?? t('musica.convertendo'));
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
    }
  }

  function salvarTitulo() {
    const limpo = novoTitulo.trim();
    setRenomeando(false);
    if (!limpo || limpo === musica.title) {
      setNovoTitulo(musica.title);
      return;
    }
    void agir('renomear', () => api.patch(`/songs/${musica.id}`, { title: limpo }));
  }

  const etiqueta = musica.kind !== 'song' ? t(`lib.kind.${musica.kind}`) : null;

  return (
    <article
      className={`group flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-superficie/70 ${
        atual ? 'bg-superficie/50' : ''
      }`}
    >
      {/* O ponto de "tocando agora". Ocupa o espaço mesmo apagado, para as
          capas ficarem alinhadas de cima a baixo. */}
      <span
        className={`size-2 shrink-0 rounded-full ${atual ? 'bg-acento' : 'bg-transparent'}`}
        aria-hidden={!atual}
        title={atual ? t('lib.tocando') : undefined}
      />

      <button
        type="button"
        onClick={aoTocar}
        disabled={!pronta}
        aria-label={`${estaTocando ? 'Pausar' : 'Tocar'} ${musica.title}`}
        className="relative size-[84px] shrink-0 overflow-hidden rounded-xl bg-superficie-alta"
      >
        <Capa url={capaUrl} titulo={musica.title} />
        {pronta ? (
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${
              estaTocando ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            }`}
          >
            {estaTocando ? <PausarIcone tamanho={26} /> : <TocarIcone tamanho={26} />}
          </span>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/65 px-2">
            <span className="text-center text-[10px] leading-tight text-texto-suave">
              {falhou
                ? (ROTULOS_STATUS[musica.status]?.[locale] ?? musica.status)
                : progresso
                  ? (ROTULOS_STATUS[progresso.status]?.[locale] ?? progresso.status)
                  : (ROTULOS_STATUS[musica.status]?.[locale] ?? t('geral.carregando'))}
            </span>
            {!falhou && (
              <span className="h-1 w-14 overflow-hidden rounded-full bg-borda">
                <span
                  className={`block h-full gradiente-acento transition-all duration-500 ${progresso ? '' : 'pulsando'}`}
                  style={{ width: `${progresso?.progress ?? 15}%` }}
                />
              </span>
            )}
          </span>
        )}
        {musica.durationMs > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {formatarDuracao(musica.durationMs)}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {renomeando ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                salvarTitulo();
              }}
              className="flex min-w-0 flex-1 items-center gap-1"
            >
              <input
                value={novoTitulo}
                onChange={(e) => setNovoTitulo(e.target.value)}
                onBlur={salvarTitulo}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setNovoTitulo(musica.title);
                    setRenomeando(false);
                  }
                }}
                maxLength={160}
                autoFocus
                aria-label={t('gerenciar.nome')}
                className="min-w-0 flex-1 rounded-lg border border-borda bg-fundo px-2 py-1 text-[15px] font-semibold outline-none focus:border-acento"
              />
              <button type="submit" aria-label={t('geral.salvar')} className="p-1 text-acento">
                <ConfirmarIcone tamanho={16} />
              </button>
            </form>
          ) : (
            <Link
              href={`/musica/${musica.id}`}
              className="truncate text-[15px] font-semibold leading-snug hover:underline"
            >
              {musica.title}
            </Link>
          )}
          {etiqueta && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-acento">
              {etiqueta}
            </span>
          )}
          {!musica.isPublic && (
            <span className="shrink-0 text-texto-fraco" title={t('musica.privada')}>
              <CadeadoIcone tamanho={12} />
            </span>
          )}
        </div>

        {modo === 'onda' ? (
          <div className="mt-1.5 pr-4">
            <FormaDeOnda musica={musica} fila={fila} aoPedirOnda={aoPedirOnda} altura={40} />
          </div>
        ) : (
          <p className="mt-0.5 line-clamp-1 text-xs text-texto-suave">
            {/* Quando o título nasceu igual ao prompt, repetir a frase pareceria
                defeito: a segunda linha vira duração e reproduções. */}
            {progresso?.error ??
              (falhou
                ? (ROTULOS_STATUS[musica.status]?.[locale] ?? musica.status)
                : musica.stylePrompt && musica.stylePrompt.trim() !== musica.title.trim()
                  ? musica.stylePrompt
                  : [
                      musica.instrumental ? t('criar.instrumental') : null,
                      musica.durationMs > 0 ? formatarDuracao(musica.durationMs) : null,
                      `${formatarContagem(musica.playCount, locale)} ${t(
                        musica.playCount === 1 ? 'musica.reproducao' : 'musica.reproducoes',
                      )}`,
                    ]
                      .filter(Boolean)
                      .join(' · '))}
          </p>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <BotaoCurtir
            songId={musica.id}
            curtidoInicial={musica.likedByMe}
            contagemInicial={musica.likeCount}
            tamanho="linha"
          />
          {pronta && <AdicionarAPlaylist songId={musica.id} compacto />}
          <button
            type="button"
            disabled={!pronta || ocupado === 'publicar'}
            onClick={() =>
              void agir('publicar', () =>
                api.post(`/songs/${musica.id}/publish`, { isPublic: !musica.isPublic }),
              )
            }
            aria-pressed={musica.isPublic}
            aria-label={musica.isPublic ? t('musica.despublicar') : t('musica.publicar')}
            title={musica.isPublic ? t('musica.despublicar') : t('musica.publicar')}
            className={`flex size-8 items-center justify-center rounded-full bg-superficie-alta transition-colors hover:bg-borda disabled:cursor-not-allowed disabled:opacity-35 ${
              musica.isPublic ? 'text-acento' : 'text-texto-suave hover:text-texto'
            }`}
          >
            {musica.isPublic ? <GloboIcone tamanho={15} /> : <CadeadoIcone tamanho={15} />}
          </button>
          <button
            type="button"
            onClick={() => void compartilhar()}
            aria-label={t('lib.compartilhar')}
            title={copiado ? t('lib.linkCopiado') : t('lib.compartilhar')}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-full bg-superficie-alta px-2.5 transition-colors hover:bg-borda ${
              copiado ? 'text-acento' : 'text-texto-suave hover:text-texto'
            }`}
          >
            {copiado ? <ConfirmarIcone tamanho={15} /> : <CompartilharIcone tamanho={15} />}
            {copiado && <span className="text-[11px]">{t('lib.linkCopiado')}</span>}
          </button>
          {!pronta && !falhou && progresso && (
            <span className="ml-1 text-xs text-texto-fraco">
              <BotaoCancelar generationId={progresso.generationId} />
            </span>
          )}
        </div>

        {aviso && (
          <p role="alert" className="mt-1.5 truncate text-xs text-texto-suave">
            {aviso}
          </p>
        )}
      </div>

      <MenuSuspenso
        alinhamento="direita"
        largura="w-56"
        gatilho={(aberto) => (
          <button
            type="button"
            aria-label={t('lib.maisAcoes')}
            title={t('lib.maisAcoes')}
            aria-expanded={aberto}
            className={`flex size-11 items-center justify-center rounded-full bg-superficie text-texto-suave transition-colors hover:bg-superficie-alta hover:text-texto ${
              aberto ? 'bg-superficie-alta text-texto' : ''
            }`}
          >
            <PontosIcone tamanho={18} />
          </button>
        )}
      >
        {(fechar) => (
          <>
            <ItemMenu icone={<AbrirIcone tamanho={15} />} onClick={fechar}>
              <Link href={`/musica/${musica.id}`} className="block">
                {t('lib.abrir')}
              </Link>
            </ItemMenu>
            {pronta && (
              <>
                <ItemMenu
                  icone={estaTocando ? <PausarIcone tamanho={15} /> : <TocarIcone tamanho={15} />}
                  onClick={() => {
                    aoTocar();
                    fechar();
                  }}
                >
                  {estaTocando ? 'Pausar' : t('musica.tocar')}
                </ItemMenu>
                <ItemMenu
                  icone={<BaixarIcone tamanho={15} />}
                  onClick={() => {
                    void baixarMp3();
                    fechar();
                  }}
                >
                  {ocupado === 'baixar' ? t('musica.convertendo') : t('lib.baixarMp3')}
                </ItemMenu>
                <ItemMenu
                  icone={<BrilhoIcone tamanho={15} />}
                  onClick={() => {
                    aoUsarReferencia(musica);
                    fechar();
                  }}
                >
                  {t('lib.usarReferencia')}
                </ItemMenu>
              </>
            )}
            <ItemMenu
              icone={<LapisIcone tamanho={15} />}
              onClick={() => {
                setNovoTitulo(musica.title);
                setRenomeando(true);
                fechar();
              }}
            >
              {t('lib.renomear')}
            </ItemMenu>
            <ItemMenu
              icone={<LixeiraIcone tamanho={15} />}
              perigo
              onClick={() => {
                if (!confirmandoExclusao) {
                  setConfirmandoExclusao(true);
                  return;
                }
                setConfirmandoExclusao(false);
                fechar();
                void agir('excluir', () => api.delete(`/songs/${musica.id}`));
              }}
            >
              {confirmandoExclusao ? t('gerenciar.confirmarExclusao') : t('musica.excluir')}
            </ItemMenu>
          </>
        )}
      </MenuSuspenso>
    </article>
  );
}

function Capa({ url, titulo }: { url: string | null; titulo: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do R2, expira
    return <img src={url} alt="" className="size-full object-cover" />;
  }
  return (
    <span className="flex size-full items-center justify-center gradiente-acento" aria-hidden>
      <span className="text-2xl font-black text-white/90">{titulo.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}
