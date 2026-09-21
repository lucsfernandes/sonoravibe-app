'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { I18nProvider, type Locale } from '@/lib/i18n';
import { PlayerProvider } from '@/lib/player';
import { ProgressoProvider } from '@/lib/progresso';
import { SessaoProvider } from '@/lib/sessao';
import { Player } from './player';
import { Sidebar } from './sidebar';

/**
 * Casca do aplicativo: provedores, navegação e player.
 *
 * A ordem dos provedores importa — `ProgressoProvider` assina o SSE só quando
 * há usuário, então precisa estar dentro de `SessaoProvider`.
 */
/**
 * Rotas que não são "dentro do aplicativo".
 *
 * Numa tela de entrar ou criar conta, a navegação lateral só oferece caminhos
 * que exigem login — ela mostra ao visitante um menu inteiro de portas
 * trancadas, e rouba a largura da única coisa que ele precisa fazer ali.
 */
const SEM_CASCA = ['/entrar', '/criar-conta', '/assinar', '/planos'];

export function Shell({ children, locale }: { children: ReactNode; locale: Locale }) {
  const caminho = usePathname();
  const nuas = SEM_CASCA.some((rota) => caminho.startsWith(rota));

  return (
    <I18nProvider inicial={locale}>
      <SessaoProvider>
        <ProgressoProvider>
          <PlayerProvider>
            {nuas ? (
              // Sem sidebar e sem `pb-28`: não há player para desviar, e o
              // espaço reservado deixaria a tela pendurada no topo.
              <main className="min-h-screen">{children}</main>
            ) : (
              <div className="flex min-h-screen">
                <Sidebar />
                {/* pb-28 abre espaço para o player fixo: sem isso o último item
                    de qualquer lista fica escondido atrás dele. */}
                <main className="min-w-0 flex-1 pb-28">{children}</main>
              </div>
            )}
            {/* O player some junto: ele toca música do catálogo, e quem está
                nesta tela ainda não tem catálogo. */}
            {!nuas && <Player />}
          </PlayerProvider>
        </ProgressoProvider>
      </SessaoProvider>
    </I18nProvider>
  );
}
