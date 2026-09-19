import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PlanCode } from '@sonora/shared';
import { User } from './user.entity';
import type { Payment } from './payment.entity';

export type SubscriptionStatus =
  | 'active'
  | 'pending'
  | 'past_due'
  | 'canceled'
  | 'expired';

@Entity({ name: 'subscriptions' })
@Index(['userId', 'status'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.subscriptions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Código do plano em @sonora/shared — não é FK, os planos vivem em código. */
  @Column({ type: 'varchar', length: 16, name: 'plan_code' })
  planCode: PlanCode;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: SubscriptionStatus;

  /** Qual PaymentProvider atendeu — 'asaas' ou 'fake'. */
  @Column({ type: 'varchar', length: 24, name: 'provider_id' })
  providerId: string;

  /** ID da assinatura no gateway. */
  @Column({ type: 'varchar', length: 120, name: 'provider_ref', nullable: true })
  providerRef: string | null;

  /** Quando os créditos do plano foram recarregados pela última vez. */
  @Column({ type: 'timestamptz', name: 'credits_granted_at', nullable: true })
  creditsGrantedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'current_period_start', nullable: true })
  currentPeriodStart: Date | null;

  @Column({ type: 'timestamptz', name: 'current_period_end', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ type: 'timestamptz', name: 'canceled_at', nullable: true })
  canceledAt: Date | null;

  @OneToMany('Payment', (payment: Payment) => payment.subscription)
  payments: Payment[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
