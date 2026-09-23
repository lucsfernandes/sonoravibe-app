'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  AbrirIcone,
  AnteriorIcone,
  BaixarIcone,
  ComentarioIcone,
  CompartilharIcone,
  ConfirmarIcone,
  CopiarIcone,
  EmbaralharIcone,
  FilaIcone,
  InfoIcone,
  PausarIcone,
  PontosIcone,
  ProximoIcone,
  RepetirIcone,
  RepetirUmaIcone,
  TocarIcone,
  VolumeIcone,
} from '@/components/criar/icones';
import { ItemMenu, MenuSuspenso } from '@/components/criar/menu-suspenso';
import { BotaoIcone } from '@/components/musica/botao-icone';
import { BotaoCurtir } from '@/components/musica/curtir';
import { ApiError, api } from '@/lib/api';
import { formatarDuracao, useI18n } from '@/lib/i18n';
import { usePlayer } from '@/lib/player';
import { useSessao } from '@/lib/sessao';

/**
 * Player fixo no rodapé, no desenho da referência: capa, título e autor à
 * esquerda; embaralhar, anterior, tocar, próxima e repetir no centro, com a
 * barra de tempo logo abaixo; fila, curtir, comentar, compartilhar, mais,
 * volume e detalhes à direita.
 *
 * Só aparece quando há faixa carregada — uma barra vazia ocupando 80px do
 * rodapé desde o primeiro acesso é ruído.
 *
 * A altura real do player vai para a variável CSS `--altura-player` na raiz
 * do documento. É ela que a casca, a barra lateral e a aba Criar usam para
 * abrir espaço embaixo: um valor fixo em cada lugar foi o que deixou o box
 * do usuário escondido atrás do player quando uma faixa tocava.
 */
