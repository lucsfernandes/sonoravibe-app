import type { AudioFormat } from './audio';

export const PLAN_CODES = ['free', 'pro', 'premier'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanFeatures {
  /** Formatos que este plano pode baixar */
  readonly downloadFormats: readonly AudioFormat[];
  /**
   * Qualidade do MP3 servido.
   * 'full'    = 320 kbps derivado do master FLAC (ACE-Step), ou o próprio master
   *             MP3 sem reencode quando a faixa veio do Lyria (preserva o C2PA).
   * 'preview' = 128 kbps (limitação do Free).
   */
  readonly mp3Quality: 'preview' | 'full';
  /** Pode separar stems com Demucs */
  readonly stems: boolean;
  /** Direito de uso comercial do output */
  readonly commercialUse: boolean;
  /** Prioridade na fila BullMQ — no BullMQ, 1 é a MAIOR prioridade (Premier=1 fura a fila) */
  readonly queuePriority: number;
  /** Quantas gerações podem rodar ao mesmo tempo */
  readonly maxConcurrentGenerations: number;
  /** Libera Max Mode (geração mais longa/custosa) */
  readonly maxMode: boolean;
  /** Duração máxima por música, em segundos. O teto técnico é 480 s. */
  readonly maxDurationSeconds: number;
  /** Download em lote (ZIP) */
  readonly batchDownload: boolean;
}

export interface Plan {
  readonly code: PlanCode;
  readonly name: string;
  readonly priceBrl: number;
  /** Créditos concedidos por mês. No Free a concessão é diária. */
  readonly monthlyCredits: number;
  /**
   * Créditos concedidos a cada ciclo do plano gratuito.
   *
   * Chamava-se `dailyCredits`, e o nome mentia: nada renovava diariamente, nem
   * renovava de forma nenhuma. Agora o intervalo é explícito em `cycleDays`,
   * porque um campo que diz "daily" e concede por mês é como o bug começa.
   */
  readonly cycleCredits?: number;
  /** De quantos em quantos dias `cycleCredits` é concedido de novo. */
  readonly cycleDays?: number;
  readonly features: PlanFeatures;
}

export const PLANS: Record<PlanCode, Plan> = {
  free: {
    code: 'free',
    name: 'Free',
    priceBrl: 0,
    monthlyCredits: 0,
    /**
     * 30 créditos por CICLO, e o ciclo do Free é mensal (`cycle_days = 30` na
     * tabela `plans`). São 3 músicas por mês.
     *
     * Nasceu diário. O problema não era o número, era que nada renovava: a
     * concessão acontecia uma vez no cadastro e nunca mais, então "30 por dia"
     * era, na prática, 30 no total. Agora renova de verdade — e um teto diário
     * de 30 créditos por conta, renovando mesmo, sairia caro em GPU antes de
     * existir receita para pagá-la.
     */
    cycleCredits: 30,
    cycleDays: 30,
    features: {
      downloadFormats: ['mp3'],
      mp3Quality: 'preview',
      stems: false,
      commercialUse: false,
      queuePriority: 10,
      maxConcurrentGenerations: 1,
      maxMode: false,
      maxDurationSeconds: 120,
      /**
       * Baixar em lote vale para todo mundo, inclusive no Free.
       *
       * É o diferencial da plataforma e custa quase nada: o Free só baixa MP3,
       * que já é transcodificado na geração (é o único formato `eager`), então
       * o ZIP só empacota arquivo que já existe. Não há CPU de conversão nem
       * egress do R2, que é gratuito.
       *
       * O custo real é banda da VPS: o ZIP é montado em memória na API, então
       * os bytes passam por lá. Um MP3 de 3 min tem ~2,9 MB; um lote de 50
       * faixas dá ~145 MB. É o único download que não vai direto do R2 para o
       * usuário, e por isso o único que consome banda do servidor.
       */
      batchDownload: true,
    },
  },
  /**
   * Pro e Premier recebem TODOS os formatos; o Free, só MP3 128 kbps.
   *
   * Formato não é alavanca entre os planos pagos. O Premier se diferencia pelo
   * que é mensurável: volume de créditos, fila prioritária, mais gerações
   * simultâneas e Max Mode (músicas de até 8 min).
   */
  pro: {
    code: 'pro',
    name: 'Pro',
    priceBrl: 39,
    monthlyCredits: 5_000,
    features: {
      downloadFormats: ['mp3', 'wav', 'flac', 'm4a', 'opus'],
      mp3Quality: 'full',
      stems: true,
      commercialUse: true,
      queuePriority: 5,
      maxConcurrentGenerations: 3,
      maxMode: false,
      maxDurationSeconds: 240,
      batchDownload: true,
    },
  },
  premier: {
    code: 'premier',
    name: 'Premier',
    priceBrl: 99,
    monthlyCredits: 20_000,
    features: {
      downloadFormats: ['mp3', 'wav', 'flac', 'm4a', 'opus'],
      mp3Quality: 'full',
      stems: true,
      commercialUse: true,
      queuePriority: 1,
      maxConcurrentGenerations: 6,
      maxMode: true,
      maxDurationSeconds: 480,
      batchDownload: true,
    },
  },
};

/**
 * Teto de duração que cada motor realmente entrega.
 *
 * O Lyria não recebe duração como parâmetro (ela viaja como sugestão de texto
 * dentro do prompt) e devolve no máximo ~3 min. O ACE-Step chega aos 480 s que
 * os planos prometem.
 *
 * O teto é indexado pelo MOTOR, e não uma constante única, porque foi assim que
 * a promessa desandou da primeira vez: o plano dizia 8 min, o motor ligado
 * entregava 3, e nada no código ligava as duas coisas. Numa geração de teste em
 * produção um usuário Free pediu uma música e recebeu 3:01, acima do limite do
 * próprio plano.
 *
 * Agora `maxDurationFor` recebe qual motor está configurado e o anúncio segue a
 * realidade sozinho: trocar `MUSIC_PROVIDER` para `acestep` no ConfigMap já
 * libera os 8 min, sem editar constante nenhuma.
 */
export const ENGINE_MAX_DURATION_SECONDS: Record<string, number> = {
  /** Não aceita duração como parâmetro; ela vai como sugestão no prompt. */
  lyria: 180,
  /** Com o LM ligado (`thinking`), que é obrigatório para o ritmo sair certo. */
  acestep: 480,
  /** O mock gera tom senoidal; o teto existe só para o teste bater com o Lyria. */
  mock: 180,
};

/**
 * Duração máxima real de uma música neste plano, hoje.
 *
 * Existe para que a tela de planos, a validação da API e a fila leiam o mesmo
 * número. Ler `features.maxDurationSeconds` direto é o que produz a promessa
 * que o motor não cumpre.
 */
export function maxDurationFor(code: PlanCode, engine = 'lyria'): number {
  const teto = ENGINE_MAX_DURATION_SECONDS[engine] ?? 180;
  return Math.min(PLANS[code].features.maxDurationSeconds, teto);
}

export function planOf(code: PlanCode): Plan {
  return PLANS[code];
}

export function canDownloadFormat(code: PlanCode, format: AudioFormat): boolean {
  return PLANS[code].features.downloadFormats.includes(format);
}
