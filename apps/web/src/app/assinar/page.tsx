'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Apresentacao } from '@/components/auth/apresentacao';
import { CampoAuth } from '@/components/auth/campo';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/**
 * Checkout de assinatura: conta e pagamento na mesma tela.
 *
 * Antes, "Assinar o Pro" no site levava para o cadastro genérico e perdia o
 * plano escolhido pelo caminho — a pessoa criava a conta e caía no `/criar`,
 * tendo que achar a página de créditos e escolher o plano de novo. Quem já
 * decidiu pagar não deve precisar decidir duas vezes.
 *
 * São dois passos porque a cobrança precisa de um usuário: o Asaas emite a
 * fatura no nome de alguém. Quem já está logado começa direto no passo 2.
 */

const PLANOS = ['pro', 'premier'] as const;
type Plano = (typeof PLANOS)[number];

interface Catalogo {
  plans: {
    code: string;
    name: string;
    priceBrl: number;
    monthlyCredits: number;
    features: { maxDurationSeconds: number; stems: boolean; batchDownload: boolean; maxMode: boolean };
  }[];
}

export default function Assinar() {
  return (
    // `useSearchParams` exige Suspense no App Router.
    <Suspense fallback={<div className="min-h-screen bg-fundo" />}>
      <PaginaAssinar />
    </Suspense>
  );
}

