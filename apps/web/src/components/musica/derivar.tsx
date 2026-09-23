'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { MAX_DURATION_SECONDS } from '@sonora/shared';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useProgresso } from '@/lib/progresso';
import { useSessao } from '@/lib/sessao';

/**
 * Operações que geram uma música nova a partir desta: remix, substituir um
 * trecho e gerar capa.
 *
 * Ficam separadas das edições mecânicas porque a diferença importa para quem
 * clica: estas chamam o motor de novo, custam crédito e nascem como uma faixa
 * nova com `parentSongId` — a original não é alterada. O texto diz o custo
 * antes do clique, não depois do 402.
 *
 * O resultado entra no acompanhamento por SSE igual a uma geração comum, então
 * a barra de progresso aparece onde o usuário já espera vê-la.
 */

type Modo = 'remix' | 'trecho' | 'capa';

export function Derivar({
  songId,
  duracaoMs,
  custoRemix,
  custoCapa,
  aoEnfileirar,
}: {
  songId: string;
  duracaoMs: number;
  custoRemix: number;
  /** A capa nova custa: a primeira saiu de graça junto com a música. */
  custoCapa: number;
  aoEnfileirar: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { recarregarSaldo } = useSessao();
  const { acompanhar } = useProgresso();

  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<Modo>('remix');
  const [estilos, setEstilos] = useState('');
  const [promptCapa, setPromptCapa] = useState('');
  const [inicio, setInicio] = useState(0);
  const [fim, setFim] = useState(() => Math.min(30, Math.round(duracaoMs / 1000) || 30));
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [semCredito, setSemCredito] = useState(false);

  async function enviar() {
    setEnviando(true);
    setAviso(null);
    setSemCredito(false);
    try {
      if (modo === 'capa') {
        const r = await api.post<{ generationId: string }>(`/songs/${songId}/cover-art`, {
          ...(promptCapa.trim() ? { prompt: promptCapa.trim() } : {}),
        });
        acompanhar(r.generationId, songId);
        setAviso(t('derivar.capaEnfileirada'));
      } else {
        const corpo =
          modo === 'remix'
            ? { styles: estilos.trim() }
            : {
                startMs: inicio * 1000,
                endMs: fim * 1000,
                ...(estilos.trim() ? { styles: estilos.trim() } : {}),
              };
        // Rota escrita por extenso, e não montada na string: `/songs/:id/remix`
        // tem que aparecer numa busca por "remix" no repositório.
        const rota = modo === 'remix' ? `/songs/${songId}/remix` : `/songs/${songId}/replace-section`;
        const r = await api.post<{ songId: string; generationId: string }>(rota, corpo);
        // A faixa nova é outra música: acompanhar o id dela, não o desta.
        acompanhar(r.generationId, r.songId);
        router.push(`/musica/${r.songId}`);
      }
      await recarregarSaldo();
      await aoEnfileirar();
    } catch (err) {
      if (err instanceof ApiError) {
        setAviso(err.message);
        setSemCredito(err.semCredito);
      } else {
        setAviso(t('geral.erro'));
      }
    } finally {
      setEnviando(false);
    }
  }

  const custo = modo === 'capa' ? custoCapa : custoRemix;
  const trechoValido = modo !== 'trecho' || fim > inicio;
  const podeEnviar =
    !enviando &&
    trechoValido &&
    (modo === 'capa' || modo === 'trecho' || estilos.trim().length >= 3);

  return (
    <section className="mt-6 rounded-xl border border-borda">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        {t('derivar.titulo')}
        <span aria-hidden className={`transition-transform ${aberto ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {aberto && (
        <div className="border-t border-borda px-4 py-4">
          <div className="flex flex-wrap gap-1.5">
            {(['remix', 'trecho', 'capa'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={modo === m}
                onClick={() => {
                  setModo(m);
                  setAviso(null);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  modo === m
                    ? 'border-acento bg-acento-suave text-acento'
                    : 'border-borda text-texto-suave hover:text-texto'
                }`}
              >
                {t(`derivar.${m}`)}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-texto-suave">{t(`derivar.${modo}.dica`)}</p>

          {modo === 'trecho' && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Numero
                rotulo={t('editar.de')}
                valor={inicio}
                min={0}
                max={Math.max(0, Math.round(duracaoMs / 1000) - 1)}
                onChange={setInicio}
              />
              <Numero
                rotulo={t('editar.ate')}
                valor={fim}
                min={1}
                max={Math.round(duracaoMs / 1000) || MAX_DURATION_SECONDS}
                onChange={setFim}
              />
              {!trechoValido && (
                <p className="text-xs text-perigo">{t('editar.trechoInvertido')}</p>
              )}
            </div>
          )}

          {modo !== 'capa' ? (
            <textarea
              value={estilos}
              onChange={(e) => setEstilos(e.target.value)}
              placeholder={t(modo === 'remix' ? 'derivar.estilosRemix' : 'derivar.estilosTrecho')}
              aria-label={t('criar.estilos')}
              rows={3}
              maxLength={1000}
              className="mt-4 w-full resize-y rounded-xl border border-borda bg-superficie px-3 py-2 text-sm outline-none placeholder:text-texto-fraco focus:border-texto-fraco"
            />
          ) : (
            <textarea
              value={promptCapa}
              onChange={(e) => setPromptCapa(e.target.value)}
              placeholder={t('derivar.capaPlaceholder')}
              aria-label={t('derivar.capa')}
              rows={2}
              maxLength={1000}
              className="mt-4 w-full resize-y rounded-xl border border-borda bg-superficie px-3 py-2 text-sm outline-none placeholder:text-texto-fraco focus:border-texto-fraco"
            />
          )}

          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!podeEnviar}
            className="mt-4 flex items-center gap-2 rounded-xl gradiente-acento px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {enviando ? t('geral.enviando') : t('criar.botao')}{' '}
            <span className="rounded bg-black/25 px-1.5 py-0.5 text-xs">
              {custo} {t(custo === 1 ? 'criar.custoUm' : 'criar.custo')}
            </span>
          </button>

          {aviso && (
            <p role="alert" className="mt-3 text-sm text-texto-suave">
              {aviso}{' '}
              {semCredito && (
                <a href="/creditos" className="text-acento hover:underline">
                  {t('creditos.comprar')}
                </a>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Numero({
  rotulo,
  valor,
  min,
  max,
  onChange,
}: {
  rotulo: string;
  valor: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const id = `d-${rotulo.replace(/\s/g, '-')}`;
  return (
    <div>
      <label className="block text-xs text-texto-suave" htmlFor={id}>
        {rotulo}
      </label>
      <div className="mt-1 flex items-center gap-1">
        <input
          id={id}
          type="number"
          value={valor}
          min={min}
          max={max}
          onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
          className="w-20 rounded-lg border border-borda bg-superficie px-2 py-1.5 text-sm tabular-nums outline-none focus:border-texto-fraco"
        />
        <span className="text-xs text-texto-fraco">s</span>
      </div>
    </div>
  );
}
