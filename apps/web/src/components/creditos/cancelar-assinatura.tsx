'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Cancela a assinatura.
 *
 * Existe por obrigação, não por escolha: quem assinou pela interface tem que
 * conseguir sair por ela também, sem abrir chamado. O backend mantém o acesso
 * até o fim do período já pago — cancelar não é estornar — e o texto diz isso
 * antes do clique, para ninguém achar que perdeu o mês que acabou de comprar.
 *
 * A confirmação é um segundo clique, não um `confirm()` do navegador: o nativo
 * não dá para traduzir nem estilizar, e em alguns navegadores móveis aparece
 * como um alerta do site inteiro.
 */
export function CancelarAssinatura({ aoCancelar }: { aoCancelar: () => Promise<void> | void }) {
  const { t, locale } = useI18n();
  const [fase, setFase] = useState<'inicio' | 'confirmando' | 'enviando' | 'pronto'>('inicio');
  const [ate, setAte] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function cancelar() {
    setFase('enviando');
    setErro(null);
    try {
      const r = await api.post<{ canceledAt: string }>('/billing/cancel');
      setAte(new Date(r.canceledAt).toLocaleDateString(locale === 'pt' ? 'pt-BR' : 'en-US'));
      setFase('pronto');
      await aoCancelar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
      setFase('inicio');
    }
  }

  if (fase === 'pronto') {
    return (
      <p className="text-right text-xs text-texto-suave">
        {t('creditos.canceladaEm')} {ate}
      </p>
    );
  }

  if (fase === 'inicio') {
    return (
      <>
        <button
          type="button"
          onClick={() => setFase('confirmando')}
          className="text-xs text-texto-fraco transition-colors hover:text-perigo"
        >
          {t('creditos.cancelarAssinatura')}
        </button>
        {erro && <span className="text-[10px] text-perigo">{erro}</span>}
      </>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <p className="max-w-56 text-right text-[11px] text-texto-suave">
        {t('creditos.avisoCancelamento')}
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setFase('inicio')}
          className="text-xs text-texto-suave hover:text-texto"
        >
          {t('creditos.manterPlano')}
        </button>
        <button
          type="button"
          disabled={fase === 'enviando'}
          onClick={() => void cancelar()}
          className="rounded-lg bg-perigo px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {fase === 'enviando' ? t('geral.enviando') : t('creditos.confirmarCancelamento')}
        </button>
      </div>
    </div>
  );
}
