'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, enviarUpload, type ItemExplore, type Musica, type Pagina } from '@/lib/api';
import { formatarDuracao, useI18n } from '@/lib/i18n';
import { BuscaIcone, CarregandoIcone, EnviarIcone, MicrofoneIcone } from './icones';
import { Modal } from './modal';

/** O que o painel guarda da faixa escolhida como referência. */
export interface Referencia {
  id: string;
  title: string;
  coverUrl: string | null;
  durationMs: number;
  status: string;
  autor?: string;
}

type Aba = 'biblioteca' | 'publicas' | 'enviar' | 'gravar';

/**
 * "+ Áudio": escolhe a faixa que o motor vai ouvir antes de gerar.
 *
 * Quatro origens, cada uma numa aba: a própria biblioteca, as músicas
 * públicas cujo autor liberou remix, um arquivo do computador e uma gravação
 * do microfone. As duas últimas viram uma faixa nova do tipo `upload` na
 * biblioteca, e a referência fica "processando" até o worker converter o
 * áudio; o painel só libera o Criar quando ela estiver pronta.
 */
export function AdicionarAudio({
  aoFechar,
  aoEscolher,
  workspaceId,
}: {
  aoFechar: () => void;
  aoEscolher: (ref: Referencia) => void;
  workspaceId?: string;
}) {
  const { t } = useI18n();
  const [aba, setAba] = useState<Aba>('biblioteca');

  const abas: { valor: Aba; rotulo: string }[] = [
    { valor: 'biblioteca', rotulo: t('criar.abaBiblioteca') },
    { valor: 'publicas', rotulo: t('criar.abaPublicas') },
    { valor: 'enviar', rotulo: t('criar.abaEnviar') },
    { valor: 'gravar', rotulo: t('criar.abaGravar') },
  ];

  const escolherEFechar = (ref: Referencia) => {
    aoEscolher(ref);
    aoFechar();
  };

  return (
    <Modal titulo={`+ ${t('criar.audio')}`} aoFechar={aoFechar}>
      <div className="flex gap-1 border-b border-borda px-3 pt-2" role="tablist">
        {abas.map((a) => (
          <button
            key={a.valor}
            type="button"
            role="tab"
            aria-selected={aba === a.valor}
            onClick={() => setAba(a.valor)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              aba === a.valor ? 'border-acento text-texto' : 'border-transparent text-texto-suave hover:text-texto'
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>

      <div className="p-4">
        {aba === 'biblioteca' && <Biblioteca aoEscolher={escolherEFechar} />}
        {aba === 'publicas' && <Publicas aoEscolher={escolherEFechar} />}
        {aba === 'enviar' && <Enviar aoEscolher={escolherEFechar} workspaceId={workspaceId} />}
        {aba === 'gravar' && <Gravar aoEscolher={escolherEFechar} workspaceId={workspaceId} />}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Biblioteca

function CampoBusca({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 rounded-full border border-borda bg-fundo px-3.5 py-2">
      <BuscaIcone tamanho={15} className="shrink-0 text-texto-fraco" />
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('criar.buscarMusica')}
        aria-label={t('criar.buscarMusica')}
        autoFocus
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-texto-fraco"
      />
    </div>
  );
}

function useBuscaComAtraso(valor: string, ms = 300): string {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(id);
  }, [valor, ms]);
  return atrasado;
}

function LinhaEscolha({
  musica,
  autor,
  aoEscolher,
  desabilitada,
}: {
  musica: Musica;
  autor?: string;
  aoEscolher: (ref: Referencia) => void;
  desabilitada?: boolean;
}) {
  const { t } = useI18n();
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-superficie-alta">
      <Capa url={musica.coverUrl} titulo={musica.title} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{musica.title}</p>
        <p className="truncate text-xs text-texto-suave">
          {autor ?? musica.stylePrompt ?? ''}
          {musica.durationMs > 0 && ` · ${formatarDuracao(musica.durationMs)}`}
        </p>
      </div>
      <button
        type="button"
        disabled={desabilitada}
        onClick={() =>
          aoEscolher({
            id: musica.id,
            title: musica.title,
            coverUrl: musica.coverUrl,
            durationMs: musica.durationMs,
            status: musica.status,
            autor,
          })
        }
        className="shrink-0 rounded-full border border-borda px-3.5 py-1.5 text-xs font-medium transition-colors hover:border-acento hover:text-acento disabled:opacity-40"
      >
        {t('criar.usar')}
      </button>
    </li>
  );
}

function Capa({ url, titulo }: { url: string | null; titulo: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do R2, expira
    return <img src={url} alt="" className="size-11 shrink-0 rounded-lg object-cover" />;
  }
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg gradiente-acento text-sm font-black text-white/90" aria-hidden>
      {titulo.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Biblioteca({ aoEscolher }: { aoEscolher: (ref: Referencia) => void }) {
  const { t } = useI18n();
  const [busca, setBusca] = useState('');
  const termo = useBuscaComAtraso(busca);
  const [itens, setItens] = useState<Musica[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: '12', page: '1', status: 'ready', sort: 'newest' });
    if (termo.trim()) params.set('q', termo.trim());
    void api
      .get<Pagina<Musica>>(`/songs?${params}`)
      .then((p) => setItens(p.items))
      .catch(() => setItens([]));
  }, [termo]);

  return (
    <div className="space-y-3">
      <CampoBusca valor={busca} onChange={setBusca} />
      <Lista itens={itens} vazio={t('criar.nenhumaEncontrada')}>
        {(m) => <LinhaEscolha key={m.id} musica={m} aoEscolher={aoEscolher} />}
      </Lista>
    </div>
  );
}

function Publicas({ aoEscolher }: { aoEscolher: (ref: Referencia) => void }) {
  const { t } = useI18n();
  const [busca, setBusca] = useState('');
  const termo = useBuscaComAtraso(busca);
  const [itens, setItens] = useState<ItemExplore[] | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ tab: 'new', limit: '20' });
    if (termo.trim()) params.set('q', termo.trim());
    void api
      .get<ItemExplore[]>(`/explore?${params}`)
      .then(setItens)
      .catch(() => setItens([]));
  }, [termo]);

  return (
    <div className="space-y-3">
      <CampoBusca valor={busca} onChange={setBusca} />
      <Lista itens={itens} vazio={t('criar.nenhumaEncontrada')}>
        {(m) => (
          <LinhaEscolha
            key={m.id}
            musica={m}
            autor={m.author.displayName}
            aoEscolher={aoEscolher}
            // Só o que o autor liberou como base: é a mesma regra do Remix.
            desabilitada={!m.allowRemixes}
          />
        )}
      </Lista>
    </div>
  );
}

