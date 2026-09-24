'use client';

import { useEffect, useId, useState } from 'react';
import { CREDIT_COSTS, maxDurationFor, type PlanCode } from '@sonora/shared';
import { ApiError, api, type Workspace } from '@/lib/api';
import { formatarContagem, formatarDuracao, useI18n } from '@/lib/i18n';
import { useAoConcluirGeracao, useProgresso } from '@/lib/progresso';
import { useSessao } from '@/lib/sessao';
import { AdicionarAudio, type Referencia } from './adicionar-audio';
import { AdicionarInspiracao, type Inspiracao } from './adicionar-inspiracao';
import { BotaoIcone, CampoComIcone, CartaoSecao, Interruptor, LinhaOpcao, SeletorChip } from './controles';
import { CartaoEstilos } from './estilos';
import {
  BrilhoIcone,
  CarregandoIcone,
  EmbaralharIcone,
  FecharIcone,
  LixeiraIcone,
  MaisIcone,
  NotaIcone,
  PastaIcone,
} from './icones';
import { CartaoLetra } from './letra';
import { MaisOpcoes, OPCOES_PADRAO, type OpcoesAvancadas } from './mais-opcoes';

type Aba = 'simples' | 'avancado' | 'sons';

interface Resultado {
  songId: string;
  generationId: string;
  creditsCharged: number;
  /** Todas as faixas do pedido, a principal primeiro. Música nova traz duas. */
  variants?: { songId: string; generationId: string }[];
}

/**
 * Painel de criação, no desenho da referência: cabeçalho com saldo e as três
 * abas, os botões de referência ("+ Áudio", "+ Inspiração"), os cartões de
 * letra, estilos e mais opções, título e workspace, e o rodapé com a lixeira
 * e o Criar.
 *
 * A referência de áudio vive na página, não aqui: a biblioteca ao lado
 * também a define ("Usar como referência" no menu de uma faixa), e os dois
 * lados precisam ver o mesmo valor.
 */
