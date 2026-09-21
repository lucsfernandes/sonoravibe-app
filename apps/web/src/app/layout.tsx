import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Shell } from '@/components/shell/shell';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sonora Vibe — crie músicas com IA',
  description:
    'Descreva o que você quer ouvir e receba uma música completa, com ou sem letra. '
    + 'Baixe em MP3, WAV ou FLAC.',
  applicationName: 'Sonora Vibe',
};

export const viewport: Viewport = {
  themeColor: '#0D0C0F',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // O idioma vem do cookie no servidor para a primeira pintura já sair certa —
  // decidir no cliente faria a interface piscar em português antes de virar
  // inglês para quem escolheu inglês.
  const locale = ((await cookies()).get(LOCALE_COOKIE)?.value ?? 'pt') as Locale;

  return (
    <html lang={locale === 'pt' ? 'pt-BR' : 'en'} suppressHydrationWarning>
      <body className="min-h-screen bg-fundo text-texto antialiased">
        <Shell locale={locale}>{children}</Shell>
      </body>
    </html>
  );
}
