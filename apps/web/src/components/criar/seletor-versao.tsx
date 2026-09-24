'use client';

import { useEffect, useState } from 'react';
import {
  DEFAULT_MUSIC_MODEL,
  isMusicModel,
  MODEL_CREDITS,
  MUSIC_MODEL_SPECS,
  MUSIC_MODELS,
  type MusicModel,
} from '@sonora/shared';
import { useI18n } from '@/lib/i18n';
import { SetaBaixoIcone } from './icones';
import { MenuSuspenso } from './menu-suspenso';

const CHAVE = 'sonora:versao-motor';

/**
 * A versão escolhida, lembrada por navegador.
 *
 * Começa na padrão e lê a preferência depois da montagem: ler o localStorage
 * durante a renderização quebraria a hidratação do Next.
 */
export function useVersaoMotor(): [MusicModel, (versao: MusicModel) => void] {
  const [versao, setVersao] = useState<MusicModel>(DEFAULT_MUSIC_MODEL);

  useEffect(() => {
    try {
      const salva = localStorage.getItem(CHAVE);
      if (isMusicModel(salva)) setVersao(salva);
    } catch {
      // Janela anônima: segue na padrão.
    }
  }, []);

  function escolher(nova: MusicModel) {
    setVersao(nova);
    try {
      localStorage.setItem(CHAVE, nova);
    } catch {
      // A escolha só não sobrevive ao recarregamento.
    }
  }

  return [versao, escolher];
}

/**
 * O seletor de versão do motor, no cabeçalho do painel de criação.
 *
 * Cada opção mostra o que a versão faz e o preço mínimo (até 2 min); o botão
 * Criar mostra o preço exato do pedido, que depende também da duração.
 */
export function SeletorVersao({
  valor,
  onChange,
}: {
  valor: MusicModel;
  onChange: (versao: MusicModel) => void;
}) {
  const { t, locale } = useI18n();
  const idioma = locale === 'pt' ? 'pt' : 'en';

  return (
    <MenuSuspenso
      alinhamento="direita"
      largura="w-72"
      gatilho={(aberto) => (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={aberto}
          aria-label={`${t('criar.versao')}: ${MUSIC_MODEL_SPECS[valor].label[idioma]}`}
          title={t('criar.versao')}
          className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
            aberto ? 'border-acento text-texto' : 'border-borda text-texto-suave hover:text-texto'
          }`}
        >
          {MUSIC_MODEL_SPECS[valor].label[idioma]}
          <SetaBaixoIcone tamanho={14} />
        </button>
      )}
    >
      {(fechar) => (
        <div className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-texto-suave">
            {t('criar.versao')}
          </p>
          {MUSIC_MODELS.map((versao) => {
            const spec = MUSIC_MODEL_SPECS[versao];
            const ativo = versao === valor;
            return (
              <button
                key={versao}
                type="button"
                role="menuitemradio"
                aria-checked={ativo}
                onClick={() => {
                  onChange(versao);
                  fechar();
                }}
                className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-superficie ${
                  ativo ? 'bg-superficie' : ''
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-semibold ${ativo ? 'text-acento' : 'text-texto'}`}>
                    {spec.label[idioma]}
                  </span>
                  <span className="text-xs text-texto-suave">
                    {t('criar.aPartirDe')} {MODEL_CREDITS[versao][0]} {t('criar.custo')}
                  </span>
                </span>
                <span className="text-xs text-texto-suave">{spec.description[idioma]}</span>
              </button>
            );
          })}
        </div>
      )}
    </MenuSuspenso>
  );
}