function Lista<T extends { id: string }>({
  itens,
  vazio,
  children,
}: {
  itens: T[] | null;
  vazio: string;
  children: (item: T) => React.ReactNode;
}) {
  const { t } = useI18n();
  if (itens === null) {
    return <p className="py-8 text-center text-sm text-texto-fraco pulsando">{t('geral.carregando')}</p>;
  }
  if (itens.length === 0) {
    return <p className="py-8 text-center text-sm text-texto-suave">{vazio}</p>;
  }
  return <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">{itens.map(children)}</ul>;
}

// ------------------------------------------------------------- Enviar

function useEnvio(workspaceId: string | undefined, aoEscolher: (ref: Referencia) => void) {
  const { t } = useI18n();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = useCallback(
    async (arquivo: Blob, nome: string) => {
      setEnviando(true);
      setErro(null);
      try {
        const musica = await enviarUpload(arquivo, nome, workspaceId);
        aoEscolher({
          id: musica.id,
          title: musica.title,
          coverUrl: musica.coverUrl,
          durationMs: musica.durationMs,
          status: musica.status,
        });
      } catch (err) {
        setErro(err instanceof ApiError ? err.message : t('geral.erro'));
      } finally {
        setEnviando(false);
      }
    },
    [workspaceId, aoEscolher, t],
  );

  return { enviar, enviando, erro };
}

