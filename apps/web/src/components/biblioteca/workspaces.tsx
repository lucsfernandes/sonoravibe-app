'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Workspace } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Workspaces da biblioteca: filtram e se gerenciam no mesmo lugar.
 *
 * O painel de criação já deixava escolher um workspace, mas não havia como
 * criar nenhum — o seletor só mostrava o padrão, e a funcionalidade parecia
 * quebrada em vez de incompleta.
 *
 * Excluir um workspace não apaga música nenhuma: o backend só desvincula as
 * faixas (`workspaceId = null`) e elas continuam na biblioteca. A tela diz isso
 * na confirmação, porque "excluir" ao lado de uma lista de músicas soa muito
 * pior do que é.
 *
 * O workspace padrão não pode ser excluído, então nem mostra a opção — um botão
 * que só existe para devolver 403 é pior que a ausência dele.
 */
export function Workspaces({
  selecionado,
  aoSelecionar,
}: {
  selecionado: string | null;
  aoSelecionar: (id: string | null) => void;
}) {
  const { t } = useI18n();

  const [itens, setItens] = useState<Workspace[]>([]);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    try {
      setItens(await api.get<Workspace[]>('/workspaces'));
    } catch {
      setItens([]);
    }
  }, []);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  async function agir(chamada: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await chamada();
      await buscar();
      setNome('');
      setCriando(false);
      setEditando(null);
      setConfirmando(null);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setOcupado(false);
    }
  }

  // Com um workspace só (o padrão, criado no cadastro), a barra seria ruído:
  // filtrar entre "todos" e o único que existe não filtra nada. Mostra só o
  // convite a criar o segundo.
  const soTemPadrao = itens.length <= 1;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {!soTemPadrao && (
          <Chip ativo={selecionado === null} onClick={() => aoSelecionar(null)}>
            {t('lib.todas')}
          </Chip>
        )}

        {!soTemPadrao &&
          itens.map((w) =>
            editando === w.id ? (
              <FormaNome
                key={w.id}
                inicial={w.name}
                ocupado={ocupado}
                aoCancelar={() => setEditando(null)}
                aoConfirmar={(novo) =>
                  void agir(() => api.patch(`/workspaces/${w.id}`, { name: novo }))
                }
              />
            ) : (
              <span key={w.id} className="flex items-center overflow-hidden rounded-full border border-borda">
                <button
                  type="button"
                  aria-pressed={selecionado === w.id}
                  onClick={() => aoSelecionar(w.id)}
                  onDoubleClick={() => setEditando(w.id)}
                  title={t('workspaces.duploClique')}
                  className={`py-1.5 pl-3 pr-1.5 text-sm transition-colors ${
                    selecionado === w.id ? 'text-acento' : 'text-texto-suave hover:text-texto'
                  }`}
                >
                  {w.name}
                  <span className="ml-1.5 text-xs tabular-nums text-texto-fraco">
                    {w.songCount}
                  </span>
                </button>
                {!w.isDefault && (
                  <button
                    type="button"
                    onClick={() => setConfirmando(w.id)}
                    aria-label={`${t('geral.excluir')} ${w.name}`}
                    className="px-1.5 py-1.5 text-xs text-texto-fraco transition-colors hover:text-perigo"
                  >
                    ×
                  </button>
                )}
              </span>
            ),
          )}

        {criando ? (
          <FormaNome
            inicial=""
            ocupado={ocupado}
            aoCancelar={() => setCriando(false)}
            aoConfirmar={(novo) => void agir(() => api.post('/workspaces', { name: novo }))}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCriando(true)}
            className="rounded-full border border-dashed border-borda px-3 py-1.5 text-xs text-texto-fraco transition-colors hover:border-acento hover:text-acento"
          >
            + {t('workspaces.novo')}
          </button>
        )}
      </div>

      {confirmando && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-borda bg-superficie px-3 py-2">
          <p className="text-xs text-texto-suave">{t('workspaces.confirmarExclusao')}</p>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              const id = confirmando;
              // Se o excluído era o filtro ativo, a lista voltaria vazia
              // filtrando por algo que não existe mais.
              if (selecionado === id) aoSelecionar(null);
              void agir(() => api.delete(`/workspaces/${id}`));
            }}
            className="rounded bg-perigo px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {t('geral.excluir')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmando(null)}
            className="text-xs text-texto-suave hover:text-texto"
          >
            {t('geral.cancelar')}
          </button>
        </div>
      )}

      {erro && (
        <p role="alert" className="mt-2 text-xs text-perigo">
          {erro}
        </p>
      )}
    </div>
  );
}

function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        ativo
          ? 'border-acento bg-acento-suave text-acento'
          : 'border-borda text-texto-suave hover:text-texto'
      }`}
    >
      {children}
    </button>
  );
}

function FormaNome({
  inicial,
  ocupado,
  aoConfirmar,
  aoCancelar,
}: {
  inicial: string;
  ocupado: boolean;
  aoConfirmar: (nome: string) => void;
  aoCancelar: () => void;
}) {
  const { t } = useI18n();
  const [valor, setValor] = useState(inicial);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valor.trim()) aoConfirmar(valor.trim());
      }}
      className="flex items-center gap-1"
    >
      <label className="sr-only" htmlFor="nome-workspace">
        {t('workspaces.nome')}
      </label>
      <input
        id="nome-workspace"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={t('workspaces.nome')}
        maxLength={100}
        autoFocus
        // Esc fecha sem salvar: é o que se espera de um campo que abriu por
        // cima de outra coisa.
        onKeyDown={(e) => e.key === 'Escape' && aoCancelar()}
        className="w-36 rounded-full border border-borda bg-superficie px-3 py-1.5 text-sm outline-none placeholder:text-texto-fraco focus:border-acento"
      />
      <button
        type="submit"
        disabled={!valor.trim() || ocupado}
        className="rounded-full border border-borda px-2.5 py-1.5 text-xs transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={aoCancelar}
        className="px-1 text-xs text-texto-suave hover:text-texto"
      >
        ×
      </button>
    </form>
  );
}
