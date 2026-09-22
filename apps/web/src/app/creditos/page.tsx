'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type Saldo } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';
import { CancelarAssinatura } from '@/components/creditos/cancelar-assinatura';
import { Checkout } from '@/components/creditos/checkout';

interface Catalogo {
  plans: {
    code: string;
    name: string;
    priceBrl: number;
    monthlyCredits: number;
    /** Só no Free: a cota renovada por ciclo, e o tamanho do ciclo em dias. */
    cycleCredits?: number | null;
    cycleDays?: number | null;
    features: {
      maxDurationSeconds: number;
      stems: boolean;
      batchDownload: boolean;
      maxMode: boolean;
    };
  }[];
  packs: { code: string; credits: number; priceBrl: number; label: string }[];
  gateway: string;
}

export default function Creditos() {
  const { t, locale } = useI18n();
  const { usuario, saldo, carregando, recarregarSaldo } = useSessao();
  const router = useRouter();
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [extrato, setExtrato] = useState<Saldo['transactions']>([]);
  // O que está sendo comprado. Abre o formulário de pagamento por cima da
  // página em vez de disparar a cobrança no clique: o gateway precisa de nome
  // e CPF, e a pessoa escolhe como pagar.
  const [pedido, setPedido] = useState<{
    titulo: string;
    caminho: string;
    corpo: Record<string, unknown>;
    botao: string;
  } | null>(null);

  useEffect(() => {
    void api.get<Catalogo>('/plans').then(setCatalogo).catch(() => setCatalogo(null));
  }, []);

  useEffect(() => {
    if (!usuario) return;
    void api
      .get<Saldo>('/credits')
      .then((s) => setExtrato(s.transactions))
      .catch(() => setExtrato([]));
  }, [usuario, saldo?.balance.total]);

  // Visitante não tem saldo nem assinatura para gerenciar, e esta tela vive
  // dentro da casca do aplicativo: sem este desvio ele via o menu lateral
  // inteiro com Biblioteca, Criar e Playlists, que são rotas que exigem login.
  // A vitrine pública é /planos.
  useEffect(() => {
    if (!carregando && !usuario) router.replace('/planos');
  }, [carregando, usuario, router]);

  if (carregando || !usuario) {
    return <p className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</p>;
  }

  const dinheiro = (v: number) =>
    new Intl.NumberFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
      style: 'currency',
      currency: 'BRL',
    }).format(v);

  const numero = (v: number) =>
    v.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold">{t('creditos.titulo')}</h1>

      {saldo && (
        <div className="card mt-6 flex flex-wrap items-center gap-6 p-5">
          <div>
            <p className="text-xs text-texto-suave">{t('creditos.saldo')}</p>
            <p className="text-3xl font-bold tabular-nums">{numero(saldo.balance.total)}</p>
          </div>
          <div className="text-sm text-texto-suave">
            <p>
              {saldo.balance.plan} {t('creditos.doPlano')}
            </p>
            <p>
              {saldo.balance.pack} {t('creditos.avulsos')}
            </p>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1.5">
            <div className="rounded-full border border-acento/40 px-4 py-1.5 text-sm text-acento">
              {t('creditos.planoAtual')}: {saldo.planCode}
            </div>
            {/* Quem assina tem que conseguir cancelar sem abrir um chamado.
                O acesso continua valendo até o fim do período já pago —
                cancelar não é estornar. */}
            {saldo.planCode !== 'free' && <CancelarAssinatura aoCancelar={recarregarSaldo} />}
          </div>
        </div>
      )}

      {pedido && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pedido.titulo}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        >
          <div className="card w-full max-w-sm p-6">
            <p className="text-xs text-texto-suave">{t('creditos.titulo')}</p>
            <p className="mt-0.5 text-lg font-bold">{pedido.titulo}</p>
            <Checkout
              caminho={pedido.caminho}
              corpo={pedido.corpo}
              botao={pedido.botao}
              aoConfirmar={recarregarSaldo}
              aoFechar={() => setPedido(null)}
              sucesso={
                <button
                  type="button"
                  onClick={() => setPedido(null)}
                  className="mt-4 inline-block rounded-xl gradiente-acento px-6 py-2.5 text-sm font-semibold text-white"
                >
                  {t('checkout.fechar')}
                </button>
              }
            />
          </div>
        </div>
      )}

      {catalogo && (
        <>
          <h2 className="mt-10 text-lg font-semibold">{t('creditos.planos')}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {catalogo.plans.map((p) => {
              const atual = saldo?.planCode === p.code;
              return (
                <div key={p.code} className={`card p-5 ${atual ? 'border-acento' : ''}`}>
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="mt-1 text-2xl font-bold">
                    {p.priceBrl === 0 ? '—' : dinheiro(p.priceBrl)}
                    {p.priceBrl > 0 && (
                      <span className="text-sm font-normal text-texto-suave">
                        {t('creditos.porMes')}
                      </span>
                    )}
                  </p>
                  <ul className="mt-3 space-y-1 text-xs text-texto-suave">
                    <li>
                      {p.monthlyCredits
                        ? `${numero(p.monthlyCredits)} ${t('criar.custo')}`
                        : `${numero(p.cycleCredits ?? 0)} ${t('criar.custo')} ${
                            p.cycleDays === 1 ? t('planos.porDia') : t('planos.porMes')
                          }`}
                    </li>
                    <li>
                      {Math.round(p.features.maxDurationSeconds / 60)}{' '}
                      {t('creditos.minPorMusica')}
                    </li>
                    {p.features.stems && <li>{t('musica.stems')}</li>}
                    {p.features.batchDownload && <li>{t('musica.baixar')} (lote)</li>}
                    {p.features.maxMode && <li>Max Mode</li>}
                  </ul>
                  <button
                    type="button"
                    onClick={() =>
                      setPedido({
                        titulo: `${p.name} · ${dinheiro(p.priceBrl)}${t('creditos.porMes')}`,
                        caminho: '/billing/subscribe',
                        corpo: { planCode: p.code },
                        botao: t('assinar.pagar'),
                      })
                    }
                    disabled={atual || p.code === 'free' || pedido !== null}
                    className="mt-4 w-full rounded-xl gradiente-acento py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {atual ? t('creditos.planoAtual') : t('creditos.assinar')}
                  </button>
                </div>
              );
            })}
          </div>

          <h2 className="mt-10 text-lg font-semibold">{t('creditos.pacotes')}</h2>
          <p className="mt-1 text-xs text-texto-suave">{t('creditos.validade')}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {catalogo.packs.map((p) => (
              <div key={p.code} className="card flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-medium">
                    {numero(p.credits)} {t('criar.custo')}
                  </p>
                  <p className="text-xs text-texto-suave">{dinheiro(p.priceBrl)}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPedido({
                      titulo: `${numero(p.credits)} ${t('criar.custo')} · ${dinheiro(p.priceBrl)}`,
                      caminho: `/billing/packs/${p.code}/purchase`,
                      corpo: {},
                      botao: t('checkout.comprarPacote'),
                    })
                  }
                  disabled={pedido !== null}
                  className="rounded-lg border border-borda px-4 py-2 text-sm transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
                >
                  {t('creditos.comprar')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {extrato.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold">{t('creditos.extrato')}</h2>
          <ul className="mt-4 divide-y divide-borda overflow-hidden rounded-xl border border-borda">
            {extrato.slice(0, 20).map((tx, i) => (
              <li
                key={`${tx.createdAt}-${i}`}
                className="flex items-center gap-3 bg-superficie px-4 py-2.5 text-sm"
              >
                <span
                  className={`w-16 shrink-0 font-medium tabular-nums ${
                    tx.amount > 0 ? 'text-sucesso' : 'text-texto-suave'
                  }`}
                >
                  {tx.amount > 0 ? '+' : ''}
                  {tx.amount}
                </span>
                <span className="min-w-0 flex-1 truncate text-texto-suave">
                  {tx.description || t(`motivo.${tx.reason}`)}
                </span>
                <span className="shrink-0 text-xs text-texto-fraco">
                  {new Date(tx.createdAt).toLocaleDateString(
                    locale === 'pt' ? 'pt-BR' : 'en-US',
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
