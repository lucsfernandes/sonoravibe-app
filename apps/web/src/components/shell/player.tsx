'use client';

import { useI18n, formatarDuracao } from '@/lib/i18n';
import { usePlayer } from '@/lib/player';

/**
 * Player fixo no rodapé.
 *
 * Só aparece quando há faixa carregada — uma barra vazia ocupando 80px do
 * rodapé desde o primeiro acesso é ruído.
 */
export function Player() {
  const { faixa, tocando, posicaoMs, duracaoMs, volume, alternar, proxima, anterior, buscar, setVolume } =
    usePlayer();
  const { t } = useI18n();

  if (!faixa) return null;

  // A duração do backend é a fonte confiável; a medida pelo navegador só entra
  // quando é finita (ver player.tsx: FLAC via URL assinada devolve Infinity).
  const total =
    Number.isFinite(duracaoMs) && duracaoMs > 0 ? duracaoMs : faixa.durationMs || 1;
  const progresso = Math.min(100, (posicaoMs / total) * 100);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-borda bg-fundo/95 backdrop-blur">
      {/* Barra de progresso clicável, colada no topo do player */}
      <label className="sr-only" htmlFor="posicao-faixa">
        {faixa.title}
      </label>
      <input
        id="posicao-faixa"
        type="range"
        min={0}
        max={total}
        value={Math.min(posicaoMs, total)}
        onChange={(e) => buscar(Number(e.target.value))}
        aria-label={faixa.title}
        className="block h-1 w-full cursor-pointer appearance-none bg-borda accent-acento"
        style={{
          background: `linear-gradient(to right, var(--color-acento) ${progresso}%, var(--color-borda) ${progresso}%)`,
        }}
      />

      <div className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Capa url={faixa.coverUrl} titulo={faixa.title} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{faixa.title}</p>
            {faixa.autor && (
              <p className="truncate text-xs text-texto-suave">{faixa.autor}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={anterior}
            aria-label="Anterior"
            className="rounded-full p-2 text-texto-suave transition-colors hover:bg-superficie hover:text-texto"
          >
            <PularIcone direcao="anterior" />
          </button>

          <button
            type="button"
            onClick={alternar}
            aria-label={tocando ? 'Pausar' : 'Tocar'}
            className="rounded-full bg-texto p-2.5 text-fundo transition-transform hover:scale-105"
          >
            {tocando ? <PausaIcone /> : <PlayIcone />}
          </button>

          <button
            type="button"
            onClick={proxima}
            aria-label="Próxima"
            className="rounded-full p-2 text-texto-suave transition-colors hover:bg-superficie hover:text-texto"
          >
            <PularIcone direcao="proxima" />
          </button>
        </div>

        <div className="hidden min-w-32 items-center justify-end gap-2 text-xs tabular-nums text-texto-suave sm:flex">
          <span>{formatarDuracao(posicaoMs)}</span>
          <span className="text-texto-fraco">/</span>
          <span>{formatarDuracao(total)}</span>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <VolumeIcone mudo={volume === 0} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label={t('geral.salvar') === 'Salvar' ? 'Volume' : 'Volume'}
            className="w-20 accent-acento"
          />
        </div>
      </div>
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

function PlayIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function PausaIcone() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
    </svg>
  );
}

function PularIcone({ direcao }: { direcao: 'anterior' | 'proxima' }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      style={direcao === 'anterior' ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M6 6v12l9-6zM17 6h2v12h-2z" />
    </svg>
  );
}

function VolumeIcone({ mudo }: { mudo: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-texto-suave" aria-hidden>
      <path d="M4 9v6h3.5L12 19V5L7.5 9z" strokeLinejoin="round" />
      {!mudo && <path d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" strokeLinecap="round" />}
    </svg>
  );
}
