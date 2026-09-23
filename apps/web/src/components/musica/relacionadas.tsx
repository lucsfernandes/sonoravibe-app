'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AbrirIcone,
  BrilhoIcone,
  ComentarioIcone,
  CompartilharIcone,
  ConfirmarIcone,
  CopiarIcone,
  PausarIcone,
  PontosIcone,
  RemixIcone,
  TocarIcone,
} from '@/components/criar/icones';
import { ItemMenu, MenuSuspenso } from '@/components/criar/menu-suspenso';
import { Avatar } from '@/components/shell/avatar';
import { api, type ItemExplore, type Relacionadas as RelacionadasDTO } from '@/lib/api';
import { formatarContagem, formatarDuracao, useI18n } from '@/lib/i18n';
import { paraFaixa, usePlayer, type FaixaTocando } from '@/lib/player';
import { useSessao } from '@/lib/sessao';
import { BotaoIcone } from './botao-icone';
import { BotaoCurtir } from './curtir';

type Aba = 'similar' | 'autor';

/**
 * A coluna da direita da página da música: "Similares" e "De {autor}", como
 * na referência, e o botão de Remix embaixo.
 *
 * As duas listas chegam numa chamada só (`GET /songs/:id/related`) e as abas
 * só trocam o que está na tela. Tocar uma faixa daqui enfileira a lista
 * inteira: quem clicou numa parecida quer continuar ouvindo parecidas.
 */
