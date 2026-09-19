import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENTITIES } from '@sonora/db';
import { DataSource } from 'typeorm';
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
