'use client';

import { useId } from 'react';
import { MAX_DURATION_SECONDS, MUSICAL_KEYS } from '@sonora/shared';
import { formatarDuracao, useI18n } from '@/lib/i18n';
import {
  CartaoSecao,
  DeslizanteMarcas,
  EscolhaTexto,
  LigaDesliga,
  LinhaOpcao,
} from './controles';
import { ProibidoIcone } from './icones';

export type Variedade = 'low' | 'medium' | 'high';

export interface OpcoesAvancadas {
  excluir: string;
  voz: 'any' | 'male' | 'female';
  duracaoAuto: boolean;
  /** Em segundos; só vale com `duracaoAuto` desligado. */
  duracao: number;
  maxMode: boolean;
  estranheza: number;
  aderencia: number;
  variedade: Variedade;
  personalizar: boolean;
  bpm: number | '';
  tom: string;
}

export const OPCOES_PADRAO: OpcoesAvancadas = {
  excluir: '',
  voz: 'any',
  duracaoAuto: true,
  duracao: 180,
  maxMode: false,
  estranheza: 50,
  aderencia: 50,
  variedade: 'high',
  personalizar: false,
  bpm: '',
  tom: 'any',
};

const VARIEDADES: Variedade[] = ['low', 'medium', 'high'];

/**
 * "Mais opções", linha por linha como na segunda imagem de referência:
 * excluir estilos, voz, duração, Max Mode, estranheza, aderência, variedade e
 * personalizar; andamento e tom vêm no fim, porque o motor os aceita e a
 * interface já os tinha.
 *
 * A duração nasce automática, e o texto ao lado do slider diz "Auto" em vez
 * de um número: forçar duração estica ou comprime a estrutura, e mostrar
 * "3:00" como se fosse o que vai sair seria mentir sobre o padrão.
 */
