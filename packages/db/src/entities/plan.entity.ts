import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { PlanFeatures } from '@sonora/shared';

/**
 * Um plano vendável.
 *
 * Existe no banco, e não só em `packages/shared/src/plans.ts`, por um motivo
 * comercial: preço e texto mudam com frequência, e cada mudança não deveria
 * custar um build, um push e um rollout. Mexer numa linha resolve.
 *
 * A chave primária é o `code` ('free', 'pro', 'premier') e não um uuid. Esse
 * código já viaja em `subscriptions.plan_code`, nos webhooks do gateway e no
 * corpo de `POST /billing/subscribe`; dar um id sintético a ele obrigaria uma
 * tradução em cada uma dessas bordas, sem ganhar nada.
 *
 * `features` fica em JSON por uma questão de ritmo de mudança: colunas servem
 * para o que se consulta e ordena (preço, ordem, ativo), e essas flags só são
 * lidas em bloco depois de carregar o plano. Uma coluna por flag significaria
 * uma migração a cada capacidade nova.
 *
 * O `plans.ts` continua sendo a semente e o fallback. Se a tabela estiver vazia
 * — banco novo, seed que não rodou — a API sobe com os planos do código em vez
 * de responder que não existe plano nenhum.
 */
@Entity({ name: 'plans' })
export class Plan {
  @PrimaryColumn({ type: 'text' })
  code: string;

  @Column({ type: 'text' })
  name: string;

  /**
   * Em reais, com centavos. `numeric` e não `float`: preço em ponto flutuante
   * é como se perde centavo em conciliação.
   */
  @Column({ type: 'numeric', name: 'price_brl', precision: 10, scale: 2, default: 0 })
  priceBrl: string;

  @Column({ type: 'integer', name: 'monthly_credits', default: 0 })
  monthlyCredits: number;

  /**
   * Créditos concedidos a cada renovação do ciclo gratuito.
   *
   * Nulo nos planos pagos, que recebem `monthly_credits` na cobrança.
   */
  @Column({ type: 'integer', name: 'cycle_credits', nullable: true })
  cycleCredits: number | null;

  /**
   * De quantos em quantos dias `cycle_credits` é concedido de novo.
   *
   * O Free nasceu com 30 créditos por dia e nenhum mecanismo que os
   * renovasse: a concessão acontecia uma vez, no cadastro, e o usuário ficava
   * sem nada depois de três músicas. Este campo é o que o `PlanRenewalService`
   * lê para saber quando conceder de novo.
   */
  @Column({ type: 'integer', name: 'cycle_days', nullable: true })
  cycleDays: number | null;

  /** Frase curta do cartão na página de vendas. */
  @Column({ type: 'text', nullable: true })
  tagline: string | null;

  /** Marca o cartão como o sugerido. Só um plano deveria ter isto ligado. */
  @Column({ type: 'boolean', name: 'is_highlighted', default: false })
  isHighlighted: boolean;

  /** Ordem de exibição. Menor aparece primeiro. */
  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder: number;

  /**
   * Plano fora de venda continua valendo para quem já assinou.
   *
   * É o que permite subir o preço sem quebrar contrato: cria-se o plano novo,
   * desliga-se o antigo, e quem estava nele segue pagando o que combinou.
   */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'jsonb' })
  features: PlanFeatures;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
