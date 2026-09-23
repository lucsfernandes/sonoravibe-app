'use client';

import Link from 'next/link';
import { formatarContagem, formatarDuracao, useI18n } from '@/lib/i18n';
import { paraFaixa, usePlayer, type FaixaTocando } from '@/lib/player';
import { ROTULOS_STATUS, useProgresso } from '@/lib/progresso';
import { BotaoCurtir } from './curtir';
import type { ItemExplore, Musica } from '@/lib/api';
import type { ModoVisualizacao } from './visualizacao';

/**
 * Cartão de uma música.
 *
 * O botão de tocar cobre a capa inteira em vez de ser um alvo pequeno no canto:
 * tocar é a ação que 90% das pessoas querem, e alvo grande é alvo fácil —
 * sobretudo no celular.
 */
export function CartaoMusica({
  musica,
  fila,
  autor,
  href,
  selecionada,
  aoSelecionar,
  modo = 'media',
}: {
  musica: Musica | ItemExplore;
  fila?: (Musica | ItemExplore)[];
  autor?: { handle: string; displayName: string };
  href?: string;
  /** Presente só onde há seleção em lote (a biblioteca). */
  selecionada?: boolean;
  aoSelecionar?: (id: string) => void;
  /** Como desenhar. 'media' é o cartão quadrado de sempre. */
  modo?: ModoVisualizacao;
}) {
  const { t, locale } = useI18n();
  const { tocar, faixa, tocando, alternar } = usePlayer();
  const { progressoDaMusica } = useProgresso();

  // Enquanto gera, o card mostra em que etapa está e quanto falta. Antes
  // mostrava só "Carregando...", que não distingue "na fila há 1 segundo" de
  // "travado há 5 minutos".
  const progresso = progressoDaMusica(musica.id);

  // A capa é desenhada em paralelo ao áudio e costuma ficar pronta antes: o
  // evento de progresso já traz a URL dela, e o card troca o gradiente pela
  // imagem por baixo da barra, sem esperar a lista recarregar.
  const capaUrl = progresso?.song?.coverUrl ?? musica.coverUrl;

  const estaTocando = faixa?.id === musica.id && tocando;
  const pronta = musica.status === 'complete' && Boolean(musica.audioUrl);

  const aoClicar = () => {
    if (!pronta) return;
    if (faixa?.id === musica.id) {
      alternar();
      return;
    }
    const nova = paraFaixa(musica, autor);
    if (!nova) return;
    // Na página de perfil todas são do mesmo autor; no Explore cada item traz
    // o seu, e `paraFaixa` o lê da própria música.
    const novaFila = (fila ?? [musica])
      .map((m) => paraFaixa(m, 'author' in m ? undefined : autor))
      .filter((f): f is FaixaTocando => f !== null);
    tocar(nova, novaFila);
  };

  const selecionavel = aoSelecionar !== undefined && pronta;

  // Lista e detalhes são linhas, não cartões: cabem três vezes mais faixas na
  // tela, que é o ponto de quem está procurando uma pelo nome.
  if (modo === 'lista' || modo === 'detalhes') {
    return (
      <Linha
        musica={musica}
        autor={autor}
        href={href}
        modo={modo}
        pronta={pronta}
        estaTocando={estaTocando}
        progresso={progresso}
        capaUrl={capaUrl}
        locale={locale}
        aoClicar={aoClicar}
        selecionada={selecionada}
        aoSelecionar={selecionavel ? aoSelecionar : undefined}
      />
    );
  }

  return (
    <article
      className={`group card overflow-hidden transition-colors ${
        selecionada ? 'border-acento' : 'hover:border-texto-fraco/40'
      }`}
    >
      <div className="relative aspect-square">
        <Capa url={capaUrl} titulo={musica.title} />

        {selecionavel && (
          // Acima do botão de tocar, que cobre a capa inteira: sem o z-index a
          // caixa ficaria embaixo e o clique viraria "tocar".
          <label className="absolute left-2 top-2 z-10 flex size-7 cursor-pointer items-center justify-center rounded-md bg-black/60 backdrop-blur">
            <input
              type="checkbox"
              checked={selecionada ?? false}
              onChange={() => aoSelecionar(musica.id)}
              aria-label={`${selecionada ? 'Desmarcar' : 'Selecionar'} ${musica.title}`}
              className="size-4 accent-acento"
            />
          </label>
        )}

        {pronta ? (
          <button
            type="button"
            onClick={aoClicar}
            aria-label={`${estaTocando ? 'Pausar' : 'Tocar'} ${musica.title}`}
            className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/40 focus-visible:bg-black/40"
          >
            <span
              className={`flex size-12 items-center justify-center rounded-full bg-texto text-fundo transition-opacity ${
                estaTocando ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {estaTocando ? <PausaIcone /> : <PlayIcone />}
            </span>
          </button>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-3">
            <span className="text-center text-[11px] leading-tight text-texto-suave">
              {progresso
                ? (ROTULOS_STATUS[progresso.status]?.[locale] ?? progresso.status)
                : t('geral.carregando')}
            </span>
            <div className="h-1 w-full max-w-24 overflow-hidden rounded-full bg-borda">
              <div
                className={`h-full gradiente-acento transition-all duration-500 ${
                  progresso ? '' : 'pulsando'
                }`}
                // Sem evento ainda: uma barra curta que pulsa diz "começou"
                // sem fingir um número que não temos.
                style={{ width: `${progresso?.progress ?? 15}%` }}
              />
            </div>
          </div>
        )}

        {musica.durationMs > 0 && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
            {formatarDuracao(musica.durationMs)}
          </span>
        )}
      </div>

      <div className="p-3">
        {href ? (
          <Link href={href} className="line-clamp-1 text-sm font-medium hover:underline">
            {musica.title}
          </Link>
        ) : (
          <p className="line-clamp-1 text-sm font-medium">{musica.title}</p>
        )}

        {autor ? (
          <Link
            href={`/u/${autor.handle}`}
            className="mt-0.5 block truncate text-xs text-texto-suave hover:text-texto"
          >
            {autor.displayName}
          </Link>
        ) : (
          // Quando o motor não sugere um nome, o título nasce igual ao prompt.
          // Repetir a mesma frase em duas linhas parece defeito, então a
          // segunda linha só aparece se disser algo diferente da primeira.
          musica.stylePrompt &&
          musica.stylePrompt.trim() !== musica.title.trim() && (
            <p className="mt-0.5 line-clamp-1 text-xs text-texto-suave">{musica.stylePrompt}</p>
          )
        )}

        <div className="mt-2 flex items-center gap-3 text-[11px] text-texto-fraco">
          <span className="flex items-center gap-1">
            <PlayPequenoIcone /> {formatarContagem(musica.playCount, locale)}
          </span>
          {/* A biblioteca e o Explore dizem se a pessoa já curtiu, então o
              coração é sempre um botão, e não só um contador. */}
          <BotaoCurtir
            songId={musica.id}
            curtidoInicial={musica.likedByMe}
            contagemInicial={musica.likeCount}
          />
          {!musica.isPublic && (
            <span className="ml-auto rounded bg-superficie-alta px-1.5 py-0.5">
              {t('musica.privada')}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function Capa({ url, titulo }: { url: string | null; titulo: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do R2, expira: nada a otimizar em cache.
    return <img src={url} alt="" className="size-full object-cover" />;
  }
  return (
    <div className="flex size-full items-center justify-center gradiente-acento" aria-hidden>
      <span className="text-4xl font-black text-white/90">{titulo.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

function PlayIcone() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PausaIcone() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
    </svg>
  );
}

function PlayPequenoIcone() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

/**
 * Uma faixa em linha, para os modos `lista` e `detalhes`.
 *
 * A diferença entre os dois é só quanta informação vai à direita: `lista` leva
 * o essencial e `detalhes` acrescenta as colunas de duração, reproduções e
 * data, alinhadas para poder comparar de cima a baixo. É a leitura que nenhum
 * grid de cartão entrega.
 *
 * As colunas extras somem no celular. Espremidas em 390px elas viram números
 * de 8px empilhados, ilegíveis e ocupando o lugar do título.
 */
function Linha({
  musica,
  autor,
  href,
  modo,
  pronta,
  estaTocando,
  progresso,
  capaUrl,
  locale,
  aoClicar,
  selecionada,
  aoSelecionar,
}: {
  musica: Musica | ItemExplore;
  autor?: { handle: string; displayName: string };
  href?: string;
  modo: 'lista' | 'detalhes';
  pronta: boolean;
  estaTocando: boolean;
  progresso?: { status: string; progress: number };
  capaUrl: string | null;
  locale: 'pt' | 'en';
  aoClicar: () => void;
  selecionada?: boolean;
  aoSelecionar?: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <article
      className={`flex items-center gap-3 border-b border-borda px-2 py-2 transition-colors hover:bg-superficie ${
        selecionada ? 'bg-acento-suave' : ''
      }`}
    >
      {aoSelecionar && (
        <input
          type="checkbox"
          checked={selecionada ?? false}
          onChange={() => aoSelecionar(musica.id)}
          aria-label={`${selecionada ? 'Desmarcar' : 'Selecionar'} ${musica.title}`}
          className="size-4 shrink-0 accent-acento"
        />
      )}

      <button
        type="button"
        onClick={aoClicar}
        disabled={!pronta}
        aria-label={`${estaTocando ? 'Pausar' : 'Tocar'} ${musica.title}`}
        className="relative size-10 shrink-0 overflow-hidden rounded-md"
      >
        <Capa url={capaUrl} titulo={musica.title} />
        {pronta ? (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity hover:opacity-100">
            {estaTocando ? <PausaIcone /> : <PlayIcone />}
          </span>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[9px] tabular-nums text-texto-suave">
            {progresso ? `${progresso.progress}%` : ''}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="line-clamp-1 text-sm font-medium hover:underline">
            {musica.title}
          </Link>
        ) : (
          <p className="line-clamp-1 text-sm font-medium">{musica.title}</p>
        )}
        {autor && (
          <Link
            href={`/u/${autor.handle}`}
            className="block truncate text-xs text-texto-suave hover:text-texto"
          >
            {autor.displayName}
          </Link>
        )}
      </div>

      {modo === 'detalhes' && (
        <div className="hidden shrink-0 items-center gap-6 text-xs tabular-nums text-texto-fraco sm:flex">
          <span className="w-14 text-right">{formatarContagem(musica.playCount, locale)}</span>
          <span className="w-14 text-right">{formatarContagem(musica.likeCount, locale)}</span>
          <span className="w-24 text-right">
            {new Date(musica.createdAt).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US')}
          </span>
        </div>
      )}

      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-texto-fraco">
        {musica.durationMs > 0 ? formatarDuracao(musica.durationMs) : ''}
      </span>

      {!musica.isPublic && (
        <span className="shrink-0 rounded bg-superficie-alta px-1.5 py-0.5 text-[10px] text-texto-fraco">
          {t('musica.privada')}
        </span>
      )}
    </article>
  );
}
