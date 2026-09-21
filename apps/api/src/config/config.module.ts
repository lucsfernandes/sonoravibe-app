import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './env';

/** Configuração validada, disponível em toda a aplicação. */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }],
  exports: [CONFIG],
})
export class ConfigModule {}
