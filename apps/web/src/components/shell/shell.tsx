'use client';

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
export function Shell({ children, locale }: { children: ReactNode; locale: Locale }) {
  return (
    <I18nProvider inicial={locale}>
      <SessaoProvider>
        <ProgressoProvider>
          <PlayerProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              {/* pb-28 abre espaço para o player fixo: sem isso o último item
                  de qualquer lista fica escondido atrás dele. */}
              <main className="min-w-0 flex-1 pb-28">{children}</main>
            </div>
            <Player />
          </PlayerProvider>
        </ProgressoProvider>
      </SessaoProvider>
    </I18nProvider>
  );
}
