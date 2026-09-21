'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

/**
 * Coluna da esquerda das telas de conta: marca, promessa e o que a conta dá.
 *
 * Não é enfeite. Quem chega vindo do site institucional já foi convencido, mas
 * quem chega por link direto — um e-mail, um print no WhatsApp — não viu nada.
 * Os três pontos dão o contexto mínimo para a pessoa entender o que está
 * assinando.
 *
 * Some inteira no celular. Empilhada, empurraria o formulário para baixo da
 * dobra, e rolar até o campo de e-mail custa mais do que ler a lista de novo.
 */
export function Apresentacao() {
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
        SONORA VIBE
      </Link>

      <div className="relative">
        <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight">
          {t('auth.promessa')}
        </h2>

        <ul className="mt-10 space-y-6">
          {pontos.map((p) => (
            <li key={p.titulo} className="flex gap-3.5">
              <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full gradiente-acento" />
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