function Enviar({
  aoEscolher,
  workspaceId,
}: {
  aoEscolher: (ref: Referencia) => void;
  workspaceId?: string;
}) {
  const { t } = useI18n();
  const { enviar, enviando, erro } = useEnvio(workspaceId, aoEscolher);
  const entrada = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

  function receber(lista: FileList | null) {
    const arquivo = lista?.[0];
    if (arquivo) void enviar(arquivo, arquivo.name);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => entrada.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          receber(e.dataTransfer.files);
        }}
        disabled={enviando}
        className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          arrastando ? 'border-acento bg-acento-suave' : 'border-borda hover:border-texto-fraco'
        } disabled:opacity-60`}
      >
        {enviando ? <CarregandoIcone tamanho={28} className="text-acento" /> : <EnviarIcone tamanho={28} className="text-texto-suave" />}
        <span className="text-sm font-medium">
          {enviando ? t('criar.enviandoArquivo') : t('criar.soltarArquivo')}
        </span>
        <span className="text-xs text-texto-fraco">{t('criar.formatosAceitos')}</span>
      </button>
      <input
        ref={entrada}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac"
        className="sr-only"
        aria-label={t('criar.abaEnviar')}
        onChange={(e) => receber(e.target.files)}
      />
      {erro && (
        <p role="alert" className="text-sm text-perigo">
          {erro}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Gravar

function Gravar({
  aoEscolher,
  workspaceId,
}: {
  aoEscolher: (ref: Referencia) => void;
  workspaceId?: string;
}) {
  const { t } = useI18n();
  const { enviar, enviando, erro: erroEnvio } = useEnvio(workspaceId, aoEscolher);
  const [estado, setEstado] = useState<'parado' | 'gravando' | 'pronto'>('parado');
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [gravacao, setGravacao] = useState<{ blob: Blob; url: string } | null>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const relogio = useRef<ReturnType<typeof setInterval> | null>(null);

  const pararTudo = useCallback(() => {
    if (relogio.current) clearInterval(relogio.current);
    relogio.current = null;
    gravador.current?.stream.getTracks().forEach((faixa) => faixa.stop());
  }, []);

  useEffect(() => {
    return () => {
      pararTudo();
      if (gravacao) URL.revokeObjectURL(gravacao.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na desmontagem
  }, []);

  async function comecar() {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // O Chrome grava áudio puro em WebM/Opus; o Safari, em MP4. Deixar o
      // navegador escolher o que sabe fazer evita um erro de "tipo não
      // suportado" antes de a pessoa dizer uma palavra.
      const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      pedacos.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) pedacos.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(pedacos.current, { type: rec.mimeType || 'audio/webm' });
        setGravacao({ blob, url: URL.createObjectURL(blob) });
        setEstado('pronto');
      };
      gravador.current = rec;
      rec.start(250);
      setSegundos(0);
      relogio.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      setEstado('gravando');
    } catch {
      setErro(t('criar.microfoneNegado'));
    }
  }

  function parar() {
    gravador.current?.stop();
    pararTudo();
  }

  function regravar() {
    if (gravacao) URL.revokeObjectURL(gravacao.url);
    setGravacao(null);
    setEstado('parado');
    setSegundos(0);
  }

  function usar() {
    if (!gravacao) return;
    const extensao = gravacao.blob.type.includes('mp4') ? 'm4a' : 'webm';
    const carimbo = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');
    void enviar(gravacao.blob, `${t('criar.abaGravar')} ${carimbo}.${extensao}`);
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <p className="max-w-sm text-sm text-texto-suave">{t('criar.gravarDica')}</p>

      <button
        type="button"
        onClick={estado === 'gravando' ? parar : comecar}
        disabled={estado === 'pronto' || enviando}
        aria-label={estado === 'gravando' ? t('criar.parar') : t('criar.gravar')}
        className={`flex size-20 items-center justify-center rounded-full border-4 transition-colors disabled:opacity-40 ${
          estado === 'gravando'
            ? 'border-perigo/40 bg-perigo text-white'
            : 'border-borda bg-superficie-alta text-texto hover:border-texto-fraco'
        }`}
      >
        {estado === 'gravando' ? (
          <span className="size-6 rounded-sm bg-white" aria-hidden />
        ) : (
          <MicrofoneIcone tamanho={28} />
        )}
      </button>

      <p className="text-2xl font-semibold tabular-nums">
        {String(Math.floor(segundos / 60)).padStart(1, '0')}:{String(segundos % 60).padStart(2, '0')}
      </p>

      {estado === 'gravando' && (
        <span className="flex items-center gap-2 text-xs text-perigo">
          <span className="size-2 rounded-full bg-perigo pulsando" aria-hidden />
          {t('criar.gravar')}…
        </span>
      )}

      {gravacao && (
        <div className="flex w-full max-w-sm flex-col items-center gap-3">
          <audio controls src={gravacao.url} className="w-full" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={regravar}
              disabled={enviando}
              className="rounded-full border border-borda px-4 py-2 text-sm transition-colors hover:border-texto-fraco disabled:opacity-40"
            >
              {t('criar.regravar')}
            </button>
            <button
              type="button"
              onClick={usar}
              disabled={enviando}
              className="rounded-full gradiente-acento px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {enviando ? t('criar.enviandoArquivo') : t('criar.usarGravacao')}
            </button>
          </div>
        </div>
      )}

      {(erro || erroEnvio) && (
        <p role="alert" className="text-sm text-perigo">
          {erro ?? erroEnvio}
        </p>
      )}
    </div>
  );
}