export function MaisOpcoes({
  valores,
  onChange,
  maxDuracao,
  podeMaxMode,
  instrumental,
}: {
  valores: OpcoesAvancadas;
  onChange: (patch: Partial<OpcoesAvancadas>) => void;
  /** Teto de duração do plano, em segundos. */
  maxDuracao: number;
  podeMaxMode: boolean;
  instrumental: boolean;
}) {
  const { t } = useI18n();
  const idExcluir = useId();
  const idBpm = useId();
  const idTom = useId();

  const rotuloVariedade = (v: Variedade) =>
    t(v === 'low' ? 'criar.variedadeBaixa' : v === 'medium' ? 'criar.variedadeMedia' : 'criar.variedadeAlta');

  const mudou =
    valores.excluir !== '' ||
    valores.voz !== 'any' ||
    !valores.duracaoAuto ||
    valores.maxMode ||
    valores.estranheza !== 50 ||
    valores.aderencia !== 50 ||
    valores.variedade !== 'high' ||
    valores.personalizar ||
    valores.bpm !== '' ||
    valores.tom !== 'any';

  const resumo = [
    `${t('criar.variedade')} ${rotuloVariedade(valores.variedade).toLowerCase()}`,
    valores.duracaoAuto ? null : formatarDuracao(valores.duracao * 1000),
    valores.voz === 'any' ? null : t(valores.voz === 'male' ? 'criar.vozMasculina' : 'criar.vozFeminina'),
    valores.maxMode ? t('criar.maxModeCurto') : null,
    valores.excluir ? `${t('criar.excluir')}: ${valores.excluir}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // Max Mode libera o teto do produto (6 min); fora dele vale o do plano.
  const tetoDuracao = valores.maxMode ? MAX_DURATION_SECONDS : maxDuracao;

  return (
    <CartaoSecao
      titulo={t('criar.maisOpcoes')}
      resumo={resumo}
      aoLimpar={() => onChange({ ...OPCOES_PADRAO })}
      podeLimpar={mudou}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-xl bg-superficie-alta/60 px-3.5 py-3">
          <ProibidoIcone tamanho={16} className="shrink-0 text-texto-suave" />
          <label htmlFor={idExcluir} className="sr-only">
            {t('criar.excluir')}
          </label>
          <input
            id={idExcluir}
            value={valores.excluir}
            onChange={(e) => onChange({ excluir: e.target.value })}
            placeholder={t('criar.excluir')}
            maxLength={1000}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-texto-fraco"
          />
        </div>

        <LinhaOpcao
          rotulo={t('criar.voz')}
          dica={t('criar.vozDica')}
          desabilitada={instrumental}
          direita={
            <EscolhaTexto
              rotulo={t('criar.voz')}
              valor={valores.voz === 'any' ? null : valores.voz}
              opcoes={[
                { valor: 'male', rotulo: t('criar.vozMasculina') },
                { valor: 'female', rotulo: t('criar.vozFeminina') },
              ]}
              onChange={(v) => onChange({ voz: v ?? 'any' })}
              permiteNenhuma
              desabilitado={instrumental}
            />
          }
        />

        <LinhaOpcao
          rotulo={t('criar.duracao')}
          dica={t('criar.duracaoDica')}
          aoRedefinir={valores.duracaoAuto ? undefined : () => onChange({ duracaoAuto: true })}
          direitaLarga
          direita={
            <DeslizanteMarcas
              rotulo={t('criar.duracao')}
              valor={Math.min(valores.duracao, tetoDuracao)}
              min={10}
              max={tetoDuracao}
              passo={5}
              onChange={(v) => onChange({ duracao: v, duracaoAuto: false })}
              formatar={(v) => (valores.duracaoAuto ? t('criar.auto') : formatarDuracao(v * 1000))}
            />
          }
        />

        <LinhaOpcao
          rotulo={t('criar.maxModeCurto')}
          dica={podeMaxMode ? t('criar.maxModeDica') : `${t('criar.maxModeDica')} ${t('musica.somenteePagos')}.`}
          direita={
            <LigaDesliga
              rotulo={t('criar.maxModeCurto')}
              ligado={valores.maxMode}
              onChange={(v) => onChange({ maxMode: v })}
              desabilitado={!podeMaxMode}
              rotulos={{ desligado: t('criar.desligado'), ligado: t('criar.ligado') }}
            />
          }
        />

        <LinhaOpcao
          rotulo={t('criar.estranheza')}
          dica={t('criar.estranhezaDica')}
          direitaLarga
          direita={
            <DeslizanteMarcas
              rotulo={t('criar.estranheza')}
              valor={valores.estranheza}
              min={0}
              max={100}
              passo={5}
              onChange={(v) => onChange({ estranheza: v })}
              formatar={(v) => `${v}%`}
            />
          }
        />

        <LinhaOpcao
          rotulo={t('criar.aderenciaCurto')}
          dica={t('criar.aderenciaDica')}
          direitaLarga
          direita={
            <DeslizanteMarcas
              rotulo={t('criar.aderencia')}
              valor={valores.aderencia}
              min={0}
              max={100}
              passo={5}
              onChange={(v) => onChange({ aderencia: v })}
              formatar={(v) => `${v}%`}
            />
          }
        />

        <LinhaOpcao
          rotulo={t('criar.variedade')}
          dica={t('criar.variedadeDica')}
          aoRedefinir={valores.variedade === 'high' ? undefined : () => onChange({ variedade: 'high' })}
          direitaLarga
          direita={
            <DeslizanteMarcas
              rotulo={t('criar.variedade')}
              valor={VARIEDADES.indexOf(valores.variedade)}
              min={0}
              max={2}
              onChange={(v) => onChange({ variedade: VARIEDADES[v] ?? 'high' })}
              formatar={(v) => rotuloVariedade(VARIEDADES[v] ?? 'high')}
            />
          }
        />

        <LinhaOpcao
          rotulo={t('criar.personalizar')}
          dica={t('criar.personalizarDica')}
          direita={
            <>
              <span className="text-sm text-texto-fraco">{t('criar.meuGosto')}</span>
              <LigaDesliga
                rotulo={t('criar.personalizar')}
                ligado={valores.personalizar}
                onChange={(v) => onChange({ personalizar: v })}
                rotulos={{ desligado: t('criar.desligado'), ligado: t('criar.ligado') }}
              />
            </>
          }
        />

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between gap-2 rounded-xl bg-superficie-alta/60 px-3.5 py-3">
            <label htmlFor={idBpm} className="text-sm font-medium">
              BPM
            </label>
            <input
              id={idBpm}
              type="number"
              min={40}
              max={220}
              value={valores.bpm}
              onChange={(e) => onChange({ bpm: e.target.value === '' ? '' : Number(e.target.value) })}
              placeholder={t('criar.auto')}
              className="w-16 rounded-lg bg-superficie px-2 py-1 text-right text-sm tabular-nums outline-none placeholder:text-texto-fraco"
            />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-superficie-alta/60 px-3.5 py-3">
            <label htmlFor={idTom} className="text-sm font-medium">
              {t('criar.tom')}
            </label>
            <select
              id={idTom}
              value={valores.tom}
              onChange={(e) => onChange({ tom: e.target.value })}
              className="w-20 cursor-pointer rounded-lg bg-superficie px-2 py-1 text-sm outline-none"
            >
              {MUSICAL_KEYS.map((k) => (
                <option key={k} value={k} className="bg-superficie">
                  {k === 'any' ? t('criar.auto') : k}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </CartaoSecao>
  );
}
