import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CONFIG, type AppConfig } from './config/env';

// Em desenvolvimento a configuração vem do .env da raiz; em produção, dos
// secrets do k3s, que já chegam como variáveis de ambiente.
try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // Sem .env: seguimos com o ambiente do processo.
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Sonora');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<AppConfig>(CONFIG);

  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.API_PORT, '0.0.0.0');
  logger.log(
    `API no ar em :${config.API_PORT} | ambiente ${config.NODE_ENV} | motor de música '${config.MUSIC_PROVIDER}'`,
  );
}

bootstrap().catch((err) => {
  // Falha de configuração aparece aqui, antes de qualquer requisição.
  console.error(`\nA API não subiu:\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
