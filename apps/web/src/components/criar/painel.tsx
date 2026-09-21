'use client';

import { useEffect, useState } from 'react';
import { ApiError, api, type Workspace } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useProgresso } from '@/lib/progresso';
import { useSessao } from '@/lib/sessao';
import { Campo, Deslizante, Secao, Seletor, Interruptor } from './controles';

type Aba = 'simples' | 'avancado' | 'sons';

/** Custo em créditos, espelhando CREDIT_COSTS do backend. */
const CUSTO: Record<Aba, number> = { simples: 10, avancado: 10, sons: 5 };

const TONS = [
  'any', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bm',
];

interface Resultado {
  songId: string;
  generationId: string;
  creditsCharged: number;
}

/**
 * Painel de criação — as três abas do Suno, melhoradas em dois pontos:
 *
 *  - A duração começa em "automática" e diz por quê. No Suno o campo já vem com
 *    um número, e forçar duração estica ou comprime a estrutura da música.
 *  - O custo em créditos fica visível no botão, antes de clicar, em vez de o
 *    usuário descobrir o débito depois.
 */
export function PainelCriar({
  aoEnfileirar,
  chavePrompt,
}: {
  aoEnfileirar?: (r: Resultado) => void;
  /** Descrição vinda da home, para a página abrir já preenchida. */
  chavePrompt?: string;
}) {
  const { t } = useI18n();
  const { usuario, saldo, recarregarSaldo } = useSessao();
  const { acompanhar } = useProgresso();

  const [aba, setAba] = useState<Aba>('simples');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Simples
  const [descricao, setDescricao] = useState(chavePrompt ?? '');
  const [instrumental, setInstrumental] = useState(false);

  // Avançado
  const [letra, setLetra] = useState('');
  const [titulo, setTitulo] = useState('');
  const [estilos, setEstilos] = useState('');
  const [excluir, setExcluir] = useState('');
  const [voz, setVoz] = useState<'any' | 'male' | 'female'>('any');
  const [duracaoAuto, setDuracaoAuto] = useState(true);
  const [duracao, setDuracao] = useState(120);
  const [bpm, setBpm] = useState<number | ''>('');
  const [tom, setTom] = useState('any');
  const [estranheza, setEstranheza] = useState(50);
  const [aderencia, setAderencia] = useState(50);
  const [maxMode, setMaxMode] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');

  // Sons
  const [tipoSom, setTipoSom] = useState<'one-shot' | 'loop'>('one-shot');

  const [escrevendoLetra, setEscrevendoLetra] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    void api
      .get<Workspace[]>('/workspaces')
      .then((lista) => {
        setWorkspaces(lista);
        setWorkspaceId(lista.find((w) => w.isDefault)?.id ?? '');
      })
      .catch(() => setWorkspaces([]));
  }, [usuario]);

  const custo = CUSTO[aba];
  const semSaldo = saldo ? saldo.balance.total < custo : false;

  async function sortearEstilo() {
    try {
      const { styles } = await api.post<{ styles: string }>('/styles/suggest', {
        seed: estilos || descricao || undefined,
      });
      if (aba === 'simples') setDescricao(styles);
      else setEstilos(styles);
    } catch {
      setErro(t('geral.erro'));
    }
  }

  async function escreverLetra() {
    const tema = letra.trim() || descricao.trim() || estilos.trim();
    if (!tema) {
      setErro(
        t('criar.letra') + ': ' + (t('criar.descricao') === 'Descrição'
          ? 'escreva um tema primeiro.'
          : 'write a brief first.'),
      );
      return;
    }
    setEscrevendoLetra(true);
    setErro(null);
    try {
      const r = await api.post<{ title: string; lyrics: string }>('/lyrics/generate', {
        brief: tema,
        language: 'pt-BR',
        styles: estilos || undefined,
      });
      setLetra(r.lyrics);
      if (!titulo) setTitulo(r.title);
      await recarregarSaldo();
    } catch (err) {
      setErro(mensagemDe(err, t));
    } finally {
      setEscrevendoLetra(false);
    }
  }

  async function criar() {
    setEnviando(true);
    setErro(null);
    try {
      const corpo =
        aba === 'simples'
          ? { mode: 'simple', prompt: descricao, instrumental, workspaceId: workspaceId || undefined }
          : aba === 'sons'
            ? {
                mode: 'sounds',
                prompt: descricao,
                soundType: tipoSom,
                ...(bpm ? { bpm: Number(bpm) } : {}),
                key: tom,
                workspaceId: workspaceId || undefined,
              }
            : {
                mode: 'advanced',
                lyrics: instrumental ? undefined : letra || undefined,
                title: titulo || undefined,
                instrumental,
                workspaceId: workspaceId || undefined,
                controls: {
                  styles: estilos || undefined,
                  excludeStyles: excluir || undefined,
                  vocalGender: voz,
                  ...(duracaoAuto ? {} : { durationSeconds: duracao }),
                  maxMode,
                  weirdness: estranheza,
                  styleInfluence: aderencia,
                  ...(bpm ? { bpm: Number(bpm) } : {}),
                  key: tom,
                },
              };

      const resultado = await api.post<Resultado>('/songs/generate', corpo);
      acompanhar(resultado.generationId, resultado.songId);
      await recarregarSaldo();
      aoEnfileirar?.(resultado);
    } catch (err) {
      setErro(mensagemDe(err, t));
    } finally {
      setEnviando(false);
    }
  }

  const podeCriar =
    !enviando &&
    Boolean(usuario) &&
    (aba === 'avancado'
      ? Boolean(estilos.trim() || letra.trim())
      : descricao.trim().length >= 3);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Abas */}
      <div className="flex rounded-xl border border-borda bg-superficie p-1" role="tablist">
        {(['simples', 'avancado', 'sons'] as const).map((opcao) => (
          <button
            key={opcao}
            type="button"
            role="tab"
            aria-selected={aba === opcao}
            onClick={() => setAba(opcao)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              aba === opcao ? 'bg-superficie-alta text-texto' : 'text-texto-suave hover:text-texto'
            }`}
          >
            {t(`criar.${opcao === 'avancado' ? 'avancado' : opcao}`)}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {aba !== 'avancado' && (
          <Campo
            rotulo={t('criar.descricao')}
            valor={descricao}
            onChange={setDescricao}
            placeholder={aba === 'sons' ? t('criar.estilosPlaceholder') : t('home.placeholder')}
            multilinha
            linhas={4}
            acao={{ rotulo: t('criar.sortear'), onClick: () => void sortearEstilo() }}
          />
        )}

        {aba === 'avancado' && (
          <>
            <Secao titulo={t('criar.letra')} aberta>
              <Campo
                valor={letra}
                onChange={setLetra}
                placeholder={t('criar.letraPlaceholder')}
                multilinha
                linhas={8}
                desabilitado={instrumental}
                acao={{
                  rotulo: escrevendoLetra ? t('geral.carregando') : t('criar.escreverComIA'),
                  onClick: () => void escreverLetra(),
                  desabilitado: escrevendoLetra || instrumental,
                }}
              />
              <Campo
                rotulo={`${t('criar.botao')} — ${t('geral.opcional')}`}
                valor={titulo}
                onChange={setTitulo}
                placeholder="Estrada até o mar"
              />
            </Secao>

            <Secao titulo={t('criar.estilos')} resumo={estilos} aberta>
              <Campo
                valor={estilos}
                onChange={setEstilos}
                placeholder={t('criar.estilosPlaceholder')}
                multilinha
                linhas={3}
                acao={{ rotulo: t('criar.sortear'), onClick: () => void sortearEstilo() }}
              />
              <Campo
                rotulo={t('criar.excluir')}
                valor={excluir}
                onChange={setExcluir}
                placeholder={t('criar.excluirPlaceholder')}
              />
            </Secao>

            <Secao titulo={t('criar.maisOpcoes')}>
              <Seletor
                rotulo={t('criar.voz')}
                valor={voz}
                onChange={(v) => setVoz(v as typeof voz)}
                opcoes={[
                  { valor: 'any', rotulo: t('criar.vozQualquer') },
                  { valor: 'male', rotulo: t('criar.vozMasculina') },
                  { valor: 'female', rotulo: t('criar.vozFeminina') },
                ]}
                desabilitado={instrumental}
              />

              <div>
                <Interruptor
                  rotulo={t('criar.duracaoAuto')}
                  ligado={duracaoAuto}
                  onChange={setDuracaoAuto}
                />
                <p className="mt-1 text-xs text-texto-fraco">{t('criar.duracaoDica')}</p>
                {!duracaoAuto && (
                  <Deslizante
                    rotulo={t('criar.duracao')}
                    valor={duracao}
                    min={10}
                    max={maxMode ? 480 : 240}
                    passo={5}
                    onChange={setDuracao}
                    sufixo="s"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Campo
                  rotulo={t('criar.bpm')}
                  valor={String(bpm)}
                  onChange={(v) => setBpm(v === '' ? '' : Number(v))}
                  placeholder="auto"
                  tipo="number"
                />
                <Seletor
                  rotulo={t('criar.tom')}
                  valor={tom}
                  onChange={setTom}
                  opcoes={TONS.map((k) => ({
                    valor: k,
                    rotulo: k === 'any' ? t('criar.vozQualquer') : k,
                  }))}
                />
              </div>

              <Deslizante
                rotulo={t('criar.estranheza')}
                valor={estranheza}
                min={0}
                max={100}
                onChange={setEstranheza}
                sufixo="%"
              />
              <Deslizante
                rotulo={t('criar.aderencia')}
                valor={aderencia}
                min={0}
                max={100}
                onChange={setAderencia}
                sufixo="%"
              />
              <Interruptor
                rotulo={t('criar.maxMode')}
                ligado={maxMode}
                onChange={setMaxMode}
                aviso={saldo?.planCode !== 'premier' ? t('musica.somenteePagos') : undefined}
              />
            </Secao>
          </>
        )}

        {aba === 'sons' && (
          <div className="grid grid-cols-2 gap-3">
            <Seletor
              rotulo={t('criar.tipoSom')}
              valor={tipoSom}
              onChange={(v) => setTipoSom(v as typeof tipoSom)}
              opcoes={[
                { valor: 'one-shot', rotulo: t('criar.oneShot') },
                { valor: 'loop', rotulo: t('criar.loop') },
              ]}
            />
            <Campo
              rotulo={t('criar.bpm')}
              valor={String(bpm)}
              onChange={(v) => setBpm(v === '' ? '' : Number(v))}
              placeholder="auto"
              tipo="number"
            />
          </div>
        )}

        {aba !== 'sons' && (
          <Interruptor
            rotulo={t('criar.instrumental')}
            ligado={instrumental}
            onChange={setInstrumental}
          />
        )}

        {workspaces.length > 1 && (
          <Seletor
            rotulo={t('criar.salvarEm')}
            valor={workspaceId}
            onChange={setWorkspaceId}
            opcoes={workspaces.map((w) => ({ valor: w.id, rotulo: w.name }))}
          />
        )}
      </div>

      {erro && (
        <p role="alert" className="rounded-lg border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-perigo">
          {erro}
        </p>
      )}

      <button
        type="button"
        onClick={() => void criar()}
        disabled={!podeCriar}
        className="flex items-center justify-center gap-2 rounded-xl gradiente-acento py-3.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {enviando ? t('criar.criando') : t('criar.botao')}
        <span className="rounded-full bg-black/25 px-2 py-0.5 text-xs">
          {custo} {t('criar.custo')}
        </span>
      </button>

      {semSaldo && (
        <p className="text-center text-xs text-texto-suave">
          {t('creditos.saldo')}: {saldo?.balance.total ?? 0} — {t('creditos.comprar')}{' '}
          <a href="/creditos" className="text-acento underline">
            {t('creditos.pacotes')}
          </a>
        </p>
      )}
    </div>
  );
}

/** Erro do backend vira texto útil, com o caminho do campo quando houver. */
function mensagemDe(err: unknown, t: (c: string) => string): string {
  if (err instanceof ApiError) {
    if (err.campos.length > 0) {
      return err.campos.map((c) => `${c.field}: ${c.message}`).join(' · ');
    }
    return err.message;
  }
  return t('geral.erro');
}
