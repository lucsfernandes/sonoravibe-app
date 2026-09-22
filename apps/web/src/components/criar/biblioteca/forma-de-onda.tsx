'use client';

import { useEffect, useRef } from 'react';
import { api, type Musica } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { paraFaixa, usePlayer, type FaixaTocando } from '@/lib/player';

/** Faixas cuja onda já foi pedida nesta sessão: um pedido por faixa basta. */
const pedidas = new Set<string>();

/** Desenho de espera enquanto a onda não existe: barras baixas e regulares. */
const ESQUELETO = Array.from({ length: 120 }, (_, i) => 0.18 + 0.12 * Math.abs(Math.sin(i / 3)));

/**
 * Forma de onda de uma faixa, com o progresso por cima quando ela está tocando.
 *
 * Os picos vêm do banco (o worker calcula ao concluir). Faixa antiga sem onda
 * pede o cálculo uma vez e mostra um esqueleto pulsando; quem a desenha
 * recarrega a lista depois de alguns segundos para trocar pelo desenho real.
 *
 * Clicar na onda busca aquele ponto quando a faixa é a que está tocando, e
 * começa a tocá-la quando não é: é o que qualquer player faz com uma onda.
 */
export function FormaDeOnda({
  musica,
  fila,
  aoPedirOnda,
  altura = 44,
}: {
  musica: Musica;
  fila?: Musica[];
  /** Avisa que a onda foi pedida ao worker, para o pai recarregar depois. */
  aoPedirOnda?: (id: string) => void;
  altura?: number;
}) {
  const { t } = useI18n();
  const { faixa, posicaoMs, duracaoMs, tocar, buscar } = usePlayer();
  const caixa = useRef<HTMLDivElement>(null);

  const pontos = musica.waveform ?? null;
  const pronta = musica.status === 'complete' && Boolean(musica.audioUrl);

  useEffect(() => {
    if (pontos || !pronta || pedidas.has(musica.id)) return;
    pedidas.add(musica.id);
    void api
      .post(`/songs/${musica.id}/waveform`)
      .then(() => aoPedirOnda?.(musica.id))
      .catch(() => undefined);
  }, [pontos, pronta, musica.id, aoPedirOnda]);

  const atual = faixa?.id === musica.id;
  const total = atual ? (duracaoMs > 0 ? duracaoMs : musica.durationMs) : 0;
  const progresso = atual && total > 0 ? Math.min(1, posicaoMs / total) : 0;

  function aoClicar(e: React.MouseEvent<HTMLDivElement>) {
    if (!pronta) return;
    const largura = caixa.current?.clientWidth ?? 0;
    const razao = largura > 0 ? Math.max(0, Math.min(1, e.nativeEvent.offsetX / largura)) : 0;
    if (atual) {
      buscar(razao * (total || musica.durationMs));
      return;
    }
    const nova = paraFaixa(musica);
    if (!nova) return;
    const novaFila = (fila ?? [musica])
      .map((m) => paraFaixa(m))
      .filter((f): f is FaixaTocando => f !== null);
    tocar(nova, novaFila);
  }

  const valores = pontos ?? ESQUELETO;

  return (
    <div
      ref={caixa}
      role={pronta ? 'slider' : undefined}
      aria-label={pronta ? musica.title : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progresso * 100)}
      tabIndex={pronta ? 0 : -1}
      onClick={aoClicar}
      onKeyDown={(e) => {
        if (!atual) return;
        if (e.key === 'ArrowRight') buscar(Math.min(total, posicaoMs + 5000));
        if (e.key === 'ArrowLeft') buscar(Math.max(0, posicaoMs - 5000));
      }}
      className={`relative w-full select-none ${pronta ? 'cursor-pointer' : ''} ${
        pontos ? '' : 'pulsando'
      }`}
      style={{ height: altura }}
      title={pontos ? undefined : t('lib.ondaCalculando')}
    >
      <Barras valores={valores} className="text-texto-fraco/60" />
      {progresso > 0 && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - progresso * 100}% 0 0)` }}
          aria-hidden
        >
          <Barras valores={valores} className="text-acento" />
        </div>
      )}
    </div>
  );
}

/**
 * As barras em SVG. `preserveAspectRatio="none"` estica o desenho para a
 * largura que houver: 120 barras cabem tanto em 300px quanto em 900px.
 */
function Barras({ valores, className }: { valores: number[]; className: string }) {
  const n = valores.length;
  return (
    <svg
      viewBox={`0 0 ${n * 3} 100`}
      preserveAspectRatio="none"
      className={`absolute inset-0 size-full ${className}`}
      aria-hidden
    >
      {valores.map((v, i) => {
        const h = Math.max(4, v * 100);
        return <rect key={i} x={i * 3} y={(100 - h) / 2} width={2} height={h} fill="currentColor" />;
      })}
    </svg>
  );
}
