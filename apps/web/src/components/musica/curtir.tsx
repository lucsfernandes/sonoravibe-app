'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatarContagem, useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/**
 * Botão de curtir.
 *
 * Atualiza na hora e desfaz se o servidor recusar. Curtir é barato e
 * frequente: esperar a ida e volta da rede para o coração mudar de cor faz a
 * interface parecer quebrada num toque rápido, e o pior que acontece num erro
 * é o número voltar ao que era.
 *
 * O `useEffect` ressincroniza quando o pai recarrega a lista — sem ele, o
 * estado otimista de um card sobreviveria a um refresh que diz o contrário.
 */
export function BotaoCurtir({
  songId,
  curtidoInicial,
  contagemInicial,
  tamanho = 'pequeno',
  aoMudar,
}: {
  songId: string;
  curtidoInicial: boolean;
  contagemInicial: number;
  /**
   * 'linha' é o botão redondo de polegar das fileiras da aba Criar: só o
   * ícone, com a contagem ao lado quando há alguma.
   */
  tamanho?: 'pequeno' | 'grande' | 'linha';
  aoMudar?: (curtido: boolean, contagem: number) => void;
}) {
  const { t, locale } = useI18n();
  const { usuario } = useSessao();
  const router = useRouter();

  const [curtido, setCurtido] = useState(curtidoInicial);
  const [contagem, setContagem] = useState(contagemInicial);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setCurtido(curtidoInicial);
    setContagem(contagemInicial);
  }, [curtidoInicial, contagemInicial]);

  async function alternar(e: React.MouseEvent) {
    // O card inteiro é um link; sem isto, curtir navegaria para a música.
    e.preventDefault();
    e.stopPropagation();

    if (!usuario) {
      router.push('/entrar');
      return;
    }
    if (enviando) return;

    const anterior = { curtido, contagem };
    const otimista = { curtido: !curtido, contagem: contagem + (curtido ? -1 : 1) };

    setCurtido(otimista.curtido);
    setContagem(otimista.contagem);
    setEnviando(true);

    try {
      // O servidor é a verdade: ele devolve a contagem real, que pode diferir
      // da nossa se outra pessoa curtiu no mesmo instante.
      const r = await api.post<{ liked: boolean; likeCount: number }>(`/songs/${songId}/like`);
      setCurtido(r.liked);
      setContagem(r.likeCount);
      aoMudar?.(r.liked, r.likeCount);
    } catch (err) {
      setCurtido(anterior.curtido);
      setContagem(anterior.contagem);
      // 404 aqui quer dizer música privada ou apagada — não é erro do usuário,
      // e um alerta atrapalharia mais do que o coração voltando sozinho.
      if (err instanceof ApiError && err.status !== 404) {
        console.error('Falha ao curtir:', err.message);
      }
    } finally {
      setEnviando(false);
    }
  }

  const grande = tamanho === 'grande';

  if (tamanho === 'linha') {
    return (
      <button
        type="button"
        onClick={alternar}
        aria-pressed={curtido}
        aria-label={curtido ? t('musica.descurtir') : t('musica.curtir')}
        title={curtido ? t('musica.descurtir') : t('musica.curtir')}
        className={`flex h-8 items-center gap-1.5 rounded-full bg-superficie-alta px-2.5 transition-colors hover:bg-borda ${
          curtido ? 'text-acento' : 'text-texto-suave hover:text-texto'
        } ${enviando ? 'opacity-70' : ''}`}
      >
        <PolegarIcone preenchido={curtido} />
        {contagem > 0 && <span className="text-[11px] tabular-nums">{formatarContagem(contagem, locale)}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={curtido}
      aria-label={curtido ? t('musica.descurtir') : t('musica.curtir')}
      className={`flex items-center gap-1 transition-colors ${
        grande
          ? 'rounded-xl border border-borda px-4 py-2 text-sm hover:border-texto-fraco'
          : 'text-[11px]'
      } ${curtido ? 'text-acento' : 'text-texto-fraco hover:text-texto'} ${
        enviando ? 'opacity-70' : ''
      }`}
    >
      <CoracaoIcone preenchido={curtido} grande={grande} />
      <span className="tabular-nums">{formatarContagem(contagem, locale)}</span>
    </button>
  );
}

function PolegarIcone({ preenchido }: { preenchido: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill={preenchido ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
      <path d="M7 10l4.5-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7" />
    </svg>
  );
}

function CoracaoIcone({ preenchido, grande }: { preenchido: boolean; grande: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={grande ? 'size-4' : 'size-3'}
      fill={preenchido ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  );
}
