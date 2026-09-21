'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';

/**
 * Como a lista de músicas é desenhada.
 *
 * Cinco modos porque as tarefas são diferentes. Quem está procurando uma faixa
 * pelo nome quer muitas linhas na tela e não precisa de capa. Quem está
 * escolhendo pela capa quer imagem grande. Quem está conferindo o que já
 * baixou quer ver duração e data em colunas alinhadas, que é o que nenhum grid
 * de cartão entrega.
 *
 * A escolha vive no localStorage e é por navegador, não por conta: é
 * preferência de tela, e a mesma pessoa pode querer lista no monitor grande e
 * miniatura no notebook.
 */

export const MODOS = ['lista', 'pequena', 'media', 'detalhes', 'conteudo'] as const;
export type ModoVisualizacao = (typeof MODOS)[number];

const CHAVE = 'sonora_visualizacao';

/**
 * Lê e guarda o modo escolhido.
 *
 * Começa no padrão e lê a preferência depois da montagem. Ler o localStorage
 * durante o primeiro render faria o servidor desenhar um layout e o cliente
 * trocar para outro, o que o React acusa como divergência de hidratação.
 */
export function useVisualizacao(padrao: ModoVisualizacao = 'media') {
  const [modo, setModo] = useState<ModoVisualizacao>(padrao);

  useEffect(() => {
    try {
      const salvo = localStorage.getItem(CHAVE);
      if (salvo && (MODOS as readonly string[]).includes(salvo)) {
        setModo(salvo as ModoVisualizacao);
      }
    } catch {
      // Janela anônima: segue no padrão.
    }
  }, []);

  function escolher(novo: ModoVisualizacao) {
    setModo(novo);
    try {
      localStorage.setItem(CHAVE, novo);
    } catch {
      // A preferência só não sobrevive ao recarregamento.
    }
  }

  return { modo, escolher };
}

/** As classes do contêiner para cada modo. */
export function classesDaGrade(modo: ModoVisualizacao): string {
  switch (modo) {
    case 'lista':
    case 'detalhes':
      return 'flex flex-col';
    case 'pequena':
      return 'grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8';
    case 'conteudo':
      return 'grid grid-cols-1 gap-4 lg:grid-cols-2';
    default:
      return 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6';
  }
}

export function SeletorVisualizacao({
  modo,
  onChange,
}: {
  modo: ModoVisualizacao;
  onChange: (m: ModoVisualizacao) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      role="group"
      aria-label={t('visual.titulo')}
      className="flex items-center gap-0.5 rounded-lg border border-borda p-0.5"
    >
      {MODOS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={modo === m}
          onClick={() => onChange(m)}
          title={t(`visual.${m}`)}
          aria-label={t(`visual.${m}`)}
          className={`flex size-7 items-center justify-center rounded transition-colors ${
            modo === m
              ? 'bg-superficie-alta text-acento'
              : 'text-texto-fraco hover:text-texto'
          }`}
        >
          <Icone modo={m} />
        </button>
      ))}
    </div>
  );
}

/**
 * Ícones desenhados aqui, e não trazidos de biblioteca.
 *
 * São cinco glifos de 14px feitos de retângulos: uma dependência inteira para
 * isso custaria mais em peso do que as vinte linhas abaixo.
 */
function Icone({ modo }: { modo: ModoVisualizacao }) {
  const comum = { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true } as const;

  if (modo === 'lista') {
    return (
      <svg {...comum} fill="currentColor">
        <rect x="1" y="3" width="14" height="2" rx="1" />
        <rect x="1" y="7" width="14" height="2" rx="1" />
        <rect x="1" y="11" width="14" height="2" rx="1" />
      </svg>
    );
  }

  if (modo === 'pequena') {
    return (
      <svg {...comum} fill="currentColor">
        {[1, 6, 11].map((x) =>
          [1, 6, 11].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="3.5" height="3.5" rx="1" />),
        )}
      </svg>
    );
  }

  if (modo === 'media') {
    return (
      <svg {...comum} fill="currentColor">
        {[1, 9].map((x) =>
          [1, 9].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="6" height="6" rx="1.5" />),
        )}
      </svg>
    );
  }

  if (modo === 'detalhes') {
    return (
      <svg {...comum} fill="currentColor">
        <rect x="1" y="3" width="4" height="2" rx="1" />
        <rect x="7" y="3" width="8" height="2" rx="1" />
        <rect x="1" y="7" width="4" height="2" rx="1" />
        <rect x="7" y="7" width="8" height="2" rx="1" />
        <rect x="1" y="11" width="4" height="2" rx="1" />
        <rect x="7" y="11" width="8" height="2" rx="1" />
      </svg>
    );
  }

  // conteúdo: capa grande à esquerda, texto à direita
  return (
    <svg {...comum} fill="currentColor">
      <rect x="1" y="2" width="6" height="12" rx="1.5" />
      <rect x="9" y="3" width="6" height="2" rx="1" />
      <rect x="9" y="7" width="6" height="1.5" rx="0.75" />
      <rect x="9" y="10" width="4" height="1.5" rx="0.75" />
    </svg>
  );
}
