'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type EstiloSalvo } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Presets de estilo: salva o que está escrito agora e traz de volta depois.
 *
 * Quem produz música no Sonora repete a mesma combinação de estilos dezenas de
 * vezes — "MPB anos 70, violão nylon, sem bateria eletrônica" não é algo que se
 * queira redigitar. O backend já guardava isso; faltava a tela.
 *
 * Aplicar um preset sobrescreve os dois campos (estilos e exclusões) de uma vez,
 * porque eles foram salvos juntos e funcionam como par: aplicar só metade
 * deixaria uma exclusão órfã de outro preset valendo em silêncio.
 */
export function EstilosSalvos({
  estilosAtuais,
  excluirAtuais,
  aoAplicar,
}: {
  estilosAtuais: string;
  excluirAtuais: string;
  aoAplicar: (estilos: string, excluir: string) => void;
}) {
  const { t } = useI18n();

  const [itens, setItens] = useState<EstiloSalvo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [nomeando, setNomeando] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async () => {
    try {
      setItens(await api.get<EstiloSalvo[]>('/styles'));
    } catch {
      // Sem presets a aba continua utilizável: só não mostra os atalhos.
      setItens([]);
    }
  }, []);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  async function salvar() {
    const limpo = nome.trim();
    if (!limpo || !estilosAtuais.trim() || salvando) return;

    setSalvando(true);
    setErro(null);
    try {
      await api.post('/styles', {
        name: limpo,
        prompt: estilosAtuais.trim(),
        ...(excluirAtuais.trim() ? { excludeStyles: excluirAtuais.trim() } : {}),
      });
      setNome('');
      setNomeando(false);
      await buscar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t('geral.erro'));
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(id: string) {
    const antes = itens;
    setItens((atual) => atual.filter((e) => e.id !== id));
    try {
      await api.delete(`/styles/${id}`);
    } catch {
      setItens(antes);
    }
  }

  return (
    <div className="mt-2">
      {itens.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {itens.map((e) => (
            <li key={e.id} className="flex items-center overflow-hidden rounded-full border border-borda">
              <button
                type="button"
                onClick={() => aoAplicar(e.prompt, e.excludeStyles ?? '')}
                title={e.prompt}
                className="max-w-40 truncate py-1 pl-3 pr-1.5 text-xs text-texto-suave transition-colors hover:text-acento"
              >
                {e.name}
              </button>
              <button
                type="button"
                onClick={() => void apagar(e.id)}
                aria-label={`${t('geral.excluir')} ${e.name}`}
                className="px-1.5 py-1 text-xs text-texto-fraco transition-colors hover:text-perigo"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {nomeando ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="nome-preset">
            {t('estilos.nome')}
          </label>
          <input
            id="nome-preset"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={t('estilos.nome')}
            maxLength={120}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-borda bg-superficie px-2 py-1.5 text-xs outline-none placeholder:text-texto-fraco focus:border-texto-fraco"
          />
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!nome.trim() || salvando}
            className="rounded-lg border border-borda px-3 py-1.5 text-xs transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
          >
            {salvando ? t('geral.enviando') : t('geral.salvar')}
          </button>
          <button
            type="button"
            onClick={() => setNomeando(false)}
            className="px-1 text-xs text-texto-suave hover:text-texto"
          >
            {t('geral.cancelar')}
          </button>
        </div>
      ) : (
        // Só oferece salvar quando há algo para salvar: um preset vazio não
        // serve para nada e o backend recusaria de qualquer forma.
        estilosAtuais.trim().length > 0 && (
          <button
            type="button"
            onClick={() => setNomeando(true)}
            className="mt-2 text-xs text-texto-fraco transition-colors hover:text-acento"
          >
            + {t('estilos.salvar')}
          </button>
        )
      )}

      {erro && <p className="mt-1 text-xs text-perigo">{erro}</p>}
    </div>
  );
}
