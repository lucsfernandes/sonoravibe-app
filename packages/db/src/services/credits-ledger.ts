import type { CreditBucket, CreditReason } from '@sonora/shared';
import { PACK_VALIDITY_MONTHS } from '@sonora/shared';
import { DataSource, type EntityManager } from 'typeorm';
import { CreditTransaction } from '../entities/credit-transaction.entity';
import { CreditWallet } from '../entities/credit-wallet.entity';
import { Generation } from '../entities/generation.entity';

/** Log mínimo, para a classe não depender do runtime do Nest. */
export interface LedgerLogger {
  log(message: string): void;
}

/**
 * Carteira de créditos.
 *
 * Vive no pacote de dados, e não na API, porque as duas pontas do fluxo mexem
 * nela: a API reserva antes de enfileirar e o worker confirma ou estorna ao
 * terminar. Reimplementar o ledger no worker seria duplicar a única parte do
 * sistema onde um erro vira dinheiro errado.
 *
 * O ledger (`credit_transactions`) é a fonte da verdade e é append-only: nunca
 * atualizamos nem apagamos lançamento. As colunas de saldo na carteira são um
 * cache materializado, para não somar o ledger inteiro a cada requisição.
 *
 * Toda escrita acontece dentro de uma transação que pega a carteira com
 * `SELECT ... FOR UPDATE`. Sem isso, duas gerações simultâneas leriam o mesmo
 * saldo e ambas passariam — o usuário geraria música sem crédito.
 *
 * Ordem de consumo: primeiro o crédito do plano (que expira na renovação),
 * depois o comprado avulso (validade de 12 meses). O usuário perde o que
 * expiraria antes.
 */

export class InsufficientCreditsError extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(`Créditos insuficientes: precisa de ${required}, tem ${available}.`);
    this.name = 'InsufficientCreditsError';
  }
}

export interface ReservationSplit {
  fromPlan: number;
  fromPack: number;
}

export class CreditsLedger {
  constructor(
    protected readonly dataSource: DataSource,
    private readonly logger: LedgerLogger = console,
  ) {}

  /** Saldo disponível (plano + pacote). Não inclui o que está reservado. */
  async balanceOf(userId: string): Promise<{ plan: number; pack: number; total: number; reserved: number }> {
    const wallet = await this.dataSource.getRepository(CreditWallet).findOneBy({ userId });
    if (!wallet) return { plan: 0, pack: 0, total: 0, reserved: 0 };
    return {
      plan: wallet.planBalance,
      pack: wallet.packBalance,
      total: wallet.planBalance + wallet.packBalance,
      reserved: wallet.reservedBalance,
    };
  }

