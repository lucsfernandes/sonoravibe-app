import 'reflect-metadata';
import { resolve } from 'node:path';
import { ENTITIES } from '@sonora/db';
import { DataSource } from 'typeorm';
import { buildAuthOptions } from './auth/auth.config';
import { loadConfig } from './config/env';

/**
 * Cria o schema do banco e encerra.
 *
 * Existe como entrypoint próprio, e não como "subir a API com DB_SYNCHRONIZE=true",
 * por dois motivos práticos:
 *
 *  - A API fica escutando para sempre. Como Job do Kubernetes ela nunca
 *    completaria, e como `kubectl run -it` exige alguém apertar Ctrl+C na hora
 *    certa — sem saber se o schema já terminou de ser criado.
 *  - Subir a aplicação inteira para criar tabela carrega filas, storage, o
 *    gateway de pagamento e o servidor HTTP, tudo sem necessidade. Cada um
 *    desses é uma chance a mais de falhar por um motivo que não tem nada a ver
 *    com o banco.
 *
 * Ordem importa: as tabelas do Better Auth (`user`, `session`, `account`,
 * `verification`) vêm primeiro, porque `songs`, `profiles` e `credit_wallets`
 * têm chave estrangeira para `user.id`. Invertido, o synchronize falharia com
 * "relation user does not exist".
 *
 * Roda dentro da imagem da API:
 *   node -r @swc-node/register src/schema.ts
 */

// No Kubernetes as variáveis chegam pelo envFrom do Job; localmente, do .env
// da raiz. Sem esta linha o script só roda dentro do cluster — e um script de
// migração que não dá para testar na máquina é um script que ninguém testa.
try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // Sem .env: seguimos com o ambiente do processo, que é o caso no cluster.
}

async function main(): Promise<void> {
  // `loadConfig` valida tudo, inclusive as combinações cruzadas. Aqui isso é
  // desejável: se DATABASE_URL estiver errada, falha com mensagem clara antes
  // de tentar qualquer DDL.
  const config = loadConfig();

  console.log(`Banco: ${mascarar(config.DATABASE_URL)}`);

  // ---------------------------------------------------- Better Auth primeiro
  const { getMigrations } = await import('better-auth/db/migration');
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
    buildAuthOptions(config),
  );

  const pendentes = [...toBeCreated, ...toBeAdded];
  if (pendentes.length === 0) {
    console.log('Better Auth: schema já estava em dia.');
  } else {
    console.log(`Better Auth: criando ${pendentes.map((t) => t.table).join(', ')}`);
    await runMigrations();
  }

  // ------------------------------------------------------ tabelas do domínio
  const dataSource = new DataSource({
    type: 'postgres',
    url: config.DATABASE_URL,
    entities: ENTITIES,
    synchronize: true,
    logging: ['error'],
  });

  await dataSource.initialize();
  console.log('Domínio: entidades sincronizadas.');

  const tabelas = await dataSource.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );

  console.log(`\n${tabelas.length} tabelas no schema public:`);
  for (const { tablename } of tabelas) console.log(`  ${tablename}`);

  await dataSource.destroy();
  console.log('\nPronto.');
}

/** Esconde a senha: a saída do Job vai para o log do cluster. */
function mascarar(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

main().catch((err) => {
  console.error(`\nFalhou ao criar o schema:\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
