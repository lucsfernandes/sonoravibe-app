'use client';

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Edições mecânicas: cortar, silêncio, fades, velocidade, reverter, normalizar.
 *
 * São FFmpeg no nosso worker, sem chamada ao motor de música — por isso não
 * custam crédito, e a tela diz isso: alguém que já gastou crédito para gerar
 * hesita antes de clicar em qualquer coisa que pareça cobrar de novo.
 *
 * Cada operação pede parâmetros diferentes, e mostrar todos os campos sempre
 * deixaria a maioria deles inúteis na tela. O formulário troca conforme a
 * escolha.
 *
 * Os tempos aparecem em segundos e vão em milissegundos: pessoa pensa "corta
 * do 15 ao 40", não "de 15000 a 40000".
 */

type Operacao = 'crop' | 'trim-silence' | 'fade-in' | 'fade-out' | 'speed' | 'reverse' | 'normalize';

/** O que cada operação precisa. Vazio = roda sem parâmetro. */
const PARAMETROS: Record<Operacao, ReadonlyArray<'trecho' | 'duracao' | 'fator'>> = {
  crop: ['trecho'],
  'trim-silence': [],
  'fade-in': ['duracao'],
  'fade-out': ['duracao'],
  speed: ['fator'],
  reverse: [],
  normalize: [],
};

const OPERACOES = Object.keys(PARAMETROS) as Operacao[];

export function EditarAudio({
  songId,
  duracaoMs,
  aoAplicar,
}: {
  songId: string;
  duracaoMs: number;
  aoAplicar: () => Promise<void> | void;
}) {
  const { t } = useI18n();

  const [aberto, setAberto] = useState(false);
  const [operacao, setOperacao] = useState<Operacao>('crop');
  const [inicio, setInicio] = useState(0);
  const [fim, setFim] = useState(() => Math.round(duracaoMs / 1000) || 30);
  const [segundos, setSegundos] = useState(3);
  const [fator, setFator] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const pede = PARAMETROS[operacao];

  async function aplicar() {
    setEnviando(true);
    setAviso(null);
    try {
      await api.post(`/songs/${songId}/edit`, {
        operation: operacao,
        ...(pede.includes('trecho') ? { startMs: inicio * 1000, endMs: fim * 1000 } : {}),
        ...(pede.includes('duracao') ? { durationMs: segundos * 1000 } : {}),
        ...(pede.includes('fator') ? { factor: fator } : {}),
      });
      setAviso(t('editar.enfileirada'));
      await aoAplicar();
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setEnviando(false);
    }
  }

  // Um corte invertido é recusado pelo backend com uma mensagem clara, mas
  // desabilitar o botão evita a viagem de ida e volta para descobrir isso.
  const trechoValido = !pede.includes('trecho') || fim > inicio;

  return (
    <section className="mt-6 rounded-xl border border-borda">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        <span>
          {t('editar.titulo')}
          <span className="ml-2 text-xs font-normal text-texto-fraco">{t('editar.semCusto')}</span>
        </span>
        <span aria-hidden className={`transition-transform ${aberto ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {aberto && (
        <div className="border-t border-borda px-4 py-4">
          <div className="flex flex-wrap gap-1.5">
            {OPERACOES.map((op) => (
              <button
                key={op}
                type="button"
                aria-pressed={operacao === op}
                onClick={() => {
                  setOperacao(op);
                  setAviso(null);
                }}
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  operacao === op
                    ? 'border-acento bg-acento-suave text-acento'
                    : 'border-borda text-texto-suave hover:text-texto'
                }`}
              >
                {t(`editar.${op}`)}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-texto-suave">{t(`editar.${operacao}.dica`)}</p>

          {pede.includes('trecho') && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Numero
                rotulo={t('editar.de')}
                valor={inicio}
                min={0}
                max={Math.max(0, Math.round(duracaoMs / 1000) - 1)}
                sufixo="s"
                onChange={setInicio}
              />
              <Numero
                rotulo={t('editar.ate')}
                valor={fim}
                min={1}
                max={Math.round(duracaoMs / 1000) || 480}
                sufixo="s"
                onChange={setFim}
              />
              {!trechoValido && (
                <p className="text-xs text-perigo">{t('editar.trechoInvertido')}</p>
              )}
            </div>
          )}

          {pede.includes('duracao') && (
            <div className="mt-4">
              <Numero
                rotulo={t('editar.duracaoFade')}
                valor={segundos}
                min={1}
                max={30}
                sufixo="s"
                onChange={setSegundos}
              />
            </div>
          )}

          {pede.includes('fator') && (
            <div className="mt-4">
              <label className="block text-xs text-texto-suave" htmlFor="fator-velocidade">
                {t('editar.velocidade')}: <span className="tabular-nums">{fator.toFixed(2)}×</span>
              </label>
              {/* 0.5 a 2 é o que o filtro `atempo` do FFmpeg aceita numa passada
                  só; fora disso o backend recusa. */}
              <input
                id="fator-velocidade"
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={fator}
                onChange={(e) => setFator(Number(e.target.value))}
                className="mt-1.5 w-full max-w-xs accent-acento"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => void aplicar()}
            disabled={enviando || !trechoValido}
            className="mt-5 rounded-xl gradiente-acento px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {enviando ? t('geral.enviando') : t('editar.aplicar')}
          </button>

          {aviso && (
            <p role="status" className="mt-3 text-sm text-texto-suave">
              {aviso}
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
  sufixo,
  onChange,
}: {
  rotulo: string;
  valor: number;
  min: number;
  max: number;
  sufixo: string;
  onChange: (v: number) => void;
}) {
  const id = `n-${rotulo.replace(/\s/g, '-')}`;
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
        <span className="text-xs text-texto-fraco">{sufixo}</span>
      </div>
    </div>
  );
}
