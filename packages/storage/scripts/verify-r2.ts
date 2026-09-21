/**
 * Verifica as credenciais do R2 com uma ida e volta real, do jeito que o
 * produto usa: URL pré-assinada de escrita (como o worker GPU da RunPod faz),
 * leitura assinada, tamanho e remoção.
 *
 * Também confirma que o Content-Type está amarrado à assinatura — se não
 * estivesse, um worker enviando o tipo errado gravaria assim mesmo e o player
 * receberia um arquivo com tipo inválido.
 *
 * Uso: pnpm --filter @sonora/storage exec tsx scripts/verify-r2.ts
 */
import { StorageService } from '../src/index';

process.loadEnvFile(new URL('../../../.env', import.meta.url).pathname.replace(/^\//, ''));

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Faltando no .env: ${missing.join(', ')}`);
  process.exit(1);
}

const storage = new StorageService({
  accountId: process.env.R2_ACCOUNT_ID!,
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  bucket: process.env.R2_BUCKET!,
  publicUrl: process.env.R2_PUBLIC_URL,
});

const key = `diagnostics/verify-${Date.now()}.flac`;
const payload = Buffer.from('sonora-r2-check');

async function main(): Promise<void> {
  const results: string[] = [];

  const putUrl = await storage.presignPut(key, 'audio/flac', 300);
  results.push(`URL de escrita assinada: ok (${new URL(putUrl).host})`);

  const upload = await fetch(putUrl, {
    method: 'PUT',
    body: payload,
    headers: { 'Content-Type': 'audio/flac' },
  });
  if (!upload.ok) throw new Error(`upload falhou: HTTP ${upload.status} ${(await upload.text()).slice(0, 200)}`);
  results.push(`Upload pela URL assinada: HTTP ${upload.status}`);

  // O worker manda audio/flac; um tipo diferente tem que ser recusado.
  const wrongType = await fetch(putUrl, {
    method: 'PUT',
    body: payload,
    headers: { 'Content-Type': 'audio/mpeg' },
  });
  results.push(
    wrongType.ok
      ? `ATENCAO: o R2 aceitou Content-Type divergente (HTTP ${wrongType.status}) - a assinatura nao amarra o tipo`
      : `Content-Type divergente recusado: HTTP ${wrongType.status} (esperado)`,
  );

  const size = await storage.sizeOf(key);
  results.push(`Tamanho lido do bucket: ${size} bytes (enviado ${payload.length})`);
  if (size !== payload.length) throw new Error('tamanho gravado diferente do enviado');

  const getUrl = await storage.presignGet(key, 300, 'sonora.flac');
  const download = await fetch(getUrl);
  const body = Buffer.from(await download.arrayBuffer());
  results.push(
    `Download assinado: HTTP ${download.status}, content-type ${download.headers.get('content-type')}, ` +
      `conteudo ${body.equals(payload) ? 'identico' : 'DIFERENTE'}`,
  );
  if (!body.equals(payload)) throw new Error('conteudo baixado difere do enviado');

  if (process.env.R2_PUBLIC_URL) {
    const publicResponse = await fetch(storage.publicUrl(key)).catch(() => null);
    results.push(
      publicResponse
        ? `Dominio publico (${process.env.R2_PUBLIC_URL}): HTTP ${publicResponse.status}`
        : `Dominio publico (${process.env.R2_PUBLIC_URL}): sem resposta (DNS ou CDN ainda nao configurado)`,
    );
  }

  await storage.deleteObject(key);
  results.push(`Objeto de teste removido: ${(await storage.sizeOf(key)) === null ? 'confirmado' : 'AINDA EXISTE'}`);

  console.log(results.map((line) => `  ${line}`).join('\n'));
}

main().catch((err) => {
  console.error(`\nFALHOU: ${err.message}`);
  process.exitCode = 1;
});
