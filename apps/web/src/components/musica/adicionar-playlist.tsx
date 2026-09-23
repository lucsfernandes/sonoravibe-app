'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type Playlist } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Adiciona a música a uma playlist.
 *
 * As playlists só são buscadas quando o menu abre. Carregá-las junto com a
 * página custaria uma requisição em toda visita para um botão que quase
 * ninguém clica.
 *
 * Criar uma playlist nova sem sair daqui é o caminho mais comum na primeira
 * vez: quem ainda não tem nenhuma quer justamente criar a primeira com esta
 * música dentro, e mandá-la para outra tela perderia o contexto.
 */
export function AdicionarAPlaylist({
  songId,
  compacto,
  aparencia = 'redondo',
  alinhamento = 'esquerda',
}: {
  songId: string;
  /** Botão só com o ícone, para as fileiras da aba Criar e a página da música. */
  compacto?: boolean;
  /** 'quadrado' é o "+" de borda da página da música; 'redondo' é o das fileiras. */
  aparencia?: 'redondo' | 'quadrado';
  /** Para onde o painel abre. 'direita' quando o botão está na beira da tela. */
  alinhamento?: 'esquerda' | 'direita';
}) {
  const { t } = useI18n();
  const [aberto, setAberto] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [nova, setNova] = useState('');
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    void api
      .get<Playlist[]>('/playlists')
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, [aberto]);

  // Fecha ao clicar fora. Sem isto o menu ficaria aberto enquanto a pessoa
  // interage com o resto da página, cobrindo o conteúdo abaixo dele.
  useEffect(() => {
    if (!aberto) return;
    function aoClicar(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [aberto]);

  async function adicionar(playlistId: string, nome: string) {
    setOcupado(true);
    setErro(null);
    try {
      await api.post(`/playlists/${playlistId}/songs`, { songId });
      setFeito(nome);
      setAberto(false);
    } catch (err) {
      // 409: já está na playlist. Dizer "adicionada" seria mentira; dizer
      // "erro" assustaria sem motivo.
      if (err instanceof ApiError && err.status === 409) {
        setFeito(nome);
        setAberto(false);
        return;
      }
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(false);
    }
  }

  async function criarEAdicionar(e: React.FormEvent) {
    e.preventDefault();
    const nome = nova.trim();
    if (!nome || ocupado) return;

    setOcupado(true);
    setErro(null);
    try {
      const criada = await api.post<Playlist>('/playlists', { name: nome, isPublic: false });
      await api.post(`/playlists/${criada.id}/songs`, { songId });
      setNova('');
      setFeito(nome);
      setAberto(false);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => {
          setAberto((a) => !a);
          setFeito(null);
        }}
        aria-expanded={aberto}
        aria-label={compacto ? (feito ? `✓ ${feito}` : t('playlists.adicionar')) : undefined}
        title={compacto ? (feito ? `✓ ${feito}` : t('playlists.adicionar')) : undefined}
        className={
          compacto
            ? aparencia === 'quadrado'
              ? `flex size-11 items-center justify-center rounded-xl border border-borda transition-colors hover:bg-superficie-alta ${
                  feito ? 'text-acento' : 'text-texto hover:text-texto'
                }`
              : `flex size-8 items-center justify-center rounded-full bg-superficie-alta transition-colors hover:bg-borda ${
                  feito ? 'text-acento' : 'text-texto-suave hover:text-texto'
                }`
            : 'rounded-xl border border-borda px-4 py-2.5 text-sm transition-colors hover:border-acento hover:text-acento'
        }
      >
        {compacto ? (
          aparencia === 'quadrado' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M4 6h12M4 12h12M4 18h7M18 14v6M15 17h6" />
            </svg>
          )
        ) : feito ? (
          `✓ ${feito}`
        ) : (
          t('playlists.adicionar')
        )}
      </button>

      {aberto && (
        <div
          className={`absolute top-full z-20 mt-2 w-64 rounded-xl border border-borda bg-superficie-alta p-2 shadow-lg ${
            alinhamento === 'direita' ? 'right-0' : 'left-0'
          }`}
        >
          {playlists === null ? (
            <p className="px-2 py-3 text-xs text-texto-fraco pulsando">{t('geral.carregando')}</p>
          ) : (
            playlists.length > 0 && (
              <ul className="max-h-56 overflow-y-auto">
                {playlists.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => void adicionar(p.id, p.name)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-superficie disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate">{p.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-texto-fraco">
                        {p.songCount}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          <form
            onSubmit={criarEAdicionar}
            className={playlists && playlists.length > 0 ? 'mt-2 border-t border-borda pt-2' : ''}
          >
            <label className="sr-only" htmlFor={`nova-playlist-${songId}`}>
              {t('playlists.criarCom')}
            </label>
            <input
              id={`nova-playlist-${songId}`}
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              placeholder={t('playlists.criarCom')}
              maxLength={120}
              className="w-full rounded-lg border border-borda bg-superficie px-2 py-1.5 text-sm outline-none placeholder:text-texto-fraco focus:border-texto-fraco"
            />
          </form>

          {erro && <p className="mt-2 px-2 text-xs text-perigo">{erro}</p>}
        </div>
      )}
    </div>
  );
}