export function PainelCriar({
  aoEnfileirar,
  chavePrompt,
  referencia,
  aoMudarReferencia,
}: {
  aoEnfileirar?: (r: Resultado) => void;
  /** Descrição vinda da home, para a página abrir já preenchida. */
  chavePrompt?: string;
  referencia: Referencia | null;
  aoMudarReferencia: (ref: Referencia | null) => void;
}) {
  const { t, locale } = useI18n();
  const { usuario, saldo, recarregarSaldo } = useSessao();
  const { acompanhar } = useProgresso();

  const [aba, setAba] = useState<Aba>('simples');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');

  const [descricao, setDescricao] = useState(chavePrompt ?? '');
  const [instrumental, setInstrumental] = useState(false);
  const [letra, setLetra] = useState('');
  const [titulo, setTitulo] = useState('');
  const [estilos, setEstilos] = useState('');
  const [opcoes, setOpcoes] = useState<OpcoesAvancadas>(OPCOES_PADRAO);
  const [tipoSom, setTipoSom] = useState<'one-shot' | 'loop'>('one-shot');

  const [inspiracao, setInspiracao] = useState<Inspiracao | null>(null);
  const [modal, setModal] = useState<'audio' | 'inspiracao' | null>(null);

  const [escrevendoLetra, setEscrevendoLetra] = useState(false);
  const [aprimorando, setAprimorando] = useState(false);
  const [sorteando, setSorteando] = useState(false);

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

  // A referência recém-enviada (upload ou gravação) fica "processando" até o
  // worker converter o áudio. O SSE avisa; sem isto o Criar ficaria travado
  // até a pessoa recarregar a página.
  useAoConcluirGeracao((evento) => {
    if (!referencia || evento.songId !== referencia.id) return;
    if (evento.status === 'complete') {
      aoMudarReferencia({
        ...referencia,
        status: 'complete',
        durationMs: evento.song?.durationMs ?? referencia.durationMs,
        coverUrl: evento.song?.coverUrl ?? referencia.coverUrl,
      });
    } else {
      aoMudarReferencia(null);
      setErro(evento.error ?? t('geral.erro'));
    }
  });

  const planCode = (saldo?.planCode ?? 'free') as PlanCode;
  const custo = aba === 'sons' ? CREDIT_COSTS.clip : referencia ? CREDIT_COSTS.remix : CREDIT_COSTS.song;
  const semSaldo = saldo ? saldo.balance.total < custo : false;
  const referenciaPronta = !referencia || referencia.status === 'complete';

  async function sortearEstilo() {
    setSorteando(true);
    try {
      const { styles } = await api.post<{ styles: string }>('/styles/suggest', {
        seed: (aba === 'simples' ? descricao : estilos) || undefined,
      });
      if (aba === 'avancado') setEstilos(styles);
      else setDescricao(styles);
    } catch {
      setErro(t('geral.erro'));
    } finally {
      setSorteando(false);
    }
  }

  async function aprimorarEstilo() {
    const alvo = aba === 'avancado' ? estilos : descricao;
    if (alvo.trim().length < 2) return;
    setAprimorando(true);
    setErro(null);
    try {
      const { styles } = await api.post<{ styles: string }>('/styles/enhance', {
        styles: alvo.trim(),
        language: locale === 'pt' ? 'pt-BR' : 'en',
      });
      if (aba === 'avancado') setEstilos(styles);
      else setDescricao(styles);
    } catch (err) {
      setErro(mensagemDe(err, t));
    } finally {
      setAprimorando(false);
    }
  }

  async function escreverLetra(tema: string) {
    setEscrevendoLetra(true);
    setErro(null);
    try {
      const r = await api.post<{ title: string; lyrics: string }>('/lyrics/generate', {
        brief: tema,
        language: locale === 'pt' ? 'pt-BR' : 'en',
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
      const referencias = {
        ...(referencia ? { sourceSongId: referencia.id } : {}),
        ...(inspiracao ? { inspirationPlaylistId: inspiracao.id } : {}),
      };
      const corpo =
        aba === 'simples'
          ? {
              mode: 'simple',
              prompt: descricao,
              instrumental,
              workspaceId: workspaceId || undefined,
              ...referencias,
            }
          : aba === 'sons'
            ? {
                mode: 'sounds',
                prompt: descricao,
                soundType: tipoSom,
                ...(opcoes.bpm ? { bpm: Number(opcoes.bpm) } : {}),
                key: opcoes.tom,
                workspaceId: workspaceId || undefined,
              }
            : {
                mode: 'advanced',
                lyrics: instrumental ? undefined : letra || undefined,
                title: titulo || undefined,
                instrumental,
                workspaceId: workspaceId || undefined,
                ...referencias,
                controls: {
                  styles: estilos || undefined,
                  excludeStyles: opcoes.excluir || undefined,
                  vocalGender: opcoes.voz,
                  ...(opcoes.duracaoAuto ? {} : { durationSeconds: opcoes.duracao }),
                  maxMode: opcoes.maxMode,
                  weirdness: opcoes.estranheza,
                  styleInfluence: opcoes.aderencia,
                  variety: opcoes.variedade,
                  personalize: opcoes.personalizar,
                  ...(opcoes.bpm ? { bpm: Number(opcoes.bpm) } : {}),
                  key: opcoes.tom,
                },
              };

      const resultado = await api.post<Resultado>('/songs/generate', corpo);
      // Cada faixa tem a sua geração, e o progresso chega por ela.
      const faixas = resultado.variants ?? [
        { songId: resultado.songId, generationId: resultado.generationId },
      ];
      for (const faixa of faixas) acompanhar(faixa.generationId, faixa.songId);
      await recarregarSaldo();
      aoEnfileirar?.(resultado);
    } catch (err) {
      setErro(mensagemDe(err, t));
    } finally {
      setEnviando(false);
    }
  }

  function limparTudo() {
    setDescricao('');
    setLetra('');
    setTitulo('');
    setEstilos('');
    setOpcoes(OPCOES_PADRAO);
    setInstrumental(false);
    setInspiracao(null);
    aoMudarReferencia(null);
    setErro(null);
  }

  const temConteudo =
    aba === 'avancado' ? Boolean(estilos.trim() || letra.trim()) : descricao.trim().length >= 3;
  const podeCriar = !enviando && Boolean(usuario) && temConteudo && referenciaPronta;
  const temAlgo = Boolean(descricao || letra || titulo || estilos || referencia || inspiracao);

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho: saldo à esquerda, as três abas no meio. */}
      <div className="flex h-[70px] shrink-0 items-center gap-3 border-b border-borda px-4">
        <span
          className="flex items-center gap-1.5 rounded-full border border-borda px-3.5 py-2 text-sm font-semibold"
          title={`${saldo?.balance.total.toLocaleString(locale === 'pt' ? 'pt-BR' : 'en-US') ?? 0} ${t('criar.custo')}`}
        >
          <NotaIcone tamanho={15} className={semSaldo ? 'text-perigo' : 'text-acento'} />
          {saldo ? formatarContagem(saldo.balance.total, locale) : '—'}
        </span>

        <div className="flex rounded-full border border-borda p-1" role="tablist">
          {(['simples', 'avancado', 'sons'] as const).map((opcao) => (
            <button
              key={opcao}
              type="button"
              role="tab"
              aria-selected={aba === opcao}
              onClick={() => setAba(opcao)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                aba === opcao ? 'bg-superficie-alta text-texto' : 'text-texto-suave hover:text-texto'
              }`}
            >
              {t(`criar.${opcao}`)}
            </button>
          ))}
        </div>
      </div>

      {/* `relative` é obrigatório na área que rola: os rótulos `sr-only` lá
          dentro são `position: absolute`, e sem um ancestral posicionado o
          bloco contenedor deles é a janela inteira. Eles escapavam do recorte
          do overflow e esticavam a rolagem da página até o último rótulo. */}
      <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {aba !== 'sons' && (
          <div className="flex rounded-2xl bg-superficie p-1.5">
            <BotaoReferencia
              rotulo={t('criar.audio')}
              chip={
                referencia
                  ? {
                      titulo: referencia.title,
                      detalhe:
                        referencia.status === 'complete'
                          ? referencia.durationMs > 0
                            ? formatarDuracao(referencia.durationMs)
                            : t('criar.referenciaAudio')
                          : t('criar.referenciaProcessando'),
                      capaUrl: referencia.coverUrl,
                      processando: referencia.status !== 'complete',
                      dica: t('criar.referenciaDica'),
                    }
                  : null
              }
              onClick={() => setModal('audio')}
              aoRemover={() => aoMudarReferencia(null)}
            />
            <span className="my-2 w-px bg-borda" aria-hidden />
            <BotaoReferencia
              rotulo={t('criar.inspiracao')}
              chip={
                inspiracao
                  ? {
                      titulo: inspiracao.name,
                      detalhe: `${inspiracao.songCount} ${t(inspiracao.songCount === 1 ? 'playlists.musica' : 'playlists.musicas')}`,
                      capaUrl: null,
                      dica: t('criar.inspiracaoDica'),
                    }
                  : null
              }
              onClick={() => setModal('inspiracao')}
              aoRemover={() => setInspiracao(null)}
            />
          </div>
        )}

        {aba !== 'avancado' && (
          <CartaoDescricao
            valor={descricao}
            onChange={setDescricao}
            placeholder={aba === 'sons' ? t('criar.estilosPlaceholder') : t('home.placeholder')}
            instrumental={aba === 'simples' ? instrumental : undefined}
            aoMudarInstrumental={setInstrumental}
            aoAprimorar={() => void aprimorarEstilo()}
            aprimorando={aprimorando}
            aoSortear={() => void sortearEstilo()}
            sorteando={sorteando}
          />
        )}

        {aba === 'avancado' && (
          <>
            <CartaoLetra
              letra={letra}
              onChange={setLetra}
              instrumental={instrumental}
              aoMudarInstrumental={setInstrumental}
              escrevendo={escrevendoLetra}
              aoGerar={(tema) => void escreverLetra(tema)}
            />

            <CartaoEstilos
              titulo={t('criar.estilos')}
              estilos={estilos}
              excluir={opcoes.excluir}
              onChange={setEstilos}
              placeholder={t('criar.estilosPlaceholder')}
              aoAplicarPreset={(novo, exclusao) => {
                setEstilos(novo);
                setOpcoes((o) => ({ ...o, excluir: exclusao }));
              }}
              aoAprimorar={() => void aprimorarEstilo()}
              aprimorando={aprimorando}
              aoSortear={() => void sortearEstilo()}
              sorteando={sorteando}
            />

            <MaisOpcoes
              valores={opcoes}
              onChange={(patch) => setOpcoes((o) => ({ ...o, ...patch }))}
              maxDuracao={maxDurationFor(planCode, 'acestep')}
              podeMaxMode={planCode === 'premier'}
              instrumental={instrumental}
            />

            <CampoComIcone
              icone={<NotaIcone tamanho={16} />}
              valor={titulo}
              onChange={setTitulo}
              placeholder={t('criar.tituloOpcional')}
              rotulo={t('criar.tituloMusica')}
              maxLength={120}
            />
          </>
        )}

        {aba === 'sons' && (
          <div className="grid grid-cols-2 gap-2">
            <LinhaOpcao
              rotulo={t('criar.tipoSom')}
              direita={
                <select
                  value={tipoSom}
                  onChange={(e) => setTipoSom(e.target.value as typeof tipoSom)}
                  aria-label={t('criar.tipoSom')}
                  className="cursor-pointer rounded-lg bg-superficie px-2 py-1 text-sm outline-none"
                >
                  <option value="one-shot" className="bg-superficie">{t('criar.oneShot')}</option>
                  <option value="loop" className="bg-superficie">{t('criar.loop')}</option>
                </select>
              }
            />
            <LinhaOpcao
              rotulo="BPM"
              direita={
                <input
                  type="number"
                  min={40}
                  max={220}
                  value={opcoes.bpm}
                  onChange={(e) =>
                    setOpcoes((o) => ({ ...o, bpm: e.target.value === '' ? '' : Number(e.target.value) }))
                  }
                  placeholder={t('criar.auto')}
                  aria-label={t('criar.bpm')}
                  className="w-16 rounded-lg bg-superficie px-2 py-1 text-right text-sm tabular-nums outline-none placeholder:text-texto-fraco"
                />
              }
            />
          </div>
        )}

        {workspaces.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-superficie px-4 py-2.5">
            <span className="flex items-center gap-3 text-sm font-medium">
              <PastaIcone tamanho={16} className="text-texto-suave" />
              {t('criar.salvarEmDots')}
            </span>
            <SeletorChip
              rotulo={t('criar.salvarEm')}
              valor={workspaceId}
              onChange={setWorkspaceId}
              opcoes={workspaces.map((w) => ({ valor: w.id, rotulo: w.name }))}
            />
          </div>
        )}

        {erro && (
          <p role="alert" className="rounded-xl border border-perigo/40 bg-perigo/10 px-3 py-2 text-sm text-perigo">
            {erro}
          </p>
        )}

        {semSaldo && (
          <p className="text-center text-xs text-texto-suave">
            {t('creditos.saldo')}: {saldo?.balance.total ?? 0} · {t('creditos.comprar')}{' '}
            <a href="/creditos" className="text-acento underline">
              {t('creditos.pacotes')}
            </a>
          </p>
        )}
      </div>

      {/* Fora da área que rola: o botão principal não pode sumir quando a
          pessoa desce até o fim das opções. */}
      <div className="flex shrink-0 items-center gap-3 border-t border-borda px-4 py-3">
        <button
          type="button"
          onClick={limparTudo}
          disabled={!temAlgo}
          aria-label={t('criar.limparTudo')}
          title={t('criar.limparTudo')}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-borda text-texto-suave transition-colors hover:border-perigo/50 hover:text-perigo disabled:cursor-not-allowed disabled:opacity-35"
        >
          <LixeiraIcone tamanho={17} />
        </button>
        <button
          type="button"
          onClick={() => void criar()}
          disabled={!podeCriar}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl gradiente-acento text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? <CarregandoIcone tamanho={16} /> : <BrilhoIcone tamanho={16} />}
          {enviando ? t('criar.criando') : t('criar.botao')}
          <span className="rounded-full bg-black/25 px-2 py-0.5 text-xs">
            {custo} {t('criar.custo')}
          </span>
        </button>
      </div>

      {modal === 'audio' && (
        <AdicionarAudio
          aoFechar={() => setModal(null)}
          aoEscolher={(ref) => {
            aoMudarReferencia(ref);
            setErro(null);
          }}
          workspaceId={workspaceId || undefined}
        />
      )}
      {modal === 'inspiracao' && (
        <AdicionarInspiracao aoFechar={() => setModal(null)} aoEscolher={setInspiracao} />
      )}
    </div>
  );
}

/** Descrição livre (abas Simples e Sons), com aprimorar por IA e sortear. */
function CartaoDescricao({
  valor,
  onChange,
  placeholder,
  instrumental,
  aoMudarInstrumental,
  aoAprimorar,
  aprimorando,
  aoSortear,
  sorteando,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
  instrumental?: boolean;
  aoMudarInstrumental: (v: boolean) => void;
  aoAprimorar: () => void;
  aprimorando: boolean;
  aoSortear: () => void;
  sorteando: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <CartaoSecao titulo={t('criar.descricaoTitulo')} resumo={valor || undefined} aberta>
      <label htmlFor={id} className="sr-only">
        {t('criar.descricao')}
      </label>
      <textarea
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        maxLength={2000}
        className="min-h-[140px] w-full resize-none bg-transparent px-1.5 text-sm leading-relaxed text-texto outline-none placeholder:text-texto-fraco"
      />
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={aoAprimorar}
          disabled={aprimorando || valor.trim().length < 2}
          aria-label={t('criar.aprimorar')}
          title={t('criar.aprimorar')}
          className="flex size-9 shrink-0 items-center justify-center rounded-full gradiente-acento text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {aprimorando ? <CarregandoIcone tamanho={16} /> : <BrilhoIcone tamanho={16} />}
        </button>
        <BotaoIcone
          rotulo={t('criar.sortear')}
          onClick={aoSortear}
          desabilitado={sorteando}
          className="size-9 rounded-full bg-superficie-alta"
        >
          {sorteando ? <CarregandoIcone tamanho={15} /> : <EmbaralharIcone tamanho={15} />}
        </BotaoIcone>
        {instrumental !== undefined && (
          <div className="ml-auto">
            <Interruptor rotulo={t('criar.instrumental')} ligado={instrumental} onChange={aoMudarInstrumental} />
          </div>
        )}
      </div>
    </CartaoSecao>
  );
}

/**
 * "+ Áudio" / "+ Inspiração". Sem escolha, é o botão com o sinal de mais;
 * com escolha, vira o chip do que foi escolhido, com o X para tirar.
 */
function BotaoReferencia({
  rotulo,
  chip,
  onClick,
  aoRemover,
}: {
  rotulo: string;
  chip: {
    titulo: string;
    detalhe: string;
    capaUrl: string | null;
    processando?: boolean;
    dica: string;
  } | null;
  onClick: () => void;
  aoRemover: () => void;
}) {
  const { t } = useI18n();

  if (!chip) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-colors hover:bg-superficie-alta"
      >
        <MaisIcone tamanho={15} />
        {rotulo}
      </button>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5" title={chip.dica}>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        {chip.capaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada do R2, expira
          <img src={chip.capaUrl} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg gradiente-acento text-white">
            {chip.processando ? <CarregandoIcone tamanho={14} /> : <NotaIcone tamanho={14} />}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold">{chip.titulo}</span>
          <span className="block truncate text-[11px] text-texto-fraco">{chip.detalhe}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={aoRemover}
        aria-label={`${t('criar.remover')} ${rotulo}`}
        title={t('criar.remover')}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-texto-fraco transition-colors hover:bg-superficie-alta hover:text-texto"
      >
        <FecharIcone tamanho={13} />
      </button>
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
