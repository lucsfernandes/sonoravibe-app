import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Subscription } from './subscription.entity';
import { User } from './user.entity';

export type PaymentMethod = 'pix' | 'boleto' | 'credit_card';
export type PaymentStatus =
  | 'pending'
  | 'confirmed'
  | 'received'
  | 'overdue'
  | 'refunded'
  | 'failed';

/** Cobrança individual — de assinatura ou de pacote avulso de créditos. */
@Entity({ name: 'payments' })
@Index(['userId', 'createdAt'])
@Index(['providerRef'], { unique: true })
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Null quando é compra de pacote avulso, não assinatura. */
  @Column({ type: 'uuid', name: 'subscription_id', nullable: true })
  subscriptionId: string | null;

  @ManyToOne(() => Subscription, (sub) => sub.payments, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription | null;

  /** Código do pacote em CREDIT_PACKS, quando for compra avulsa. */
  @Column({ type: 'varchar', length: 32, name: 'pack_code', nullable: true })
  packCode: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, name: 'amount_brl' })
  amountBrl: string;

  @Column({ type: 'varchar', length: 16 })
  method: PaymentMethod;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: PaymentStatus;

  @Column({ type: 'varchar', length: 24, name: 'provider_id' })
  providerId: string;

  /** ID da cobrança no gateway. Único — é a chave de idempotência do webhook. */
  @Column({ type: 'varchar', length: 120, name: 'provider_ref' })
  providerRef: string;

  /** Link de pagamento / QR Code PIX devolvido pelo gateway. */
  @Column({ type: 'text', name: 'checkout_url', nullable: true })
  checkoutUrl: string | null;

  @Column({ type: 'text', name: 'pix_payload', nullable: true })
  pixPayload: string | null;

  /** true depois que os créditos desta cobrança já foram concedidos. */
  @Column({ type: 'boolean', name: 'credits_granted', default: false })
  creditsGranted: boolean;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
