'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PainelCriar } from '@/components/criar/painel';
import { BotaoCancelar } from '@/components/criar/cancelar';
import { CartaoMusica } from '@/components/musica/cartao';
import { api, type Musica, type Pagina } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ROTULOS_STATUS, useAoConcluirGeracao, useProgresso } from '@/lib/progresso';
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

function Conteudo() {
  const { t, locale } = useI18n();
  const { usuario, carregando } = useSessao();
  const { emAndamento } = useProgresso();
  const parametros = useSearchParams();
  const [recentes, setRecentes] = useState<Musica[]>([]);

  const carregarRecentes = () => {
    if (!usuario) return;
    void api
      .get<Pagina<Musica>>('/songs?limit=12')
      .then((p) => setRecentes(p.items))
      .catch(() => setRecentes([]));
  };

  useEffect(carregarRecentes, [usuario]);
  // Geração terminou: a biblioteca lateral recarrega sozinha, sem o usuário
  // precisar atualizar a página para ver a música que acabou de criar.
  useAoConcluirGeracao(carregarRecentes);

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

  const andamento = Object.values(emAndamento);

  return (
    <div className="flex flex-col gap-6 px-4 py-6 lg:h-[calc(100vh-7rem)] lg:flex-row lg:px-6">
      <div className="w-full shrink-0 lg:max-w-sm">
        <h1 className="mb-4 text-xl font-bold">{t('criar.titulo')}</h1>
        <PainelCriar
          chavePrompt={parametros.get('prompt') ?? undefined}
          // Recarrega ao ENFILEIRAR, não só ao concluir. A API já gravou a
          // música com status 'queued' antes de responder, então ela aparece
          // na hora, com a barra de progresso rodando no próprio card.
          aoEnfileirar={carregarRecentes}
        />
      </div>

      <div className="min-w-0 flex-1 lg:overflow-y-auto">
        {andamento.length > 0 && (
          <ul className="mb-5 space-y-2">
            {andamento.map((g) => (
              <li key={g.generationId} className="card flex items-center gap-3 p-3">
                {g.song?.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada do R2, expira
                  <img
                    src={g.song.coverUrl}
                    alt=""
                    className="size-10 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="size-10 shrink-0 rounded-lg gradiente-acento pulsando" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {ROTULOS_STATUS[g.status]?.[locale] ?? g.status}
                  </p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-borda">
                    <div
                      className="h-full gradiente-acento transition-all duration-500"
                      style={{ width: `${g.progress}%` }}
                    />
                  </div>
                  {g.error && <p className="mt-1 text-xs text-perigo">{g.error}</p>}
                </div>
                <span className="text-xs tabular-nums text-texto-fraco">{g.progress}%</span>
                <BotaoCancelar generationId={g.generationId} />
              </li>
            ))}
          </ul>
        )}

        {recentes.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {recentes.map((m) => (
              <CartaoMusica key={m.id} musica={m} fila={recentes} href={`/musica/${m.id}`} />
            ))}
          </div>
        ) : (
          andamento.length === 0 && (
            <p className="py-20 text-center text-sm text-texto-suave">{t('lib.vazia')}</p>
          )
        )}
      </div>
    </div>
  );
}
