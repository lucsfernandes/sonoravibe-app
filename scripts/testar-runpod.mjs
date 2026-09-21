#!/usr/bin/env node
/**
 * Testa o endpoint serverless da RunPod de ponta a ponta, com o NOSSO handler.
 *
 * Diferente de `runpod-bench.mjs`, que cria um Pod com a imagem oficial para
 * medir custo: aqui o alvo é o endpoint serverless já criado, com a imagem que
 * contém `apps/gpu-worker/handler.py`. É a verificação antes de apontar a
 * produção para ele.
 *
 * Gera uma faixa curta de propósito. O objetivo é provar que o caminho inteiro
 * funciona (job aceito, modelos carregados, áudio gerado, upload no R2
 * concluído), não medir qualidade. Uma faixa de 20 s custa centavos.
 *
 * Uso:  node scripts/testar-runpod.mjs [segundos]
 * Lê RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID e as credenciais do R2 do .env.
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

try {
  process.loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // segue com o ambiente do shell
}

const { RUNPOD_API_KEY, RUNPOD_ENDPOINT_ID } = process.env;
if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
  console.error('Faltou RUNPOD_API_KEY ou RUNPOD_ENDPOINT_ID no .env.');
  process.exit(1);
}

const BASE = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}`;
const AUTH = { Authorization: `Bearer ${RUNPOD_API_KEY}`, 'Content-Type': 'application/json' };
const SEGUNDOS = Number(process.argv[2] ?? 20);

/**
 * Destino no R2 onde o handler grava o master.
 *
 * Usa o SDK da AWS direto, resolvido a partir de `packages/storage`: este script mora
 * em `scripts/`, que não é pacote do workspace e por isso não enxerga
 * `@sonora/storage`.
 */
async function destinoNoR2() {
  const require = createRequire(join(process.cwd(), 'packages/storage/package.json'));
  const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const Bucket = process.env.R2_BUCKET;
  const storageKey = `testes/runpod-${randomUUID()}.flac`;

  const url = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket, Key: storageKey, ContentType: 'audio/flac' }),
    { expiresIn: 3600 },
  );

  const storage = {
    async statObject(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: r.ContentLength ?? 0 };
      } catch {
        return null;
      }
    },
  };

  return { storage, storageKey, url };
}

function agora() {
  return new Date().toISOString().slice(11, 19);
}

async function main() {
  console.log(`Endpoint ${RUNPOD_ENDPOINT_ID}`);

  const saude = await fetch(`${BASE}/health`, { headers: AUTH }).then((r) => r.json());
  console.log(`Workers: ${JSON.stringify(saude.workers)}`);
  console.log(`Jobs até agora: ${JSON.stringify(saude.jobs)}\n`);

  const { storage, storageKey, url } = await destinoNoR2();

  const input = {
    caption: 'samba de roda instrumental, cavaquinho e pandeiro, andamento animado',
    lyrics: '',
    instrumental: true,
    duration: SEGUNDOS,
    vocal_language: 'pt',
    batch_size: 1,
    task_type: 'text2music',
    uploads: [{ url, storage_key: storageKey }],
  };

  console.log(`${agora()}  enviando job (${SEGUNDOS}s de áudio)...`);
  const inicio = Date.now();

  const envio = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({ input }),
  });
  const job = await envio.json();

  if (!job.id) {
    console.error('A RunPod não aceitou o job:', JSON.stringify(job, null, 2));
    process.exit(1);
  }
  console.log(`${agora()}  job ${job.id} na fila`);

  let ultimo = '';
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await fetch(`${BASE}/status/${job.id}`, { headers: AUTH }).then((r) => r.json());

    if (s.status !== ultimo) {
      console.log(`${agora()}  ${s.status}`);
      ultimo = s.status;
    }

    if (s.status === 'COMPLETED') {
      const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
      console.log(`\nConcluído em ${segundos}s de ponta a ponta.`);
      console.log(`Saída: ${JSON.stringify(s.output, null, 2).slice(0, 700)}`);

      // O handler diz que gravou. Conferir é o que separa "respondeu" de
      // "funcionou": o R2 aceita PUT com tipo divergente sem reclamar.
      const stat = await storage.statObject(storageKey);
      console.log(
        stat
          ? `\nArquivo no R2: ${(stat.size / 1024 / 1024).toFixed(2)} MB em ${storageKey}`
          : `\nATENÇÃO: o handler disse ter gravado, mas ${storageKey} não está no bucket.`,
      );
      return;
    }

    if (s.status === 'FAILED') {
      console.error(`\nO job falhou:\n${JSON.stringify(s.error ?? s, null, 2).slice(0, 2000)}`);
      process.exit(1);
    }

    if ((Date.now() - inicio) / 1000 > 900) {
      console.error('\nPassou de 15 min sem terminar. Veja os logs do endpoint no console.');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(`\nFalhou: ${err.message}`);
  process.exit(1);
});
