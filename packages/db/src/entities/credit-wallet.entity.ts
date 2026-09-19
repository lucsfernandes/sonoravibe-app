import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { User } from './user.entity';
import type { CreditTransaction } from './credit-transaction.entity';

/**
 * Carteira de créditos do usuário.
 *
 * Os saldos aqui são um cache materializado do ledger em `credit_transactions`.
 * A fonte da verdade é a soma das transações — estas colunas existem só para
 * evitar um SUM a cada requisição. Toda alteração passa por
 * `SELECT ... FOR UPDATE` dentro de transação, o que serializa duas gerações
 * simultâneas e impede saldo negativo por corrida.
 */
@Entity({ name: 'credit_wallets' })
export class CreditWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Créditos do plano. Zerados e recarregados a cada renovação. */
  @Column({ type: 'integer', name: 'plan_balance', default: 0 })
  planBalance: number;

  /** Créditos comprados avulsos. Validade de 12 meses, consumidos por último. */
  @Column({ type: 'integer', name: 'pack_balance', default: 0 })
  packBalance: number;

  /**
   * Créditos reservados por gerações em andamento.
   * Já foram debitados do saldo; ficam aqui para poderem ser estornados
   * se o job falhar.
   */
  @Column({ type: 'integer', name: 'reserved_balance', default: 0 })
  reservedBalance: number;

  /** Quando o Free recebe a próxima leva diária. */
  @Column({ type: 'timestamptz', name: 'daily_refill_at', nullable: true })
  dailyRefillAt: Date | null;

  @OneToMany('CreditTransaction', (tx: CreditTransaction) => tx.wallet)
  transactions: CreditTransaction[];

  /** Optimistic locking — protege contra escrita concorrente perdida. */
  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  get availableBalance(): number {
    return this.planBalance + this.packBalance;
  }
}