function PaginaAssinar() {
  const { t, locale } = useI18n();
  const { usuario, carregando, cadastrar, recarregarSaldo } = useSessao();
  const parametros = useSearchParams();

  const pedido = parametros.get('plano');
  const plano: Plano = PLANOS.includes(pedido as Plano) ? (pedido as Plano) : 'pro';

  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  useEffect(() => {
    void api.get<Catalogo>('/plans').then(setCatalogo).catch(() => setCatalogo(null));
  }, []);

  const dados = catalogo?.plans.find((p) => p.code === plano);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <Apresentacao />

      <div className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 inline-block text-2xl font-black tracking-tight lg:hidden">
            SONORA VIBE
          </Link>

          {dados && (
            <div className="mb-7 rounded-xl border border-acento/40 bg-acento-suave px-4 py-3">
              <p className="text-xs text-texto-suave">{t('assinar.plano')}</p>
              <p className="mt-0.5 text-lg font-bold">
                {dados.name}{' '}
                <span className="text-sm font-normal text-texto-suave">
                  {new Intl.NumberFormat(locale === 'pt' ? 'pt-BR' : 'en-US', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(dados.priceBrl)}
                  {t('creditos.porMes')}
                </span>
              </p>
              <p className="mt-1 text-xs text-texto-suave">
                {dados.monthlyCredits.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US')}{' '}
                {t('criar.custo')} · {Math.round(dados.features.maxDurationSeconds / 60)}{' '}
                {t('creditos.minPorMusica')}
                {dados.features.stems && ` · ${t('musica.stems')}`}
              </p>
            </div>
          )}

          <Passos atual={usuario ? 2 : 1} />

          {carregando ? (
            <p className="mt-8 text-sm text-texto-fraco pulsando">{t('geral.carregando')}</p>
          ) : usuario ? (
            <Pagamento plano={plano} aoPagar={recarregarSaldo} />
          ) : (
            <CriarConta plano={plano} cadastrar={cadastrar} />
          )}

          <p className="mt-8 text-center text-sm text-texto-suave">
            <Link href="/creditos" className="hover:text-texto">
              {t('assinar.verOutros')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Indicador dos dois passos. Deixa claro que criar a conta não é o fim. */
function Passos({ atual }: { atual: 1 | 2 }) {
  const { t } = useI18n();
  const passos = [t('assinar.passoConta'), t('assinar.passoPagamento')];

  return (
    <ol className="flex items-center gap-2 text-xs">
      {passos.map((rotulo, i) => {
        const numero = i + 1;
        const feito = numero < atual;
        const ativo = numero === atual;
        return (
          <li key={rotulo} className="flex items-center gap-2">
            <span
              aria-current={ativo ? 'step' : undefined}
              className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                feito || ativo ? 'gradiente-acento text-white' : 'bg-superficie-alta text-texto-fraco'
              }`}
            >
              {feito ? '✓' : numero}
            </span>
            <span className={ativo ? 'font-medium' : 'text-texto-fraco'}>{rotulo}</span>
            {numero < passos.length && <span aria-hidden className="text-texto-fraco">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Passo 1: a conta que vai receber a fatura. */
function CriarConta({
  plano,
  cadastrar,
}: {
  plano: Plano;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      // Sem `router.push`: o `usuario` do contexto muda e esta mesma tela
      // troca para o passo 2. Navegar perderia o plano escolhido da URL.
      await cadastrar(nome, email, senha);
    } catch (err) {
      setErro(err instanceof Error ? err.message : t('geral.erro'));
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="mt-7 space-y-4">
      <CampoAuth
        rotulo={t('auth.nome')}
        valor={nome}
        onChange={setNome}
        autoComplete="name"
        placeholder={t('auth.nomePlaceholder')}
        required
      />
      <CampoAuth
        rotulo={t('auth.email')}
        valor={email}
        onChange={setEmail}
        tipo="email"
        autoComplete="email"
        placeholder="voce@exemplo.com"
        required
      />
      <CampoAuth
        rotulo={t('auth.senha')}
        valor={senha}
        onChange={setSenha}
        tipo="password"
        autoComplete="new-password"
        required
        minLength={8}
        dica={t('auth.senhaMinima')}
      />

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
        {enviando ? t('geral.carregando') : t('assinar.continuar')}
      </button>

      <p className="text-center text-sm text-texto-suave">
        {t('auth.temConta')}{' '}
        <Link
          href={`/entrar?destino=${encodeURIComponent(`/assinar?plano=${plano}`)}`}
          className="font-medium text-acento underline-offset-4 hover:underline"
        >
          {t('auth.entrar')}
        </Link>
      </p>
    </form>
  );
}

/** Passo 2: a cobrança em si. */
function Pagamento({ plano, aoPagar }: { plano: Plano; aoPagar: () => Promise<void> }) {
  const { t } = useI18n();
  const [metodo, setMetodo] = useState<'pix' | 'credit_card' | 'boleto'>('pix');
  const [cpf, setCpf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.post<{ paymentUrl?: string; creditsGranted?: number }>(
        '/billing/subscribe',
        { planCode: plano, method: metodo, taxId: cpf.replace(/\D/g, '') || undefined },
      );
      await aoPagar();
      // Gateway real manda para o checkout dele; o provider fake confirma na
      // hora e não tem para onde mandar.
      if (r.paymentUrl) window.location.href = r.paymentUrl;
      else setPronto(true);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <div className="mt-7 rounded-xl border border-sucesso/40 bg-sucesso/10 px-4 py-5 text-center">
        <p className="text-sm font-medium text-sucesso">{t('assinar.confirmado')}</p>
        <Link
          href="/criar"
          className="mt-4 inline-block rounded-xl gradiente-acento px-6 py-2.5 text-sm font-semibold text-white"
        >
          {t('assinar.comecar')}
        </Link>
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
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-texto-suave">
          {t('assinar.metodo')}
        </legend>
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
      </fieldset>

      <CampoAuth
        rotulo={t('assinar.cpf')}
        valor={cpf}
        onChange={setCpf}
        inputMode="numeric"
        placeholder="000.000.000-00"
        required
        // O Asaas exige CPF ou CNPJ para emitir cobrança no Brasil. Dizer isso
        // evita a pergunta "por que um site de música quer meu CPF?".
        dica={t('assinar.cpfDica')}
      />

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
        {enviando ? t('geral.carregando') : t('assinar.pagar')}
      </button>

      <p className="text-center text-xs leading-relaxed text-texto-fraco">
        {t('assinar.cancelarQuando')}
      </p>
    </form>
  );
}
