'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

/**
 * Entrar e criar conta.
 *
 * Roda sem a casca do aplicativo (ver `SEM_CASCA` no Shell): a navegação
 * lateral só oferece rotas que exigem login, então para um visitante ela é um
 * menu de portas trancadas — e come a largura da única coisa que ele veio
 * fazer.
 *
 * O layout é de duas colunas no desktop e uma no celular. A coluna da esquerda
 * não é enfeite: quem chega aqui vindo do site institucional já foi convencido,
 * mas quem chega por um link direto não viu nada — os três pontos e a marca
 * dão o contexto mínimo para a pessoa entender o que está assinando.
 *
 * No celular essa coluna some inteira. Empilhada, ela empurraria o formulário
 * para baixo da dobra, e o custo de rolar até o campo de e-mail é maior que o
 * benefício de ler a lista de novo.
 */
export default function Entrar() {
  return (
    // `useSearchParams` exige Suspense no App Router; sem ele a rota inteira
    // vira renderização dinâmica e o build reclama.
    <Suspense fallback={<div className="min-h-screen bg-fundo" />}>
      <PaginaEntrar />
    </Suspense>
  );
}

function PaginaEntrar() {
  const { t } = useI18n();
  const { entrar, cadastrar } = useSessao();
  const router = useRouter();
  const parametros = useSearchParams();

  // `?modo=entrar` no link permite mandar alguém direto para o lado certo —
  // um e-mail de "sua conta está pronta" não deve abrir em "criar conta".
  const [modo, setModo] = useState<'entrar' | 'cadastrar'>(
    parametros.get('modo') === 'entrar' ? 'entrar' : 'cadastrar',
  );
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
      router.push('/criar');
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
            SONORA
          </Link>

          <h1 className="text-2xl font-bold tracking-tight">
            {entrando ? t('auth.bemVindo') : t('auth.comece')}
          </h1>
          <p className="mt-2 text-sm text-texto-suave">
            {entrando ? t('auth.entrarDica') : t('auth.comeceDica')}
          </p>

          <form onSubmit={enviar} className="mt-8 space-y-4">
            {!entrando && (
              <Campo
                rotulo={t('auth.nome')}
                valor={nome}
                onChange={setNome}
                autoComplete="name"
                placeholder={t('auth.nomePlaceholder')}
                required
              />
            )}
            <Campo
              rotulo={t('auth.email')}
              valor={email}
              onChange={setEmail}
              tipo="email"
              autoComplete="email"
              placeholder="voce@exemplo.com"
              required
            />
            <Campo
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
            <button
              type="button"
              onClick={() => {
                setModo(entrando ? 'cadastrar' : 'entrar');
                setErro(null);
              }}
              className="font-medium text-acento underline-offset-4 hover:underline"
            >
              {entrando ? t('auth.criarConta') : t('auth.entrar')}
            </button>
          </p>

          {!entrando && (
            <p className="mt-8 text-xs leading-relaxed text-texto-fraco">
              {t('auth.aoCriar')}{' '}
              <a href="/politica-de-privacidade.html" className="underline underline-offset-2 hover:text-texto-suave">
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

/** Coluna da esquerda: marca, promessa e o que a conta dá. Só no desktop. */
function Apresentacao() {
  const { t } = useI18n();

  const pontos = [
    { titulo: t('auth.ponto1'), texto: t('auth.ponto1Texto') },
    { titulo: t('auth.ponto2'), texto: t('auth.ponto2Texto') },
    { titulo: t('auth.ponto3'), texto: t('auth.ponto3Texto') },
  ];

  return (
    <aside className="relative hidden overflow-hidden border-r border-borda bg-superficie lg:flex lg:flex-col lg:justify-between lg:p-12">
      {/* Brilho de fundo. `pointer-events-none` porque ele cobre a coluna
          inteira e engoliria o clique no logo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 size-[28rem] rounded-full opacity-20 blur-3xl gradiente-acento"
      />

      <Link href="/" className="relative text-2xl font-black tracking-tight">
        SONORA
      </Link>

      <div className="relative">
        <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight">
          {t('auth.promessa')}
        </h2>

        <ul className="mt-10 space-y-6">
          {pontos.map((p) => (
            <li key={p.titulo} className="flex gap-3.5">
              <span
                aria-hidden
                className="mt-1 size-1.5 shrink-0 rounded-full gradiente-acento"
              />
              <div>
                <p className="text-sm font-medium">{p.titulo}</p>
                <p className="mt-0.5 max-w-xs text-sm text-texto-suave">{p.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-texto-fraco">{t('auth.rodape')}</p>
    </aside>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  tipo = 'text',
  dica,
  ...resto
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
  dica?: string;
  // `onChange` é omitido de propósito: o nosso recebe a string pronta, e o do
  // DOM recebe o evento — deixar os dois no mesmo nome cria um tipo impossível.
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-texto-suave">{rotulo}</span>
      <input
        {...resto}
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-borda bg-fundo px-3.5 py-3 text-sm outline-none transition-colors placeholder:text-texto-fraco focus:border-acento"
      />
      {dica && <span className="mt-1.5 block text-xs text-texto-fraco">{dica}</span>}
    </label>
  );
}
