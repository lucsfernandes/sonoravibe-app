'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/**
 * Cancela uma geração em andamento e recupera os créditos.
 *
 * Existe porque crédito reservado é dinheiro parado: enquanto a geração não
 * termina, o valor fica fora do saldo e o usuário não consegue tentar de novo.
 * Sem este botão, uma geração presa na fila só se resolvia sozinha — ou não.
 *
 * O saldo é recarregado depois do estorno; sem isso o número no topo continuaria
 * mostrando o valor de antes, e o usuário pensaria que o crédito se perdeu.
 */
export function BotaoCancelar({ generationId }: { generationId: string }) {
  const { t } = useI18n();
  const { recarregarSaldo } = useSessao();
  const [estado, setEstado] = useState<'pronto' | 'enviando' | 'cancelado'>('pronto');
  const [erro, setErro] = useState<string | null>(null);

  if (estado === 'cancelado') {
    return <span className="shrink-0 text-xs text-texto-fraco">{t('criar.cancelada')}</span>;
  }

  async function cancelar() {
    setEstado('enviando');
    setErro(null);
    try {
      await api.post(`/generations/${generationId}/cancel`);
      setEstado('cancelado');
      await recarregarSaldo();
    } catch (err) {
      // 409 costuma significar que ela terminou entre o clique e a requisição.
      // Não é erro do usuário: some o botão em vez de acusar falha.
      if (err instanceof ApiError && err.status === 409) {
        setEstado('cancelado');
        return;
      }
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
      setEstado('pronto');
    }
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void cancelar()}
        disabled={estado === 'enviando'}
        className="text-xs text-texto-fraco transition-colors hover:text-perigo disabled:opacity-50"
      >
        {estado === 'enviando' ? t('geral.enviando') : t('geral.cancelar')}
      </button>
      {erro && <span className="text-[10px] text-perigo">{erro}</span>}
    </span>
  );
}
