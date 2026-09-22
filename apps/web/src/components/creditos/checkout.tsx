'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CampoAuth } from '@/components/auth/campo';
import { ApiError, api, type Saldo } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/**
 * Formulário de pagamento, o mesmo para assinatura e pacote.
 *
 * Pede nome, CPF/CNPJ e a forma de pagar. O número do cartão nunca passa por
 * aqui: cartão e boleto abrem a página segura do gateway, já com o cliente
 * preenchido. Só o Pix fica nesta tela, com o QR e o copia-e-cola, porque não
 * há nada a digitar; enquanto o QR está na tela, o saldo é consultado a cada
 * poucos segundos para a confirmação aparecer sozinha.
 */

type Metodo = 'pix' | 'credit_card' | 'boleto';

interface Resposta {
  paymentUrl?: string;
  pixQrCode?: string;
  pixImage?: string;
  creditsGranted?: number;
}

const INTERVALO_MS = 5_000;
const LIMITE_MS = 15 * 60_000;

export function Checkout({
  caminho,
  corpo,
  botao,
  sucesso,
  aoConfirmar,
  aoFechar,
}: {
  caminho: string;
  corpo: Record<string, unknown>;
  botao: string;
  sucesso: ReactNode;
  aoConfirmar: () => Promise<void> | void;
  aoFechar?: () => void;
}) {
  const { t } = useI18n();
  const { usuario } = useSessao();

  const [nome, setNome] = useState(usuario?.name ?? '');
  const [documento, setDocumento] = useState('');
  const [metodo, setMetodo] = useState<Metodo>('pix');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [fase, setFase] = useState<'formulario' | 'pix' | 'confirmado'>('formulario');
  const [pix, setPix] = useState<{ payload: string; imagem: string } | null>(null);
  const [saldoAntes, setSaldoAntes] = useState<Saldo | null>(null);
  const [copiado, setCopiado] = useState(false);

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const antes = await api.get<Saldo>('/credits').catch(() => null);
      const r = await api.post<Resposta>(caminho, {
        ...corpo,
        method: metodo,
        name: nome.trim() || undefined,
        taxId: documento.replace(/\D/g, ''),
      });

      if (r.creditsGranted) {
        setFase('confirmado');
        await aoConfirmar();
        return;
      }
      if (r.pixQrCode && r.pixImage) {
        setSaldoAntes(antes);
        setPix({ payload: r.pixQrCode, imagem: r.pixImage });
        setFase('pix');
        return;
      }
      if (r.paymentUrl) {
        window.location.href = r.paymentUrl;
        return;
      }
      setFase('confirmado');
      await aoConfirmar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setEnviando(false);
    }
  }

  // Enquanto o QR está na tela, espera o webhook confirmar: quando o plano ou
  // o saldo muda em relação ao instante do pedido, o pagamento entrou.
  useEffect(() => {
    if (fase !== 'pix') return;
    const inicio = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - inicio > LIMITE_MS) {
        clearInterval(timer);
        return;
      }
      const agora = await api.get<Saldo>('/credits').catch(() => null);
      if (!agora) return;
      const mudou =
        !saldoAntes ||
        agora.planCode !== saldoAntes.planCode ||
        agora.balance.total > saldoAntes.balance.total;
      if (mudou) {
        clearInterval(timer);
        setFase('confirmado');
        await aoConfirmar();
      }
    }, INTERVALO_MS);
    return () => clearInterval(timer);
  }, [fase, saldoAntes, aoConfirmar]);

  async function copiar() {
    if (!pix) return;
    await navigator.clipboard.writeText(pix.payload);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  if (fase === 'confirmado') {
    return (
      <div className="mt-7 rounded-xl border border-sucesso/40 bg-sucesso/10 px-4 py-5 text-center">
        <p className="text-sm font-medium text-sucesso">{t('checkout.confirmado')}</p>
        {sucesso}
      </div>
    );
  }

  if (fase === 'pix' && pix) {
    return (
      <div className="mt-7 space-y-4 text-center">
        <p className="text-sm font-medium">{t('checkout.pixTitulo')}</p>
        {/* Base64 vindo do gateway; <img> nativo porque next/image não otimiza data: URLs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${pix.imagem}`}
          alt="QR code do Pix"
          className="mx-auto size-48 rounded-xl bg-white p-2"
        />
        <p className="text-xs text-texto-suave">{t('checkout.pixInstrucao')}</p>
        <button
          type="button"
          onClick={() => void copiar()}
          className="w-full rounded-xl border border-borda py-2.5 text-sm transition-colors hover:border-acento hover:text-acento"
        >
          {copiado ? t('checkout.copiado') : t('checkout.copiar')}
        </button>
        <p className="text-xs text-texto-fraco pulsando">{t('checkout.aguardando')}</p>
        {aoFechar && (
          <button type="button" onClick={aoFechar} className="text-xs text-texto-suave hover:text-texto">
            {t('checkout.fechar')}
          </button>
        )}
      </div>
    );
  }

  const metodos = [
    { valor: 'pix', rotulo: 'Pix' },
    { valor: 'credit_card', rotulo: t('assinar.cartao') },
    { valor: 'boleto', rotulo: 'Boleto' },
  ] as const;

  return (
    <form onSubmit={pagar} className="mt-7 space-y-4">
      <CampoAuth
        rotulo={t('checkout.nome')}
        valor={nome}
        onChange={setNome}
        autoComplete="name"
        required
        minLength={2}
      />
      <CampoAuth
        rotulo={t('assinar.cpf')}
        valor={documento}
        onChange={setDocumento}
        inputMode="numeric"
        placeholder="000.000.000-00"
        required
        dica={t('assinar.cpfDica')}
      />

      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-texto-suave">{t('assinar.metodo')}</legend>
        <div className="flex gap-1.5">
          {metodos.map((m) => (
            <button
              key={m.valor}
              type="button"
              aria-pressed={metodo === m.valor}
              onClick={() => setMetodo(m.valor)}
              className={`flex-1 rounded-xl border py-2.5 text-sm transition-colors ${
                metodo === m.valor
                  ? 'border-acento bg-acento-suave text-acento'
                  : 'border-borda text-texto-suave hover:text-texto'
              }`}
            >
              {m.rotulo}
            </button>
          ))}
        </div>
        {metodo !== 'pix' && (
          <p className="mt-1.5 text-xs text-texto-fraco">{t('checkout.redirecionando')}</p>
        )}
      </fieldset>

      {erro && (
        <p role="alert" className="rounded-xl border border-perigo/40 bg-perigo/10 px-3.5 py-2.5 text-sm text-perigo">
          {erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-xl gradiente-acento py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {enviando ? t('geral.carregando') : botao}
      </button>

      {aoFechar && (
        <button
          type="button"
          onClick={aoFechar}
          className="w-full text-center text-xs text-texto-suave hover:text-texto"
        >
          {t('checkout.fechar')}
        </button>
      )}
    </form>
  );
}