  /** Cria a carteira do usuário. Idempotente: chamar duas vezes não duplica. */
  async ensureWallet(userId: string, manager?: EntityManager): Promise<CreditWallet> {
    const run = async (em: EntityManager) => {
      const existing = await em.getRepository(CreditWallet).findOneBy({ userId });
      if (existing) return existing;
      return em.getRepository(CreditWallet).save(em.getRepository(CreditWallet).create({ userId }));
    };
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  /**
   * Debita os créditos e marca como reservados, antes de enfileirar o job.
   * Cobrar só no fim deixaria o usuário enfileirar dez gerações com saldo para uma.
   */
  async reserve(userId: string, credits: number, generationId: string): Promise<ReservationSplit> {
    if (credits <= 0) return { fromPlan: 0, fromPack: 0 };

    return this.dataSource.transaction(async (em) => {
      const wallet = await this.lockWallet(em, userId);
      const available = wallet.planBalance + wallet.packBalance;
      if (available < credits) throw new InsufficientCreditsError(credits, available);

      const fromPlan = Math.min(wallet.planBalance, credits);
      const fromPack = credits - fromPlan;

      wallet.planBalance -= fromPlan;
      wallet.packBalance -= fromPack;
      wallet.reservedBalance += credits;
      await em.getRepository(CreditWallet).save(wallet);

      const balanceAfter = wallet.planBalance + wallet.packBalance;
      await this.record(em, wallet.id, [
        ...(fromPlan ? [{ amount: -fromPlan, bucket: 'plan' as const }] : []),
        ...(fromPack ? [{ amount: -fromPack, bucket: 'pack' as const }] : []),
      ], 'generation', balanceAfter, generationId);

      return { fromPlan, fromPack };
    });
  }

  /**
   * Confirma o consumo: os créditos já saíram do saldo na reserva, então aqui
   * só encerramos a reserva. Nenhum lançamento novo — o consumo já está no ledger.
   */
  async commit(userId: string, credits: number): Promise<void> {
    if (credits <= 0) return;
    await this.dataSource.transaction(async (em) => {
      const wallet = await this.lockWallet(em, userId);
      wallet.reservedBalance = Math.max(0, wallet.reservedBalance - credits);
      await em.getRepository(CreditWallet).save(wallet);
    });
  }

  /**
   * Devolve os créditos de uma geração que falhou, nos mesmos baldes de onde
   * saíram. Idempotente pela flag `refunded`: um retry do worker não devolve duas vezes.
   */
  async refund(generationId: string): Promise<{ refunded: number }> {
    return this.dataSource.transaction(async (em) => {
      const generation = await em.getRepository(Generation).findOne({
        where: { id: generationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!generation) throw new Error(`Geração ${generationId} não encontrada para estorno.`);
      if (generation.refunded || generation.creditsCharged <= 0) return { refunded: 0 };

      const wallet = await this.lockWallet(em, generation.userId);

      // Devolve exatamente como foi cobrado, lendo os lançamentos daquela geração.
      const consumed = await em.getRepository(CreditTransaction).find({
        where: { generationId, reason: 'generation' },
      });
      const entries = consumed.map((tx) => ({ amount: Math.abs(tx.amount), bucket: tx.bucket }));
      const total = entries.reduce((sum, e) => sum + e.amount, 0);

      for (const entry of entries) {
        if (entry.bucket === 'plan') wallet.planBalance += entry.amount;
        else wallet.packBalance += entry.amount;
      }
      wallet.reservedBalance = Math.max(0, wallet.reservedBalance - generation.creditsCharged);
      await em.getRepository(CreditWallet).save(wallet);

      await this.record(
        em,
        wallet.id,
        entries,
        'refund',
        wallet.planBalance + wallet.packBalance,
        generationId,
      );

      generation.refunded = true;
      await em.getRepository(Generation).save(generation);

      this.logger.log(`Estorno de ${total} créditos da geração ${generationId}`);
      return { refunded: total };
    });
  }

  /** Concede créditos: renovação de plano, compra de pacote ou cortesia manual. */
  async grant(
    userId: string,
    credits: number,
    bucket: CreditBucket,
    reason: CreditReason,
    description?: string,
  ): Promise<void> {
    if (credits <= 0) return;
    await this.dataSource.transaction(async (em) => {
      const wallet = await this.lockWallet(em, userId);
      if (bucket === 'plan') wallet.planBalance += credits;
      else wallet.packBalance += credits;
      await em.getRepository(CreditWallet).save(wallet);

      const expiresAt =
        bucket === 'pack'
          ? new Date(Date.now() + PACK_VALIDITY_MONTHS * 30 * 24 * 3600 * 1000)
          : undefined;

      await this.record(
        em,
        wallet.id,
        [{ amount: credits, bucket }],
        reason,
        wallet.planBalance + wallet.packBalance,
        null,
        description,
        expiresAt,
      );
    });
  }

  /**
   * Trava a carteira para escrita. Sem o lock, duas transações simultâneas leem
   * o mesmo saldo e as duas passam.
   */
  private async lockWallet(em: EntityManager, userId: string): Promise<CreditWallet> {
    const repo = em.getRepository(CreditWallet);
    const wallet = await repo.findOne({ where: { userId }, lock: { mode: 'pessimistic_write' } });
    if (wallet) return wallet;
    // Primeira operação do usuário: cria a carteira dentro da mesma transação.
    return repo.save(repo.create({ userId }));
  }

  private async record(
    em: EntityManager,
    walletId: string,
    entries: { amount: number; bucket: CreditBucket }[],
    reason: CreditReason,
    balanceAfter: number,
    generationId: string | null = null,
    description?: string,
    expiresAt?: Date,
  ): Promise<void> {
    if (entries.length === 0) return;
    const repo = em.getRepository(CreditTransaction);
    await repo.save(
      entries.map((entry) =>
        repo.create({
          walletId,
          amount: entry.amount,
          bucket: entry.bucket,
          reason,
          generationId,
          balanceAfter,
          description: description ?? null,
          expiresAt: expiresAt ?? null,
        }),
      ),
    );
  }
}
