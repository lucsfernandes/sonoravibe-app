'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { CartaoMusica } from '@/components/musica/cartao';
import { ApiError, api, type Musica } from '@/lib/api';
import { formatarContagem, useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

interface Perfil {
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
  isMe: boolean;
  followedByMe: boolean;
  songs: (Musica & { publishedAt: string | null })[];
}

export default function PaginaPerfil({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const { t, locale } = useI18n();
  const { usuario } = useSessao();

  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [seguindo, setSeguindo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setPerfil(await api.get<Perfil>(`/users/${handle}`));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    }
  }, [handle, t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro) return <p className="p-8 text-sm text-perigo">{erro}</p>;
  if (!perfil) return <p className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</p>;

  async function alternarSeguir() {
    setSeguindo(true);
    try {
      await api.post(`/users/${handle}/follow`, {});
      await carregar();
    } catch {
      // Falha ao seguir não precisa de alarde: o estado na tela continua o
      // anterior e o usuário pode tentar de novo.
    } finally {
      setSeguindo(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center gap-5">
        {perfil.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada, expira
          <img src={perfil.avatarUrl} alt="" className="size-20 rounded-full object-cover" />
        ) : (
          <div className="flex size-20 items-center justify-center rounded-full gradiente-acento text-2xl font-black text-white">
            {perfil.displayName.slice(0, 1).toUpperCase()}
          </div>
        )}

        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{perfil.displayName}</h1>
          <p className="text-sm text-texto-suave">@{perfil.handle}</p>
          <p className="mt-1 text-xs text-texto-fraco">
            {formatarContagem(perfil.followerCount, locale)} seguidores ·{' '}
            {formatarContagem(perfil.followingCount, locale)} seguindo
          </p>
        </div>

        {usuario && !perfil.isMe && (
          <button
            type="button"
            onClick={() => void alternarSeguir()}
            disabled={seguindo}
            className={`ml-auto rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              perfil.followedByMe
                ? 'border border-borda text-texto-suave hover:text-texto'
                : 'gradiente-acento text-white'
            }`}
          >
            {perfil.followedByMe ? 'Seguindo' : 'Seguir'}
          </button>
        )}
      </header>

      {perfil.bio && <p className="mt-5 max-w-2xl text-sm text-texto-suave">{perfil.bio}</p>}

      {perfil.songs.length === 0 ? (
        <p className="py-20 text-center text-sm text-texto-suave">{t('lib.vazia')}</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {perfil.songs.map((m) => (
            <CartaoMusica
              key={m.id}
              musica={m}
              fila={perfil.songs}
              autor={{ handle: perfil.handle, displayName: perfil.displayName }}
              href={`/musica/${m.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
