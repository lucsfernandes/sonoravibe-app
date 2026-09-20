#!/usr/bin/env node
/**
 * Gera a coleção e os ambientes do Postman a partir de uma única lista de rotas.
 *
 * Existe como script (e não como JSON escrito à mão) para a documentação não
 * se descolar do código: quando uma rota nasce ou muda de status, muda aqui e
 * os dois arquivos são regerados.
 *
 * Uso: node scripts/build-postman.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'docs', 'postman');

/** pronto = existe e responde hoje. planejado = desenhado, ainda não implementado. */
const PRONTO = 'pronto';
const PLANEJADO = 'planejado';

const routes = [
  // ---------------------------------------------------------------- Saúde
  {
    folder: 'Saúde',
    name: 'Health check',
    method: 'GET',
    path: '/health',
    status: PRONTO,
    auth: false,
    description:
      'Verifica Postgres e Redis. Responde 503 quando uma dependência está fora, ' +
      'para o readiness probe do k3s tirar a réplica do balanceador.',
  },

  // ----------------------------------------------------------------- Auth
  {
    folder: 'Autenticação',
    name: 'Cadastro por e-mail',
    method: 'POST',
    path: '/api/auth/sign-up/email',
    status: PRONTO,
    auth: false,
    body: { name: 'Lucas Fernandes', email: 'lucas@exemplo.com', password: 'senha-forte-aqui' },
    description: 'Better Auth. Cria usuário, perfil, workspace padrão e carteira de créditos.',
  },
  {
    folder: 'Autenticação',
    name: 'Login por e-mail',
    method: 'POST',
    path: '/api/auth/sign-in/email',
    status: PRONTO,
    auth: false,
    body: { email: 'lucas@exemplo.com', password: 'senha-forte-aqui' },
  },
  {
    folder: 'Autenticação',
    name: 'Sessão atual',
    method: 'GET',
    path: '/api/auth/get-session',
    status: PRONTO,
    auth: false,
    description:
      'Responde 200 com `null` quando não há sessão — é o contrato do Better Auth, ' +
      'e é o que permite à interface decidir entre mostrar "entrar" ou o avatar.',
  },
  {
    folder: 'Autenticação',
    name: 'Sair',
    method: 'POST',
    path: '/api/auth/sign-out',
    status: PRONTO,
    auth: false,
    description: 'Idempotente: sair sem estar logado responde 200 em vez de erro.',
  },

  // ------------------------------------------------------------- Geração
  {
    folder: 'Geração',
    name: 'Criar música — aba Simple',
    method: 'POST',
    path: '/songs/generate',
    status: PRONTO,
    body: {
      mode: 'simple',
      prompt: 'pop rock brasileiro, violão e bateria ao vivo, clima de estrada',
      instrumental: false,
    },
    description:
      'Reserva os créditos, cria a música com status queued e enfileira o job. ' +
      'Responde 402 quando falta saldo e 403 quando a duração passa do limite do plano.',
  },
  {
    folder: 'Geração',
    name: 'Criar música — aba Advanced',
    method: 'POST',
    path: '/songs/generate',
    status: PRONTO,
    body: {
      mode: 'advanced',
      lyrics: '[Verse]\\nAcordei com o sol batendo na janela\\n\\n[Chorus]\\nVou seguir a estrada até o mar',
      title: 'Estrada até o mar',
      instrumental: false,
      controls: {
        styles: 'pop rock brasileiro, violão, bateria ao vivo',
        excludeStyles: 'distorção, autotune',
        vocalGender: 'male',
        bpm: 104,
        key: 'G',
        weirdness: 50,
        styleInfluence: 50,
        variety: 'high',
      },
    },
    description:
      'Sem durationSeconds a duração é automática (decidida pelo tamanho da letra), ' +
      'que foi o que soou mais natural nos testes. Exclusões de voz viram instrumental nativo.',
  },
  {
    folder: 'Geração',
    name: 'Criar som curto — aba Sounds',
    method: 'POST',
    path: '/songs/generate',
    status: PRONTO,
    body: { mode: 'sounds', prompt: 'stab de synth analógico quente', soundType: 'one-shot', bpm: 120, key: 'Cm' },
  },
  {
    folder: 'Geração',
    name: 'Progresso ao vivo (SSE)',
    method: 'GET',
    path: '/generations/stream',
    status: PRONTO,
    description:
      'Server-Sent Events. Emite queued, compiling_prompt, writing_lyrics, generating_audio, ' +
      'uploading, generating_cover e complete. O Postman mostra o stream; no navegador use EventSource.',
  },
  { folder: 'Geração', name: 'Status de uma geração', method: 'GET', path: '/generations/{{generationId}}', status: PRONTO },
  {
    folder: 'Geração',
    name: 'Cancelar geração',
    method: 'POST',
    path: '/generations/{{generationId}}/cancel',
    status: PRONTO,
    description: 'Cancela o job na fila e estorna os créditos reservados.',
  },
  {
    folder: 'Geração',
    name: 'Escrever letra com IA',
    method: 'POST',
    path: '/lyrics/generate',
    status: PRONTO,
    body: { brief: 'uma viagem de carro até o litoral, saudade e recomeço', language: 'pt-BR' },
  },
  {
    folder: 'Geração',
    name: 'Sugerir estilo',
    method: 'POST',
    path: '/styles/suggest',
    auth: false,
    status: PRONTO,
    body: { seed: 'synthwave melancólico' },
    description: 'O botão de dado da interface. Não consome crédito.',
  },

  // ------------------------------------------------------------- Músicas
  {
    folder: 'Músicas',
    name: 'Listar minhas músicas',
    method: 'GET',
    path: '/songs',
    query: { workspaceId: '{{workspaceId}}', cursor: '', limit: '20', filter: 'all' },
    status: PRONTO,
  },
  {
    folder: 'Músicas',
    name: 'Detalhe da música',
    method: 'GET',
    path: '/songs/{{songId}}',
    status: PRONTO,
    auth: false,
    description:
      'Música publicada abre sem login. Música privada de outra pessoa responde 404, ' +
      'e não 403: confirmar que o id existe já seria informação demais.',
  },
  {
    folder: 'Músicas',
    name: 'Atualizar música',
    method: 'PATCH',
    path: '/songs/{{songId}}',
    status: PRONTO,
    body: { title: 'Novo título', workspaceId: '{{workspaceId}}', allowRemixes: true, allowComments: true },
  },
  {
    folder: 'Músicas',
    name: 'Mover para a lixeira',
    method: 'DELETE',
    path: '/songs/{{songId}}',
    status: PRONTO,
    description: 'Exclusão lógica: some da biblioteca e o arquivo é apagado depois de 30 dias.',
  },
  {
    folder: 'Músicas',
    name: 'Publicar no Explore',
    method: 'POST',
    path: '/songs/{{songId}}/publish',
    status: PRONTO,
    body: { isPublic: true },
  },
  {
    folder: 'Músicas',
    name: 'Baixar num formato',
    method: 'GET',
    path: '/songs/{{songId}}/download',
    query: { format: 'mp3' },
    status: PRONTO,
    description:
      'Responde 302 para uma URL assinada do R2. Formatos: mp3, wav, flac, opus, m4a. ' +
      'O que ainda não existe é transcodificado sob demanda e fica 7 dias em cache. ' +
      'Free só baixa MP3; o limite vem do plano.',
  },
  {
    folder: 'Músicas',
    name: 'Baixar várias de uma vez (ZIP)',
    method: 'POST',
    path: '/songs/download-batch',
    status: PRONTO,
    body: { songIds: ['{{songId}}'], format: 'wav' },
    description: 'ZIP montado em streaming. Exclusivo de planos pagos.',
  },

  // ------------------------------------------------------------- Edição
  {
    folder: 'Edição',
    name: 'Estender a música',
    method: 'POST',
    path: '/songs/{{songId}}/extend',
    status: PRONTO,
    body: { addSeconds: 60 },
    description: 'Consome crédito: é uma nova chamada ao motor.',
  },
  { folder: 'Edição', name: 'Remix com outro estilo', method: 'POST', path: '/songs/{{songId}}/remix', status: PRONTO, body: { styles: 'versão acústica, violão e voz' } },
  { folder: 'Edição', name: 'Substituir um trecho', method: 'POST', path: '/songs/{{songId}}/replace-section', status: PRONTO, body: { startMs: 30000, endMs: 45000, styles: 'solo de guitarra' } },
  {
    folder: 'Edição',
    name: 'Edições sem IA',
    method: 'POST',
    path: '/songs/{{songId}}/edit',
    status: PRONTO,
    body: { operation: 'crop', startMs: 5000, endMs: 95000 },
    description:
      'crop, trim, fade-in, fade-out, speed, reverse e normalize. Roda em FFmpeg no nosso ' +
      'worker: não consome crédito nenhum.',
  },
  {
    folder: 'Edição',
    name: 'Separar stems',
    method: 'POST',
    path: '/songs/{{songId}}/stems',
    status: PRONTO,
    body: { kinds: ['vocals', 'drums', 'bass', 'other'] },
    description: 'Demucs no worker dedicado. Sem crédito, mas pesado: fila própria e só para planos pagos.',
  },
  { folder: 'Edição', name: 'Gerar capa', method: 'POST', path: '/songs/{{songId}}/cover-art', status: PRONTO, body: { prompt: 'estrada ao entardecer, estética retrô' } },

  // --------------------------------------------------------- Workspaces
  { folder: 'Biblioteca', name: 'Listar workspaces', method: 'GET', path: '/workspaces', status: PRONTO },
  { folder: 'Biblioteca', name: 'Criar workspace', method: 'POST', path: '/workspaces', status: PRONTO, body: { name: 'Nocturne.sh' } },
  { folder: 'Biblioteca', name: 'Renomear workspace', method: 'PATCH', path: '/workspaces/{{workspaceId}}', status: PRONTO, body: { name: 'Novo nome' } },
  { folder: 'Biblioteca', name: 'Listar playlists', method: 'GET', path: '/playlists', status: PRONTO },
  { folder: 'Biblioteca', name: 'Criar playlist', method: 'POST', path: '/playlists', status: PRONTO, body: { name: 'Madrugada', isPublic: false } },
  { folder: 'Biblioteca', name: 'Adicionar música à playlist', method: 'POST', path: '/playlists/{{playlistId}}/songs', status: PRONTO, body: { songId: '{{songId}}' } },
  { folder: 'Biblioteca', name: 'Estilos salvos', method: 'GET', path: '/styles', status: PRONTO },
  {
    folder: 'Biblioteca',
    name: 'Salvar estilo',
    method: 'POST',
    path: '/styles',
    status: PRONTO,
    body: { name: 'Meu lo-fi', prompt: 'lofi hip hop, piano, chuva', excludeStyles: 'distorção' },
  },
  { folder: 'Biblioteca', name: 'Excluir estilo', method: 'DELETE', path: '/styles/{{styleId}}', status: PRONTO },
  { folder: 'Biblioteca', name: 'Excluir workspace', method: 'DELETE', path: '/workspaces/{{workspaceId}}', status: PRONTO },
  { folder: 'Biblioteca', name: 'Detalhe da playlist', method: 'GET', path: '/playlists/{{playlistId}}', status: PRONTO },
  { folder: 'Biblioteca', name: 'Excluir playlist', method: 'DELETE', path: '/playlists/{{playlistId}}', status: PRONTO },
  {
    folder: 'Biblioteca',
    name: 'Reordenar playlist',
    method: 'PATCH',
    path: '/playlists/{{playlistId}}/order',
    status: PRONTO,
    body: { songIds: ['{{songId}}'] },
    description: 'Reescreve a ordem inteira — é o formato que o arrastar-e-soltar produz.',
  },
  {
    folder: 'Biblioteca',
    name: 'Remover música da playlist',
    method: 'DELETE',
    path: '/playlists/{{playlistId}}/songs/{{songId}}',
    status: PRONTO,
  },

  // ------------------------------------------------------------- Social
  { folder: 'Social', name: 'Explore', method: 'GET', path: '/explore', query: { tab: 'trending' }, status: PRONTO, auth: false },
  { folder: 'Social', name: 'Perfil público', method: 'GET', path: '/users/{{handle}}', status: PRONTO, auth: false },
  { folder: 'Social', name: 'Curtir', method: 'POST', path: '/songs/{{songId}}/like', status: PRONTO },
  { folder: 'Social', name: 'Comentários', method: 'GET', path: '/songs/{{songId}}/comments', status: PRONTO, auth: false },
  {
    folder: 'Social',
    name: 'Apagar comentário',
    method: 'DELETE',
    path: '/songs/{{songId}}/comments/{{commentId}}',
    status: PRONTO,
    description: 'Apaga quem escreveu — ou o dono da música, que modera o próprio espaço.',
  },
  { folder: 'Social', name: 'Comentar', method: 'POST', path: '/songs/{{songId}}/comments', status: PRONTO, body: { body: 'Muito boa!', timestampMs: 42000 } },
  { folder: 'Social', name: 'Seguir criador', method: 'POST', path: '/users/{{handle}}/follow', status: PRONTO },
  {
    folder: 'Social',
    name: 'Registrar reprodução',
    method: 'POST',
    path: '/songs/{{songId}}/play',
    status: PRONTO,
    body: { listenedMs: 45000 },
    auth: false,
    description: 'Alimenta o ranking do Explore. Deduplicado por janela de 30s.',
  },

  // ------------------------------------------------------ Créditos e planos
  {
    folder: 'Créditos e cobrança',
    name: 'Saldo e extrato',
    method: 'GET',
    path: '/credits',
    status: PRONTO,
    description: 'Saldo do plano, saldo avulso, reservado e o extrato do ledger.',
  },
  { folder: 'Créditos e cobrança', name: 'Planos e pacotes', method: 'GET', path: '/plans', status: PRONTO, auth: false },
  { folder: 'Créditos e cobrança', name: 'Assinar um plano', method: 'POST', path: '/billing/subscribe', status: PRONTO, body: { planCode: 'pro', method: 'pix' } },
  { folder: 'Créditos e cobrança', name: 'Comprar pacote avulso', method: 'POST', path: '/billing/packs/pack_1500/purchase', status: PRONTO, body: { method: 'pix' } },
  {
    folder: 'Créditos e cobrança',
    name: 'Cancelar assinatura',
    method: 'POST',
    path: '/billing/cancel',
    status: PRONTO,
    description: 'O acesso vale até o fim do período já pago: cancelar não é estornar.',
  },
  {
    folder: 'Créditos e cobrança',
    name: 'Webhook do Asaas',
    method: 'POST',
    path: '/webhooks/asaas',
    status: PRONTO,
    auth: false,
    headers: { 'asaas-access-token': '{{asaasWebhookToken}}' },
    body: { event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_000001', status: 'CONFIRMED' } },
    description:
      'Concede os créditos ao confirmar o pagamento. Idempotente pelo provider_ref, ' +
      'porque o Asaas reenvia o evento quando não recebe 200.',
  },
];

function toPostmanItem(route) {
  const headers = [
    ...(route.body ? [{ key: 'Content-Type', value: 'application/json' }] : []),
    ...Object.entries(route.headers ?? {}).map(([key, value]) => ({ key, value })),
  ];
  const query = Object.entries(route.query ?? {}).map(([key, value]) => ({ key, value: String(value) }));
  const pathSegments = route.path.replace(/^\//, '').split('/');

  return {
    name: `${route.name}${route.status === PLANEJADO ? ' (planejado)' : ''}`,
    request: {
      method: route.method,
      header: headers,
      ...(route.body ? { body: { mode: 'raw', raw: JSON.stringify(route.body, null, 2), options: { raw: { language: 'json' } } } } : {}),
      url: {
        raw: `{{apiUrl}}${route.path}${query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''}`,
        host: ['{{apiUrl}}'],
        path: pathSegments,
        ...(query.length ? { query } : {}),
      },
      description:
        `Status: ${route.status === PRONTO ? 'implementado e respondendo' : 'planejado, ainda não implementado'}.` +
        (route.description ? `\n\n${route.description}` : '') +
        (route.auth === false ? '\n\nNão exige sessão.' : ''),
      ...(route.auth === false ? { auth: { type: 'noauth' } } : {}),
    },
  };
}

const folders = [];
for (const route of routes) {
  let folder = folders.find((f) => f.name === route.folder);
  if (!folder) {
    folder = { name: route.folder, item: [] };
    folders.push(folder);
  }
  folder.item.push(toPostmanItem(route));
}

const collection = {
  info: {
    _postman_id: '9a1f4a3e-5b6c-4d7e-8f90-s0n0ra00001',
    name: 'Sonora — API',
    description:
      'Rotas da API do Sonora (geração de música com IA).\n\n' +
      'HOJE só `GET /health` está implementado; todo o resto está marcado como ' +
      '"(planejado)" e serve como contrato do que está sendo construído.\n\n' +
      'Autenticação: sessão em cookie do Better Auth. No Postman, faça login em ' +
      '"Autenticação > Login por e-mail" e o cookie passa a acompanhar as demais chamadas.\n\n' +
      'Gerado por `node scripts/build-postman.mjs` — edite o script, não este arquivo.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [{ key: 'apiUrl', value: 'http://localhost:3001' }],
  item: folders,
};

const environments = [
  {
    name: 'Sonora — Local',
    slug: 'sonora-local',
    values: [
      { key: 'apiUrl', value: 'http://localhost:3001', enabled: true },
      { key: 'webUrl', value: 'http://localhost:3000', enabled: true },
      { key: 'songId', value: '', enabled: true },
      { key: 'generationId', value: '', enabled: true },
      { key: 'workspaceId', value: '', enabled: true },
      { key: 'playlistId', value: '', enabled: true },
      { key: 'handle', value: 'lucsfernandes', enabled: true },
    { key: 'styleId', value: '', enabled: true },
    { key: 'commentId', value: '', enabled: true },
      { key: 'asaasWebhookToken', value: '', type: 'secret', enabled: true },
    ],
  },
  {
    name: 'Sonora — Produção',
    slug: 'sonora-producao',
    values: [
      { key: 'apiUrl', value: 'https://api.sonoravibe.com', enabled: true },
      { key: 'webUrl', value: 'https://sonoravibe.com', enabled: true },
      { key: 'songId', value: '', enabled: true },
      { key: 'generationId', value: '', enabled: true },
      { key: 'workspaceId', value: '', enabled: true },
      { key: 'playlistId', value: '', enabled: true },
      { key: 'handle', value: '', enabled: true },
    { key: 'styleId', value: '', enabled: true },
    { key: 'commentId', value: '', enabled: true },
      { key: 'asaasWebhookToken', value: '', type: 'secret', enabled: true },
    ],
  },
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'sonora.postman_collection.json'), `${JSON.stringify(collection, null, 2)}\n`);
for (const env of environments) {
  const file = `${env.slug}.postman_environment.json`;
  writeFileSync(
    join(OUT_DIR, file),
    `${JSON.stringify({ id: `env-${file}`, name: env.name, values: env.values, _postman_variable_scope: 'environment' }, null, 2)}\n`,
  );
}

const prontas = routes.filter((r) => r.status === PRONTO).length;
console.log(
  `Coleção gerada em docs/postman/: ${routes.length} rotas (${prontas} implementadas, ${routes.length - prontas} planejadas) em ${folders.length} pastas.`,
);
