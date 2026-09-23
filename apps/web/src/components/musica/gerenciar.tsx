'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError, type MusicaDetalhe } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Ações do dono sobre a própria música: renomear, permissões e exclusão.
 *
 * Fica fora da fileira de botões principais porque é manutenção, não uso. O
 * que 99% das visitas quer é tocar e baixar; renomear é raro e excluir é raro
 * e irreversível na percepção de quem clica.
 *
 * A exclusão pede confirmação digitada? Não: o backend faz soft delete e o
 * arquivo no R2 só some depois de 30 dias. Um passo a mais aqui seria atrito
 * sem segurança real — mas a confirmação simples fica, porque o clique errado
 * ainda tira a música da biblioteca na hora.
 */
export function GerenciarMusica({
  musica,
  aoAtualizar,
}: {
  musica: MusicaDetalhe;
  aoAtualizar: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState(musica.title);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  async function salvar<T>(chave: string, chamada: () => Promise<T>) {
    setOcupado(chave);
    setErro(null);
    try {
      await chamada();
      await aoAtualizar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(null);
    }
  }

  const tituloMudou = titulo.trim() !== musica.title && titulo.trim().length > 0;

  return (
    <section className="mt-6 rounded-xl border border-borda">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        {t('gerenciar.titulo')}
        <span aria-hidden className={`transition-transform ${aberto ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {aberto && (
        <div className="border-t border-borda px-4 py-4">
          <label className="block text-xs text-texto-suave" htmlFor="titulo-musica">
            {t('gerenciar.nome')}
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id="titulo-musica"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={160}
              className="min-w-0 flex-1 rounded-lg border border-borda bg-superficie px-3 py-2 text-sm outline-none focus:border-texto-fraco"
            />
            <button
              type="button"
              disabled={!tituloMudou || ocupado === 'titulo'}
              onClick={() =>
                void salvar('titulo', () =>
                  api.patch(`/songs/${musica.id}`, { title: titulo.trim() }),
                )
              }
              className="shrink-0 rounded-lg border border-borda px-3 py-2 text-sm transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
            >
              {ocupado === 'titulo' ? t('geral.enviando') : t('geral.salvar')}
            </button>
          </div>

          <div className="mt-5 space-y-3">
            <Permissao
              rotulo={t('gerenciar.permitirComentarios')}
              ativo={musica.allowComments}
              ocupado={ocupado === 'comentarios'}
              onChange={(v) =>
                void salvar('comentarios', () =>
                  api.patch(`/songs/${musica.id}`, { allowComments: v }),
                )
              }
            />
            <Permissao
              rotulo={t('gerenciar.permitirRemixes')}
              ativo={musica.allowRemixes}
              ocupado={ocupado === 'remixes'}
              onChange={(v) =>
                void salvar('remixes', () =>
                  api.patch(`/songs/${musica.id}`, { allowRemixes: v }),
                )
              }
            />
          </div>

          <div className="mt-6 border-t border-borda pt-4">
            {confirmando ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-texto-suave">{t('gerenciar.confirmarExclusao')}</p>
                <button
                  type="button"
                  disabled={ocupado === 'excluir'}
                  onClick={() =>
                    void salvar('excluir', async () => {
                      await api.delete(`/songs/${musica.id}`);
                      // A música não existe mais nesta rota: ficar aqui daria
                      // 404 no próximo recarregamento.
                      router.push('/biblioteca');
                    })
                  }
                  className="rounded-lg bg-perigo px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {ocupado === 'excluir' ? t('geral.enviando') : t('geral.excluir')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  className="text-sm text-texto-suave hover:text-texto"
                >
                  {t('geral.cancelar')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className="text-sm text-texto-fraco transition-colors hover:text-perigo"
              >
                {t('gerenciar.excluirMusica')}
              </button>
            )}
          </div>

          {erro && (
            <p role="alert" className="mt-4 text-sm text-perigo">
              {erro}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Permissao({
  rotulo,
  ativo,
  ocupado,
  onChange,
}: {
  rotulo: string;
  ativo: boolean;
  ocupado: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-texto-suave">{rotulo}</span>
      <button
        type="button"
        role="switch"
        aria-checked={ativo}
        aria-label={rotulo}
        disabled={ocupado}
        onClick={() => onChange(!ativo)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          ativo ? 'gradiente-acento' : 'bg-superficie-alta'
        }`}
      >
        {/* `left-0.5` explícito: sem isso o elemento absoluto herda a posição
            estática centralizada do pai e o botão aparece no lado errado. */}
        <span
          className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform ${
            ativo ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );
}