export function Player() {
  const {
    faixa,
    fila,
    tocando,
    posicaoMs,
    duracaoMs,
    volume,
    mudo,
    embaralhando,
    repeticao,
    alternar,
    proxima,
    anterior,
    buscar,
    setVolume,
    alternarMudo,
    alternarEmbaralhar,
    alternarRepeticao,
    tocarDaFila,
  } = usePlayer();
  const { t } = useI18n();
  const { usuario } = useSessao();
  const caixa = useRef<HTMLDivElement>(null);

  const [copiado, setCopiado] = useState(false);
  const [volumeAberto, setVolumeAberto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const raiz = document.documentElement;
    const el = caixa.current;
    if (!faixa || !el) {
      raiz.style.setProperty('--altura-player', '0px');
      return;
    }
    const aplicar = () => raiz.style.setProperty('--altura-player', `${el.offsetHeight}px`);
    aplicar();
    const observador = new ResizeObserver(aplicar);
    observador.observe(el);
    return () => {
      observador.disconnect();
      raiz.style.setProperty('--altura-player', '0px');
    };
  }, [faixa]);

  // O aviso (link que não deu para copiar, download que falhou) some sozinho.
  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(id);
  }, [aviso]);

  if (!faixa) return null;

  // A duração do backend é a fonte confiável; a medida pelo navegador só entra
  // quando é finita (ver player.tsx: FLAC via URL assinada devolve Infinity).
  const total =
    Number.isFinite(duracaoMs) && duracaoMs > 0 ? duracaoMs : faixa.durationMs || 1;
  const progresso = Math.min(100, (posicaoMs / total) * 100);
  const href = `/musica/${faixa.id}`;

  async function compartilhar() {
    const url = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    } catch {
      setAviso(url);
    }
  }

  async function baixarMp3() {
    if (!faixa) return;
    try {
      const r = await api.get<{ url?: string; message?: string }>(
        `/songs/${faixa.id}/download?format=mp3`,
      );
      if (r.url) window.location.href = r.url;
      else setAviso(r.message ?? t('musica.convertendo'));
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }

  const rotuloRepetir =
    repeticao === 'off'
      ? t('player.repetir')
      : repeticao === 'all'
        ? t('player.repetirTudo')
        : t('player.repetirUma');

  const barra = (
    <input
      id="posicao-faixa"
      type="range"
      min={0}
      max={total}
      value={Math.min(posicaoMs, total)}
      onChange={(e) => buscar(Number(e.target.value))}
      aria-label={t('player.posicao')}
      className="block h-1 w-full min-w-0 cursor-pointer appearance-none rounded-full accent-acento"
      style={{
        background: `linear-gradient(to right, var(--color-acento) ${progresso}%, var(--color-borda) ${progresso}%)`,
      }}
    />
  );

  return (
    <div
      ref={caixa}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-borda bg-fundo/95 backdrop-blur"
    >
      {/* No celular a barra de tempo fica colada no topo, fina, para sobrar
          espaço para os controles. No desktop ela mora no centro, com os tempos. */}
      <div className="sm:hidden">{barra}</div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)] sm:px-4 sm:py-2.5">
        {/* Esquerda: a faixa */}
        <div className="flex min-w-0 items-center gap-3">
          <Link href={href} className="shrink-0" aria-label={t('musica.detalhes')}>
            <Capa url={faixa.coverUrl} titulo={faixa.title} />
          </Link>
          <div className="min-w-0">
            <Link href={href} className="block truncate text-sm font-semibold hover:underline">
              {faixa.title}
            </Link>
            {faixa.autor &&
              (faixa.autorHandle ? (
                <Link
                  href={`/u/${faixa.autorHandle}`}
                  className="block truncate text-xs text-texto-suave hover:text-texto"
                >
                  {faixa.autor}
                </Link>
              ) : (
                <p className="truncate text-xs text-texto-suave">{faixa.autor}</p>
              ))}
          </div>
        </div>

        {/* Centro: controles e tempo */}
        <div className="flex min-w-0 flex-col items-center gap-1">
          <div className="flex items-center gap-0.5 sm:gap-1.5">
            <BotaoIcone
              rotulo={t('player.embaralhar')}
              ativo={embaralhando}
              aria-pressed={embaralhando}
              onClick={alternarEmbaralhar}
              className="hidden sm:flex"
            >
              <EmbaralharIcone tamanho={16} />
            </BotaoIcone>

            <BotaoIcone rotulo={t('player.anterior')} onClick={anterior}>
              <AnteriorIcone tamanho={18} />
            </BotaoIcone>

            <button
              type="button"
              onClick={alternar}
              aria-label={tocando ? t('musica.pausar') : t('musica.tocar')}
              title={tocando ? t('musica.pausar') : t('musica.tocar')}
              className="flex size-9 items-center justify-center rounded-full bg-texto text-fundo transition-transform hover:scale-105"
            >
              {tocando ? <PausarIcone tamanho={18} /> : <TocarIcone tamanho={18} />}
            </button>

            <BotaoIcone rotulo={t('player.proxima')} onClick={proxima}>
              <ProximoIcone tamanho={18} />
            </BotaoIcone>

            <BotaoIcone
              rotulo={rotuloRepetir}
              ativo={repeticao !== 'off'}
              aria-pressed={repeticao !== 'off'}
              onClick={alternarRepeticao}
              className="hidden sm:flex"
            >
              {repeticao === 'one' ? <RepetirUmaIcone tamanho={16} /> : <RepetirIcone tamanho={16} />}
            </BotaoIcone>
          </div>

          <div className="hidden w-full items-center gap-2 text-[11px] tabular-nums text-texto-suave sm:flex">
            <span className="w-9 shrink-0 text-right">{formatarDuracao(posicaoMs)}</span>
            {barra}
            <span className="w-9 shrink-0">{formatarDuracao(total)}</span>
          </div>
        </div>

        {/* Direita: ações. Só no desktop; no celular a página da música tem tudo. */}
        <div className="hidden items-center justify-end gap-0.5 md:flex">
          <MenuSuspenso
            direcao="cima"
            alinhamento="direita"
            largura="w-72"
            gatilho={(aberto) => (
              <BotaoIcone rotulo={t('player.fila')} ativo={aberto} aria-expanded={aberto}>
                <FilaIcone tamanho={17} />
              </BotaoIcone>
            )}
          >
            {(fechar) => (
              <div className="max-h-80 overflow-y-auto">
                <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-texto-fraco">
                  {t('player.fila')} · {fila.length}
                </p>
                {fila.map((f) => (
                  <ItemMenu
                    key={f.id}
                    ativo={f.id === faixa.id}
                    icone={
                      f.id === faixa.id && tocando ? (
                        <PausarIcone tamanho={13} />
                      ) : (
                        <TocarIcone tamanho={13} />
                      )
                    }
                    onClick={() => {
                      if (f.id === faixa.id) alternar();
                      else tocarDaFila(f.id);
                      fechar();
                    }}
                  >
                    {f.title}
                    {f.autor && <span className="text-texto-fraco"> · {f.autor}</span>}
                  </ItemMenu>
                ))}
              </div>
            )}
          </MenuSuspenso>

          <BotaoCurtir
            songId={faixa.id}
            curtidoInicial={faixa.likedByMe ?? false}
            contagemInicial={faixa.likeCount ?? 0}
            tamanho="icone"
          />

          <Link
            href={`${href}#comentarios`}
            aria-label={t('musica.abrirComentarios')}
            title={t('musica.abrirComentarios')}
            className="flex size-9 items-center justify-center rounded-full text-texto-suave transition-colors hover:bg-superficie hover:text-texto"
          >
            <ComentarioIcone tamanho={17} />
          </Link>

          <BotaoIcone
            rotulo={copiado ? t('lib.linkCopiado') : t('lib.compartilhar')}
            ativo={copiado}
            onClick={() => void compartilhar()}
          >
            {copiado ? <ConfirmarIcone tamanho={17} /> : <CompartilharIcone tamanho={17} />}
          </BotaoIcone>

          <MenuSuspenso
            direcao="cima"
            alinhamento="direita"
            gatilho={(aberto) => (
              <BotaoIcone rotulo={t('lib.maisAcoes')} ativo={aberto} aria-expanded={aberto}>
                <PontosIcone tamanho={18} />
              </BotaoIcone>
            )}
          >
            {(fechar) => (
              <>
                <ItemMenu icone={<AbrirIcone tamanho={15} />} onClick={fechar}>
                  <Link href={href} className="block">
                    {t('lib.abrir')}
                  </Link>
                </ItemMenu>
                {usuario && (
                  <ItemMenu
                    icone={<BaixarIcone tamanho={15} />}
                    onClick={() => {
                      void baixarMp3();
                      fechar();
                    }}
                  >
                    {t('lib.baixarMp3')}
                  </ItemMenu>
                )}
                <ItemMenu
                  icone={<CopiarIcone tamanho={15} />}
                  onClick={() => {
                    void compartilhar();
                    fechar();
                  }}
                >
                  {t('lib.compartilhar')}
                </ItemMenu>
              </>
            )}
          </MenuSuspenso>

          {/* Volume: passar o mouse abre o controle, clicar silencia. */}
          <div
            className="relative"
            onMouseEnter={() => setVolumeAberto(true)}
            onMouseLeave={() => setVolumeAberto(false)}
          >
            <BotaoIcone
              rotulo={mudo ? t('player.ativarSom') : t('player.silenciar')}
              onClick={alternarMudo}
              onFocus={() => setVolumeAberto(true)}
            >
              <VolumeIcone tamanho={17} mudo={mudo} />
            </BotaoIcone>
            {volumeAberto && (
              <div className="absolute bottom-full right-0 mb-1 flex w-40 items-center gap-2 rounded-xl border border-borda bg-superficie-alta px-3 py-2.5 shadow-xl">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  onBlur={() => setVolumeAberto(false)}
                  aria-label={t('player.volume')}
                  className="w-full accent-acento"
                />
              </div>
            )}
          </div>

          <Link
            href={href}
            aria-label={t('musica.detalhes')}
            title={t('musica.detalhes')}
            className="flex size-9 items-center justify-center rounded-full text-texto-suave transition-colors hover:bg-superficie hover:text-texto"
          >
            <InfoIcone tamanho={17} />
          </Link>
        </div>
      </div>

      {aviso && (
        <p role="status" className="truncate px-4 pb-2 text-center text-xs text-texto-suave">
          {aviso}
        </p>
      )}
    </div>
  );
}

function Capa({ url, titulo }: { url: string | null; titulo: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do R2, troca a cada leitura: o otimizador do Next não teria o que cachear.
    return <img src={url} alt="" className="size-11 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <div
      className="flex size-11 shrink-0 items-center justify-center rounded-lg gradiente-acento text-sm font-bold text-white"
      aria-hidden
    >
      {titulo.slice(0, 1).toUpperCase()}
    </div>
  );
}
