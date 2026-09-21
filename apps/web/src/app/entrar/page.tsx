import { TelaAuth } from '@/components/auth/tela-auth';

export const metadata = { title: 'Entrar — Sonora Vibe' };

/** `/entrar` mostra o login. Criar conta é `/criar-conta`. */
export default function Entrar() {
  return <TelaAuth modo="entrar" />;
}
