'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { Referencia } from '@/components/criar/adicionar-audio';
import { BibliotecaCriar } from '@/components/criar/biblioteca/biblioteca-criar';
import { PainelCriar } from '@/components/criar/painel';
import { useI18n } from '@/lib/i18n';
import { useSessao } from '@/lib/sessao';

export default function PaginaCriar() {
  return (
    // useSearchParams exige Suspense no App Router: sem ele a rota inteira
    // vira renderização dinâmica e o build reclama.
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}

/**
 * A aba Criar: o painel de criação à esquerda e a biblioteca à direita, os
 * dois com a altura da tela e rolagem própria, como no estúdio de referência.
 *
 * A referência de áudio mora aqui porque os dois lados mexem nela: o painel
 * escolhe pelo "+ Áudio", e a biblioteca oferece "Usar como referência" no
 * menu de qualquer faixa pronta.
 */
function Conteudo() {
  const { t } = useI18n();
  const { usuario, carregando } = useSessao();
  const parametros = useSearchParams();
  const [versao, setVersao] = useState(0);
  const [referencia, setReferencia] = useState<Referencia | null>(null);

  if (carregando) return <div className="p-8 text-sm text-texto-suave">{t('geral.carregando')}</div>;

  if (!usuario) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">{t('auth.comece')}</h1>
        <p className="mt-2 text-sm text-texto-suave">{t('auth.comeceDica')}</p>
        <a
          href="/entrar"
          className="mt-6 inline-block rounded-xl gradiente-acento px-6 py-3 text-sm font-semibold text-white"
        >
          {t('auth.criarConta')}
        </a>
      </div>
    );
  }

  return (
    // A altura desconta o player fixo (zero quando nada toca), que é o mesmo
    // espaço que a casca reserva embaixo: o estúdio ocupa a tela inteira e
    // nunca fica escondido atrás do player.
    <div className="flex flex-col lg:h-[calc(100vh-var(--altura-player))] lg:flex-row">
      <h1 className="sr-only">{t('criar.titulo')}</h1>
      <aside className="w-full shrink-0 border-b border-borda lg:h-full lg:w-[440px] lg:border-b-0 lg:border-r">
        <PainelCriar
          chavePrompt={parametros.get('prompt') ?? undefined}
          referencia={referencia}
          aoMudarReferencia={setReferencia}
          // Recarrega ao ENFILEIRAR, não só ao concluir. A API já gravou a
          // música com status 'queued' antes de responder, então ela aparece
          // na hora, com a barra de progresso rodando na própria linha.
          aoEnfileirar={() => setVersao((v) => v + 1)}
        />
      </aside>

      <section className="min-w-0 flex-1 lg:h-full">
        <BibliotecaCriar
          versao={versao}
          aoUsarReferencia={(m) =>
            setReferencia({
              id: m.id,
              title: m.title,
              coverUrl: m.coverUrl,
              durationMs: m.durationMs,
              status: m.status,
            })
          }
        />
      </section>
    </div>
  );
}
