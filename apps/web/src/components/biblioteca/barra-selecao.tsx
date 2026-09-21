'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError, baixarLote } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const FORMATOS = ['mp3', 'wav', 'flac', 'opus', 'm4a'] as const;

/**
 * Barra que aparece quando há músicas selecionadas na biblioteca.
 *
 * Fica fixa no rodapé, acima do player, porque a seleção acontece rolando a
 * grade: um botão no topo sairia da tela justamente quando o usuário terminasse
 * de escolher.
 *
 * O download em lote é recurso dos planos pagos, mas o botão aparece para todo
 * mundo. A recusa vem do backend com uma mensagem que já diz o que fazer, e é
 * ela que vira o convite ao upgrade — esconder o botão esconderia também que a
 * funcionalidade existe.
 */
export function BarraSelecao({
  selecionadas,
  aoLimpar,
}: {
  selecionadas: string[];
  aoLimpar: () => void;
}) {
  const { t } = useI18n();
  const [formato, setFormato] = useState<string>('mp3');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ofereceUpgrade, setOfereceUpgrade] = useState(false);

  if (selecionadas.length === 0) return null;

  async function baixar() {
    setOcupado(true);
    setAviso(null);
    setOfereceUpgrade(false);
    try {
      const r = await baixarLote(selecionadas, formato);
      if (r.baixou) aoLimpar();
      // 202: alguma faixa ainda está convertendo. A seleção fica de pé para o
      // usuário tentar de novo sem remarcar tudo.
      else setAviso(r.mensagem);
    } catch (err) {
      if (err instanceof ApiError) {
        setAviso(err.message);
        setOfereceUpgrade(err.bloqueadoPeloPlano);
      } else {
        setAviso(t('geral.erro'));
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    // No celular sobe acima da navegação inferior (bottom-20); no desktop
    // basta passar do player (bottom-0), a única barra fixa lá.
    <div
      role="region"
      aria-label={t('lib.selecionadas')}
      className="fixed inset-x-0 bottom-36 z-40 mx-auto w-[min(48rem,calc(100%-2rem))] rounded-xl border border-borda bg-superficie-alta p-3 shadow-lg md:bottom-24"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium tabular-nums">
          {selecionadas.length} {t('lib.selecionadas')}
        </span>

        <label className="sr-only" htmlFor="formato-lote">
          {t('lib.formato')}
        </label>
        <select
          id="formato-lote"
          value={formato}
          onChange={(e) => setFormato(e.target.value)}
          className="rounded-lg border border-borda bg-superficie px-2 py-1.5 text-sm outline-none"
        >
          {FORMATOS.map((f) => (
            <option key={f} value={f}>
              {f.toUpperCase()}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => void baixar()}
          disabled={ocupado}
          className="rounded-lg gradiente-acento px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {ocupado ? t('geral.enviando') : t('lib.baixarSelecionadas')}
        </button>

        <button
          type="button"
          onClick={aoLimpar}
          className="ml-auto text-sm text-texto-suave hover:text-texto"
        >
          {t('geral.cancelar')}
        </button>
      </div>

      {aviso && (
        <p role="alert" className="mt-2 text-xs text-texto-suave">
          {aviso}{' '}
          {ofereceUpgrade && (
            <Link href="/creditos" className="text-acento hover:underline">
              {t('nav.upgrade')}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
