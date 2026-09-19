import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { CreditBucket, CreditReason } from '@sonora/shared';
import { CreditWallet } from './credit-wallet.entity';

/**
 * Ledger append-only de créditos.
 *
 * Nunca atualizamos nem apagamos uma linha aqui. Consumo entra como valor
 * negativo, crédito como positivo, estorno como um novo lançamento positivo
 * referenciando a mesma geração. Isso dá auditoria completa e torna o estorno
 * uma operação idempotente e verificável.
 */
@Entity({ name: 'credit_transactions' })
@Index(['walletId', 'createdAt'])
@Index(['generationId'])
export class CreditTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'wallet_id' })
  walletId: string;

  @ManyToOne(() => CreditWallet, (wallet) => wallet.transactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'wallet_id' })
  wallet: CreditWallet;

  /** Positivo credita, negativo consome. */
  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'varchar', length: 8 })
  bucket: CreditBucket;

  @Column({ type: 'varchar', length: 24 })
  reason: CreditReason;

  /** Geração que originou o lançamento, quando houver. */
  @Column({ type: 'uuid', name: 'generation_id', nullable: true })
  generationId: string | null;

  /** Saldo total (plan + pack) logo após este lançamento — facilita auditar. */
  @Column({ type: 'integer', name: 'balance_after' })
  balanceAfter: number;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Para créditos de pacote: quando expiram. */
  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
