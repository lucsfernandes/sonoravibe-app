import { TelaAuth } from '@/components/auth/tela-auth';

export const metadata = { title: 'Criar conta — Sonora Vibe' };

/** Rota própria em vez de `/entrar?modo=cadastrar`: a URL diz o que a tela faz. */
export default function CriarConta() {
  return <TelaAuth modo="cadastrar" />;
}
