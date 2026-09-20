'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

export default function Entrar() {
  const { t } = useI18n();
  const { entrar, cadastrar } = useSessao();
  const router = useRouter();

  const [modo, setModo] = useState<'entrar' | 'cadastrar'>('cadastrar');
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
      if (modo === 'entrar') await entrar(email, senha);
      else await cadastrar(nome, email, senha);
      router.push('/criar');
    } catch (err) {
      setErro(err instanceof Error ? err.message : t('geral.erro'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-bold">
        {modo === 'entrar' ? t('auth.bemVindo') : t('auth.comece')}
      </h1>
      {modo === 'cadastrar' && (
        <p className="mt-2 text-sm text-texto-suave">{t('auth.comeceDica')}</p>
      )}

      <form onSubmit={enviar} className="mt-7 space-y-3">
        {modo === 'cadastrar' && (
          <CampoAuth rotulo={t('auth.nome')} valor={nome} onChange={setNome} autoComplete="name" required />
        )}
        <CampoAuth
          rotulo={t('auth.email')}
          valor={email}
          onChange={setEmail}
          tipo="email"
          autoComplete="email"
          required
        />
        <CampoAuth
          rotulo={t('auth.senha')}
          valor={senha}
          onChange={setSenha}
          tipo="password"
          autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
          required
          minLength={8}
        />

        {erro && (
          <p role="alert" className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-perigo">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-xl gradiente-acento py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {enviando ? t('geral.carregando') : modo === 'entrar' ? t('auth.entrar') : t('auth.criarConta')}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setModo((m) => (m === 'entrar' ? 'cadastrar' : 'entrar'));
          setErro(null);
        }}
        className="mt-5 text-sm text-texto-suave underline-offset-4 hover:text-texto hover:underline"
      >
        {modo === 'entrar' ? t('auth.naoTenhoConta') : t('auth.jaTenhoConta')}
      </button>
    </div>
  );
}

function CampoAuth({
  rotulo,
  valor,
  onChange,
  tipo = 'text',
  ...resto
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
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
        className="w-full rounded-xl border border-borda bg-superficie px-3 py-2.5 text-sm outline-none focus:border-acento/60"
      />
    </label>
  );
}
