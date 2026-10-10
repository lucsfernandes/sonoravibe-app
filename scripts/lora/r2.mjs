/**
 * Cliente do bucket PRIVADO de datasets de LoRA (R2_DATASET_BUCKET).
 *
 * Nunca o bucket de produção: aquele tem o domínio público cdn.sonoravibe.com,
 * e qualquer chave ali pode ser lida por quem souber o caminho. As credenciais
 * são as R2_* do .env e nunca são impressas.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

try {
  process.loadEnvFile(join(process.cwd(), '.env'));
} catch {
  // segue com o ambiente do shell
}

// O SDK é dependência do packages/storage; o pnpm não o expõe na raiz.
const require = createRequire(join(process.cwd(), 'packages', 'storage', 'package.json'));
const s3 = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

export const BUCKET = process.env.R2_DATASET_BUCKET;

// Chave própria do bucket de datasets (recomendado: um token restrito a ele). Sem ela,
// cai na chave R2_* de produção, que precisaria ter acesso a este bucket também.
const ACCESS_KEY = process.env.R2_DATASET_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_DATASET_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;

export function assertConfig() {
  const missing = ['R2_ACCOUNT_ID', 'R2_DATASET_BUCKET'].filter((k) => !process.env[k]);
  if (!ACCESS_KEY || !SECRET_KEY) missing.push('R2_DATASET_ACCESS_KEY_ID / R2_DATASET_SECRET_ACCESS_KEY');
  if (missing.length) {
    throw new Error(
      `Faltou no .env: ${missing.join(', ')}. Crie o bucket privado (Cloudflare → R2 → Create bucket, ` +
        'sem domínio público) e ponha o nome em R2_DATASET_BUCKET.',
    );
  }
  if (BUCKET === process.env.R2_BUCKET) {
    throw new Error('R2_DATASET_BUCKET não pode ser o bucket de produção (ele tem domínio público).');
  }
}

let client;
function c() {
  client ??= new s3.S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });
  return client;
}

/** Confere que o bucket existe e que o token alcança ele (erro legível se não). */
export async function checkBucket() {
  try {
    // Listar (e não HeadBucket): um token "Object Read & Write" pode listar, mas não ler o bucket em si.
    await c().send(new s3.ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
  } catch (err) {
    const code = err?.$metadata?.httpStatusCode;
    throw new Error(
      code === 404 || err?.name === 'NoSuchBucket'
        ? `O bucket '${BUCKET}' não existe (confira o nome e o R2_ACCOUNT_ID).`
        : code === 403 || code === 401
          ? `O token não tem acesso ao bucket '${BUCKET}': ele precisa de "Object Read & Write" nesse bucket.`
          : `Falha ao acessar o bucket '${BUCKET}': ${err.name} ${code ?? ''}`.trim(),
    );
  }
}

export async function put(key, body, contentType) {
  await c().send(new s3.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getText(key) {
  try {
    const res = await c().send(new s3.GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return await res.Body.transformToString();
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return null;
    throw err;
  }
}

export async function list(prefix) {
  const keys = [];
  let token;
  do {
    const res = await c().send(
      new s3.ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of res.Contents ?? []) keys.push({ key: o.Key, size: o.Size });
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export function presignGet(key, expiresIn) {
  return getSignedUrl(c(), new s3.GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export function presignPut(key, expiresIn) {
  return getSignedUrl(c(), new s3.PutObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

/** Nome de estilo seguro para chave e pasta: minúsculas, números e hífen. */
export function slug(style) {
  const s = String(style ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!s) throw new Error('Informe o estilo (ex.: forro, synthwave).');
  return s;
}

export const AUDIO_EXT = /\.(mp3|wav|flac|ogg|opus)$/i;

/** Apaga tudo sob o prefixo (em lotes de 1000, o limite do DeleteObjects). Devolve quantos. */
export async function removePrefix(prefix) {
  const keys = (await list(prefix)).map((o) => ({ Key: o.key }));
  for (let i = 0; i < keys.length; i += 1000) {
    await c().send(new s3.DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.slice(i, i + 1000), Quiet: true } }));
  }
  return keys.length;
}
