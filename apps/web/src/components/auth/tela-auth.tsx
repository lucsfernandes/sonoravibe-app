'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';
import { Apresentacao } from './apresentacao';
import { CampoAuth } from './campo';

/**
 * Tela de entrar ou criar conta.
 *
 * O modo vem da rota, não de um estado interno: `/entrar` mostra o login e
 * `/criar-conta` mostra o cadastro. Antes era uma rota só com um botão de
 * alternar, e quem clicava em "Entrar" no site caía no formulário de cadastro —
 * a URL dizia uma coisa e a tela mostrava outra.
 *
 * Alternar entre os dois navega de verdade. Assim o botão Voltar do navegador
 * funciona, o link é compartilhável e o histórico não mente.
 *
 * Roda sem a casca do aplicativo (ver `SEM_CASCA` no Shell): a navegação
 * lateral só oferece rotas que exigem login, então para um visitante ela é um
 * menu de portas trancadas — e come a largura da única coisa que ele veio
 * fazer.
 */
export function TelaAuth({ modo, destino = '/criar' }: { modo: 'entrar' | 'cadastrar'; destino?: string }) {
  return (
    // `useSearchParams` exige Suspense no App Router; sem ele a rota inteira
    // vira renderização dinâmica e o build reclama.
    <Suspense fallback={<div className="min-h-screen bg-fundo" />}>
      <Tela modo={modo} destinoPadrao={destino} />
    </Suspense>
  );
}

function Tela({
  modo,
  destinoPadrao,
}: {
  modo: 'entrar' | 'cadastrar';
  destinoPadrao: string;
}) {
  const { t } = useI18n();
  const parametros = useSearchParams();

  /**
   * Para onde ir depois de entrar.
   *
   * O checkout manda `?destino=/assinar?plano=pro` para quem clica em "já tenho
   * conta": sem isso a pessoa entraria e cairia no `/criar`, perdendo o plano
   * que ela já tinha escolhido.
   *
   * Só caminhos internos são aceitos. Um `destino` vindo da URL é entrada de
   * quem quiser — sem esta checagem, um link com `?destino=https://outro.site`
   * transformaria a nossa tela de login num trampolim de phishing.
   */
  const pedido = parametros.get('destino');
  const destino = pedido && pedido.startsWith('/') && !pedido.startsWith('//') ? pedido : destinoPadrao;

  const { entrar, cadastrar } = useSessao();
  const router = useRouter();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrando = modo === 'entrar';

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      if (entrando) await entrar(email, senha);
      else await cadastrar(nome, email, senha);
      router.push(destino);
    } catch (err) {
      setErro(err instanceof Error ? err.message : t('geral.erro'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <Apresentacao />

      <div className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          {/* A marca aparece aqui só no celular, onde a coluna da esquerda não
              existe: sem ela a tela começaria direto num campo de nome. */}
          <Link
            href="/"
            className="mb-8 inline-block text-2xl font-black tracking-tight lg:hidden"
          >
            SONORA VIBE
          </Link>

          <h1 className="text-2xl font-bold tracking-tight">
            {entrando ? t('auth.bemVindo') : t('auth.comece')}
          </h1>
          <p className="mt-2 text-sm text-texto-suave">
            {entrando ? t('auth.entrarDica') : t('auth.comeceDica')}
          </p>

          <form onSubmit={enviar} className="mt-8 space-y-4">
            {!entrando && (
              <CampoAuth
                rotulo={t('auth.nome')}
                valor={nome}
                onChange={setNome}
                autoComplete="name"
                placeholder={t('auth.nomePlaceholder')}
                required
              />
            )}
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
              autoComplete={entrando ? 'current-password' : 'new-password'}
              required
              minLength={8}
              // O mínimo é dito antes do erro, não depois: descobrir a regra
              // pelo vermelho é perder duas tentativas.
              dica={entrando ? undefined : t('auth.senhaMinima')}
            />

            {erro && (
              <p
                role="alert"
                className="rounded-xl border border-perigo/40 bg-perigo/10 px-3.5 py-2.5 text-sm text-perigo"
              >
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="w-full rounded-xl gradiente-acento py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {enviando
                ? t('geral.carregando')
                : entrando
                  ? t('auth.entrar')
                  : t('auth.criarConta')}
            </button>
          </form>

          <p className="mt-6 text-sm text-texto-suave">
            {entrando ? t('auth.semConta') : t('auth.temConta')}{' '}
            <Link
              href={`${entrando ? '/criar-conta' : '/entrar'}${
                // Alternar não pode perder para onde a pessoa estava indo.
                pedido ? `?destino=${encodeURIComponent(pedido)}` : ''
              }`}
              className="font-medium text-acento underline-offset-4 hover:underline"
            >
              {entrando ? t('auth.criarConta') : t('auth.entrar')}
            </Link>
          </p>

          {!entrando && (
            <p className="mt-8 text-xs leading-relaxed text-texto-fraco">
              {t('auth.aoCriar')}{' '}
              <a
                href="/politica-de-privacidade.html"
                className="underline underline-offset-2 hover:text-texto-suave"
              >
                {t('auth.politica')}
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
