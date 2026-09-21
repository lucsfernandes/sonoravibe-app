import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Public } from '../auth/session.guard';
import { DATA_SOURCE } from '../database/database.module';
import { REDIS } from '../queue/queue.module';

/**
 * Sonda de saúde para o Kubernetes.
 *
 * Responde 503 quando uma dependência está fora — o readiness probe tira a
 * réplica do balanceador em vez de deixá-la recebendo tráfego que vai falhar.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Fora do limite por IP: as sondas do Kubernetes chegam sempre do mesmo nó,
  // e um 429 aqui tiraria a réplica do ar sem ela ter nada de errado.
  @SkipThrottle()
  @Public()
  @Get()
  async check(@Res() res: Response): Promise<void> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const healthy = database.ok && redis.ok;

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: healthy ? 'ok' : 'degraded',
      checks: { database, redis },
      uptimeSeconds: Math.round(process.uptime()),
    });
  }

  private async checkDatabase(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    return timed(() => this.dataSource.query('SELECT 1'));
  }

  private async checkRedis(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    return timed(() => this.redis.ping());
  }
}

async function timed(
  probe: () => Promise<unknown>,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await probe();
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
