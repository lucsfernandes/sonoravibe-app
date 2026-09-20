#!/usr/bin/env node
/**
 * Confere que toda rota documentada na coleção do Postman existe de fato na API.
 *
 * O outro lado do `build-postman.mjs`: aquele gera a documentação, este prova
 * que ela não está mentindo. Documentação de API envelhece em silêncio — uma
 * rota renomeada continua bonita no arquivo e quebrada na prática.
 *
 * Não precisa de sessão: no Nest, o roteamento acontece antes do guard, então
 * uma rota inexistente responde 404 "Cannot <MÉTODO>" mesmo sem autenticação,
 * enquanto uma rota real e protegida responde 401. É essa diferença que
 * usamos — e ela também confirma que as rotas protegidas estão protegidas.
 *
 * Uso: node scripts/verify-routes.mjs [url-da-api]
 */

import { readFileSync } from 'node:fs';

const API = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:3001';
const COLECAO = 'docs/postman/sonora.postman_collection.json';

const UUID_ZERO = '00000000-0000-0000-0000-000000000000';
const SUBSTITUICOES = {
  '{{songId}}': UUID_ZERO,
  '{{generationId}}': UUID_ZERO,
  '{{workspaceId}}': UUID_ZERO,
  '{{playlistId}}': UUID_ZERO,
  '{{styleId}}': UUID_ZERO,
  '{{commentId}}': UUID_ZERO,
  '{{handle}}': 'alguem',
};

const colecao = JSON.parse(readFileSync(COLECAO, 'utf8'));
const rotas = colecao.item.flatMap((pasta) =>
  pasta.item.map((item) => ({
    metodo: item.request.method,
    caminho: `/${item.request.url.path.join('/')}`,
    nome: item.name,
    pasta: pasta.name,
  })),
);

const ausentes = [];
const desprotegidas = [];
let conferidas = 0;
let puladas = 0;

for (const rota of rotas) {
  let caminho = rota.caminho;
  for (const [marcador, valor] of Object.entries(SUBSTITUICOES)) {
    caminho = caminho.split(marcador).join(valor);
  }

  // O SSE mantém a conexão aberta de propósito; não dá para conferir com fetch.
  if (caminho.includes('/stream')) {
    puladas += 1;
    continue;
  }

  const resposta = await fetch(`${API}${caminho}`, {
    method: rota.metodo,
    headers: { 'Content-Type': 'application/json' },
    body: ['POST', 'PATCH', 'PUT'].includes(rota.metodo) ? '{}' : undefined,
    redirect: 'manual',
  }).catch(() => null);

  if (!resposta) {
    ausentes.push(`${rota.metodo} ${caminho} — a API não respondeu`);
    continue;
  }

  conferidas += 1;
  const corpo = await resposta.text().catch(() => '');

  if (corpo.includes(`Cannot ${rota.metodo}`)) {
    ausentes.push(`${rota.metodo} ${caminho}  ("${rota.pasta} › ${rota.nome}")`);
  }

  const ehPublica =
    (item(rota)?.request?.auth?.type ?? '') === 'noauth' ||
    (item(rota)?.request?.description ?? '').includes('Não exige sessão');
  if (!ehPublica && resposta.status !== 401 && !corpo.includes(`Cannot ${rota.metodo}`)) {
    desprotegidas.push(`${rota.metodo} ${caminho} respondeu ${resposta.status} sem sessão`);
  }
}

function item(rota) {
  return colecao.item
    .find((p) => p.name === rota.pasta)
    ?.item.find((i) => i.name === rota.nome);
}

console.log(`API: ${API}`);
console.log(`Conferidas ${conferidas} rotas (${puladas} puladas por serem SSE).`);

if (ausentes.length > 0) {
  console.error(`\nDocumentadas mas inexistentes na API:\n  ${ausentes.join('\n  ')}`);
}
if (desprotegidas.length > 0) {
  console.error(
    `\nDeveriam exigir sessão e não exigiram:\n  ${desprotegidas.join('\n  ')}`,
  );
}
if (ausentes.length === 0 && desprotegidas.length === 0) {
  console.log('Todas existem, e as protegidas recusam quem não tem sessão.');
}

process.exitCode = ausentes.length + desprotegidas.length > 0 ? 1 : 0;
