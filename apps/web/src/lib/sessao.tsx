'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { API_URL, api, type Perfil, type Saldo } from './api';

/**
 * Sessão, saldo e perfil, num contexto só.
 *
 * Os três andam juntos na interface: quase toda tela que sabe quem é o usuário
 * também precisa mostrar quantos créditos restam e o nome e a foto no menu, e
 * separá-los levaria a chamadas em cascata no primeiro render.
 */

export interface Usuario {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface Sessao {
  usuario: Usuario | null;
  saldo: Saldo | null;
  /** Nome de exibição, handle, bio e foto. Null até carregar (ou se falhar). */
  perfil: Perfil | null;
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<void>;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  recarregarSaldo: () => Promise<void>;
  recarregarPerfil: () => Promise<void>;
}

const Contexto = createContext<Sessao | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregarSaldo = useCallback(async () => {
    try {
      setSaldo(await api.get<Saldo>('/credits'));
    } catch {
      // Sem saldo carregado a interface ainda funciona: os botões que custam
      // crédito só descobrem a falta ao receber 402, e aí oferecem a recarga.
      setSaldo(null);
    }
  }, []);

  const carregarPerfil = useCallback(async () => {
    try {
      setPerfil(await api.get<Perfil>('/me'));
    } catch {
      // Sem perfil o menu cai no nome da sessão e na inicial do nome.
      setPerfil(null);
    }
  }, []);

  const carregarSessao = useCallback(async () => {
    try {
      const resposta = await fetch(`${API_URL}/api/auth/get-session`, {
        credentials: 'include',
      });
      const dados = (await resposta.json()) as { user?: Usuario } | null;
      setUsuario(dados?.user ?? null);
      if (dados?.user) await Promise.all([carregarSaldo(), carregarPerfil()]);
    } catch {
      setUsuario(null);
    } finally {
      setCarregando(false);
    }
  }, [carregarSaldo, carregarPerfil]);

  useEffect(() => {
    void carregarSessao();
  }, [carregarSessao]);

  const autenticar = useCallback(
    async (caminho: string, corpo: Record<string, string>) => {
      const resposta = await fetch(`${API_URL}/api/auth/${caminho}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });

      const dados = (await resposta.json().catch(() => null)) as {
        user?: Usuario;
        message?: string;
      } | null;

      if (!resposta.ok) {
        throw new Error(dados?.message ?? 'Não consegui entrar. Confira os dados.');
      }

      setUsuario(dados?.user ?? null);
      await Promise.all([carregarSaldo(), carregarPerfil()]);
    },
    [carregarSaldo, carregarPerfil],
  );

  const valor = useMemo<Sessao>(
    () => ({
      usuario,
      saldo,
      perfil,
      carregando,
      entrar: (email, password) => autenticar('sign-in/email', { email, password }),
      cadastrar: (name, email, password) =>
        autenticar('sign-up/email', { name, email, password }),
      sair: async () => {
        await fetch(`${API_URL}/api/auth/sign-out`, {
          method: 'POST',
          credentials: 'include',
        });
        setUsuario(null);
        setSaldo(null);
        setPerfil(null);
      },
      recarregarSaldo: carregarSaldo,
      recarregarPerfil: carregarPerfil,
    }),
    [usuario, saldo, perfil, carregando, autenticar, carregarSaldo, carregarPerfil],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): Sessao {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useSessao precisa estar dentro de <SessaoProvider>.');
  return contexto;
}