export function Relacionadas({
  songId,
  autor,
  podeRemixar,
  aoCarregar,
}: {
  songId: string;
  autor: { handle: string; displayName: string };
  podeRemixar: boolean;
  /** A página usa as parecidas como fila quando toca a música principal. */
  aoCarregar?: (dados: RelacionadasDTO) => void;
}) {
  const { t } = useI18n();
  const { usuario } = useSessao();
  const [aba, setAba] = useState<Aba>('similar');
  const [dados, setDados] = useState<RelacionadasDTO | null>(null);

  useEffect(() => {
    let ativo = true;
    setDados(null);
    void api
      .get<RelacionadasDTO>(`/songs/${songId}/related`)
      .then((r) => {
        if (!ativo) return;
        setDados(r);
        aoCarregar?.(r);
      })
      .catch(() => {
        if (ativo) setDados({ similar: [], byAuthor: [] });
      });
    return () => {
      ativo = false;
    };
    // `aoCarregar` é um callback inline da página; refazer a chamada a cada
    // render dela seria uma requisição por tecla digitada num comentário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  const lista = dados ? (aba === 'similar' ? dados.similar : dados.byAuthor) : null;
  const primeiroNome = autor.displayName.trim().split(/\s+/)[0] || autor.displayName;

  const abas: { valor: Aba; rotulo: string }[] = [
    { valor: 'similar', rotulo: t('musica.similares') },
    { valor: 'autor', rotulo: `${t('musica.de')} ${primeiroNome}` },
  ];

  return (
    <div className="flex h-full flex-col rounded-3xl bg-superficie p-3">
      <div role="tablist" className="flex gap-1.5 rounded-2xl bg-fundo/60 p-1">
        {abas.map((a) => (
          <button
            key={a.valor}
            type="button"
            role="tab"
            aria-selected={aba === a.valor}
            onClick={() => setAba(a.valor)}
            className={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              aba === a.valor
                ? 'bg-texto text-fundo'
                : 'text-texto-suave hover:bg-superficie-alta hover:text-texto'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 max-h-[34rem] xl:max-h-none">
        {lista === null ? (
          <p className="px-2 py-8 text-center text-sm text-texto-fraco pulsando">
            {t('geral.carregando')}
          </p>
        ) : lista.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-texto-fraco">
            {aba === 'similar' ? t('musica.nadaSimilar') : t('musica.nadaDoAutor')}
          </p>
        ) : (
          <ul>
            {lista.map((m) => (
              <LinhaRelacionada key={m.id} musica={m} fila={lista} logado={Boolean(usuario)} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 border-t border-borda/60 pt-3">
        {podeRemixar ? (
          <Link
            href={`/criar?referencia=${songId}`}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-superficie-alta text-sm font-semibold transition-colors hover:bg-borda"
          >
            <RemixIcone tamanho={17} />
            {t('musica.remix')}
          </Link>
        ) : (
          <button
            type="button"
            disabled
            title={t('musica.remixBloqueado')}
            className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-superficie-alta text-sm font-semibold opacity-40"
          >
            <RemixIcone tamanho={17} />
            {t('musica.remix')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Uma faixa da lateral: capa, título, estilo e autor com foto, e embaixo a
 * fileira de reproduções, curtir, comentários, compartilhar e "…".
 */
function LinhaRelacionada({
  musica,
  fila,
  logado,
}: {
  musica: ItemExplore;
  fila: ItemExplore[];
  logado: boolean;
}) {
  const { t, locale } = useI18n();
  const { tocar, faixa, tocando, alternar } = usePlayer();
  const [copiado, setCopiado] = useState(false);

  const atual = faixa?.id === musica.id;
  const estaTocando = atual && tocando;
  const href = `/musica/${musica.id}`;

  function aoTocar() {
    if (atual) {
      alternar();
      return;
    }
    const nova = paraFaixa(musica);
    if (!nova) return;
    const novaFila = fila.map((m) => paraFaixa(m)).filter((f): f is FaixaTocando => f !== null);
    tocar(nova, novaFila);
  }

  async function compartilhar() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Sem área de transferência (http sem TLS, por exemplo): o "…" ainda
      // abre a página, de onde dá para copiar a URL da barra.
    }
  }

  return (
    <li className="border-b border-borda/50 py-3 last:border-0">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={aoTocar}
          disabled={!musica.audioUrl}
          aria-label={`${estaTocando ? t('musica.pausar') : t('musica.tocar')} ${musica.title}`}
          className="group relative size-[76px] shrink-0 overflow-hidden rounded-xl bg-superficie-alta"
        >
          <Capa url={musica.coverUrl} titulo={musica.title} />
          <span
            className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity ${
              estaTocando ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
            }`}
          >
            {estaTocando ? <PausarIcone tamanho={24} /> : <TocarIcone tamanho={24} />}
          </span>
          {musica.durationMs > 0 && (
            <span className="absolute bottom-1 right-1 rounded-md bg-black/75 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
              {formatarDuracao(musica.durationMs)}
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <Link href={href} className="block truncate text-[15px] font-semibold leading-snug hover:underline">
            {musica.title}
          </Link>
          {musica.stylePrompt && musica.stylePrompt.trim() !== musica.title.trim() && (
            <p className="mt-0.5 truncate text-xs text-texto-suave">{musica.stylePrompt}</p>
          )}
          <Link
            href={`/u/${musica.author.handle}`}
            className="mt-1.5 flex items-center gap-2 text-sm font-medium hover:underline"
          >
            <Avatar url={musica.author.avatarUrl} nome={musica.author.displayName} tamanho={22} />
            <span className="truncate">{musica.author.displayName}</span>
          </Link>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-0.5 text-texto-suave">
        <span className="flex h-8 items-center gap-1 px-2 text-xs tabular-nums" title={t('musica.reproducoes')}>
          <TocarIcone tamanho={12} />
          {formatarContagem(musica.playCount, locale)}
        </span>
        <BotaoCurtir
          songId={musica.id}
          curtidoInicial={musica.likedByMe}
          contagemInicial={musica.likeCount}
          tamanho="icone"
        />
        <Link
          href={`${href}#comentarios`}
          aria-label={t('musica.abrirComentarios')}
          title={t('musica.abrirComentarios')}
          className="flex h-9 items-center gap-1 rounded-full px-2 text-xs tabular-nums transition-colors hover:bg-superficie-alta hover:text-texto"
        >
          <ComentarioIcone tamanho={16} />
          {musica.commentCount > 0 && formatarContagem(musica.commentCount, locale)}
        </Link>
        <BotaoIcone
          rotulo={copiado ? t('lib.linkCopiado') : t('lib.compartilhar')}
          ativo={copiado}
          onClick={() => void compartilhar()}
          className="hover:bg-superficie-alta"
        >
          {copiado ? <ConfirmarIcone tamanho={16} /> : <CompartilharIcone tamanho={16} />}
        </BotaoIcone>
        <div className="ml-auto">
          <MenuSuspenso
            alinhamento="direita"
            gatilho={(aberto) => (
              <BotaoIcone rotulo={t('lib.maisAcoes')} ativo={aberto} aria-expanded={aberto} className="hover:bg-superficie-alta">
                <PontosIcone tamanho={17} />
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
                <ItemMenu
                  icone={<CopiarIcone tamanho={15} />}
                  onClick={() => {
                    void compartilhar();
                    fechar();
                  }}
                >
                  {t('lib.compartilhar')}
                </ItemMenu>
                {logado && musica.allowRemixes && (
                  <ItemMenu icone={<BrilhoIcone tamanho={15} />} onClick={fechar}>
                    <Link href={`/criar?referencia=${musica.id}`} className="block">
                      {t('lib.usarReferencia')}
                    </Link>
                  </ItemMenu>
                )}
              </>
            )}
          </MenuSuspenso>
        </div>
      </div>
    </li>
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
