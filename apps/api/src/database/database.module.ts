import { Global, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENTITIES } from '@sonora/db';
import { DataSource } from 'typeorm';
import { buildAuthOptions } from '../auth/auth.config';
import { CONFIG, type AppConfig } from '../config/env';

export const DATA_SOURCE = Symbol('sonora.dataSource');

/**
 * Conexão única com o Postgres, compartilhada por toda a aplicação.
 *
 * `synchronize` só liga em desenvolvimento, por variável: em produção o schema
 * vem de migrations versionadas, porque synchronize apaga coluna que sumiu do
 * código — e aqui isso significaria perder música de usuário.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE,
      inject: [CONFIG],
      useFactory: async (config: AppConfig) => {
        if (config.DB_SYNCHRONIZE) await runAuthMigrations(config);

        const dataSource = new DataSource({
          type: 'postgres',
          url: config.DATABASE_URL,
          entities: ENTITIES,
          synchronize: config.DB_SYNCHRONIZE ?? false,
          logging: config.isProduction ? ['error', 'warn'] : ['error'],
          // Pool enxuto: a API é I/O-bound e roda em várias réplicas.
          poolSize: 10,
        });
        await dataSource.initialize();
        return dataSource;
      },
    },
  ],
  exports: [DATA_SOURCE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor() {}

  async onApplicationShutdown(): Promise<void> {
    // O DataSource é fechado pelo provider do Nest ao destruir o módulo global.
  }
}

/**
 * Cria as tabelas do Better Auth antes de o TypeORM criar as do domínio.
 *
 * A ordem importa: `songs`, `profiles` e `credit_wallets` têm chave estrangeira
 * para `user.id`, e essa tabela é do Better Auth (a entidade User é marcada
 * `synchronize: false` justamente para o TypeORM não disputar a posse dela).
 * Sem isso, um banco novo falha na subida com "relation user does not exist".
 *
 * Só roda com DB_SYNCHRONIZE — o mesmo interruptor do synchronize do TypeORM.
 * Em produção as duas coisas são passos explícitos de deploy.
 */
async function runAuthMigrations(config: AppConfig): Promise<void> {
  const logger = new Logger('AuthMigrations');
  const { getMigrations } = await import('better-auth/db/migration');

  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(buildAuthOptions(config));

  const pending = toBeCreated.length + toBeAdded.length;
  if (pending === 0) return;

  const tables = [...toBeCreated, ...toBeAdded].map((t) => t.table).join(', ');
  logger.log(`Aplicando schema do Better Auth (${pending}): ${tables}`);
  await runMigrations();
}
