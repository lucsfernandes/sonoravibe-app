import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import { AppModule } from './app.module';
import { AUTH, type SonoraAuth } from './auth/auth.config';
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

  // `bodyParser: false` é exigência do Better Auth: o handler dele lê o corpo
  // da requisição direto do stream, e um parser registrado antes já teria
  // consumido esse stream — o login falharia com corpo vazio.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    bodyParser: false,
  });
  const config = app.get<AppConfig>(CONFIG);
  const auth = app.get<SonoraAuth>(AUTH);

  app.enableCors({ origin: config.corsOrigins, credentials: true });

  // Ordem obrigatória: auth primeiro, parser depois.
  // No Express 5 o coringa de rota é `{*path}` — `/api/auth/*` do Express 4
  // dispara "Missing parameter name".
  app.use('/api/auth/{*path}', toNodeHandler(auth));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

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
