/**
 * Cliente da API do Sonora.
 *
 * `credentials: 'include'` em toda chamada: a sessão é um cookie do Better Auth
 * numa origem diferente (3000 → 3001), e sem isso o navegador simplesmente não
 * manda o cookie — o sintoma seria "401 em tudo, mesmo logado".
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Saldo insuficiente — a interface oferece comprar créditos em vez de só falhar. */
  get semCredito(): boolean {
    return this.status === 402;
  }

  /** Recurso bloqueado pelo plano — a interface oferece o upgrade. */
  get bloqueadoPeloPlano(): boolean {
    return this.status === 403;
  }

  /** Campos inválidos, no formato que o backend devolve. */
  get campos(): { field: string; message: string }[] {
    const corpo = this.body as { issues?: { field: string; message: string }[] };
    return corpo?.issues ?? [];
  }
}

async function request<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const resposta = await buscar(`${API_URL}${caminho}`, {
    ...init,
    credentials: 'include',
    headers: {
      // Sem isto o download quebra. `GET /songs/:id/download` faz negociação de
      // conteúdo: com `Accept: application/json` devolve `{ url }`, e sem ele
      // responde 302 para o R2. O padrão do navegador é `*/*`, que não casa —
      // então a API redirecionava, o fetch seguia o redirect para outra origem
      // e o R2, que não manda cabeçalho de CORS, derrubava tudo num
      // "Failed to fetch" sem status nenhum. O usuário via "convertendo..." e
      // depois um erro genérico, para um arquivo que já estava pronto.
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const texto = await resposta.text();
  const corpo = texto ? seguroJson(texto) : null;

  if (!resposta.ok) {
    const mensagem =
      (corpo as { message?: string | string[] })?.message ?? `Erro ${resposta.status}`;
    throw new ApiError(
      Array.isArray(mensagem) ? mensagem.join(', ') : mensagem,
      resposta.status,
      corpo,
    );
  }

  return corpo as T;
}

/**
 * `fetch` que falha com erro legível.
 *
 * O `fetch` cru rejeita com um `TypeError: Failed to fetch` sem status e sem
 * corpo quando a rede cai, o CORS barra ou o DNS falha. Como todo chamador faz
 * `err instanceof ApiError ? err.message : 'Algo deu errado'`, essas falhas
 * viravam a mesma mensagem genérica — foi o que escondeu por semanas o bug do
 * download, em que a resposta era um redirect para o R2 e não um erro de rede.
 *
 * O status 0 é o convencional para "a requisição não chegou a ter resposta".
 */
async function buscar(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new ApiError(
      `Não consegui falar com o servidor (${new URL(url).pathname}). ` +
        'Pode ser conexão, CORS ou a API fora do ar.',
      0,
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }
}

function seguroJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    // Resposta não-JSON (um HTML de erro de proxy, por exemplo) não pode
    // derrubar a interface com um SyntaxError obscuro.
    return { message: texto.slice(0, 200) };
  }
}

/**
 * Baixa um ZIP de varias musicas.
 *
 * Nao passa pelo `request` porque a resposta de sucesso e binaria, nao JSON —
 * e porque a mesma rota devolve 202 com JSON enquanto o FFmpeg ainda converte
 * alguma das faixas. Quem chama precisa distinguir os dois casos.
 *
 * O ZIP vem por POST (a lista de ids nao cabe numa URL), entao nao da para usar
 * um link comum: o arquivo vira blob e um `<a download>` sintetico dispara o
 * salvamento. A URL do blob e revogada logo depois, senao o arquivo inteiro
 * fica preso na memoria da aba ate o usuario recarregar a pagina.
 */
export async function baixarLote(
  songIds: string[],
  format: string,
): Promise<{ baixou: true } | { baixou: false; mensagem: string; pendentes: number }> {
  const resposta = await buscar(`${API_URL}/songs/download-batch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds, format }),
  });

  if (resposta.status === 202) {
    const corpo = (await resposta.json()) as { message?: string; pending?: string[] };
    return {
      baixou: false,
      mensagem: corpo.message ?? '',
      pendentes: corpo.pending?.length ?? 0,
    };
  }

  if (!resposta.ok) {
    const texto = await resposta.text();
    const corpo = texto ? seguroJson(texto) : null;
    const mensagem = (corpo as { message?: string })?.message ?? `Erro ${resposta.status}`;
    throw new ApiError(mensagem, resposta.status, corpo);
  }

  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sonora-${format}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  return { baixou: true };
}

export const api = {
  get: <T>(caminho: string) => request<T>(caminho),
  post: <T>(caminho: string, corpo?: unknown) =>
    request<T>(caminho, { method: 'POST', body: JSON.stringify(corpo ?? {}) }),
  patch: <T>(caminho: string, corpo: unknown) =>
    request<T>(caminho, { method: 'PATCH', body: JSON.stringify(corpo) }),
  delete: <T>(caminho: string) => request<T>(caminho, { method: 'DELETE' }),
};

// ---------------------------------------------------------------- Tipos

export interface Musica {
  id: string;
  title: string;
  status: string;
  kind: string;
  durationMs: number;
  instrumental: boolean;
  stylePrompt: string | null;
  isPublic: boolean;
  playCount: number;
  likeCount: number;
  commentCount: number;
  workspaceId: string | null;
  audioUrl: string | null;
  coverUrl: string | null;
  createdAt: string;
}

export interface MusicaDetalhe extends Musica {
  lyrics: string | null;
  excludeStyles: string | null;
  providerId: string | null;
  parentSongId: string | null;
  allowRemixes: boolean;
  allowComments: boolean;
  likedByMe: boolean;
  /** Quem pediu e o dono da musica sao a mesma pessoa. */
  isMine: boolean;
  stems: { kind: string; url: string }[];
  downloads: {
    format: string;
    label: string;
    note: string;
    estimatedMb: number;
    allowed: boolean;
  }[];
}

export interface Pagina<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ItemExplore extends Musica {
  publishedAt: string | null;
  author: { handle: string; displayName: string; avatarUrl: string | null };
  likedByMe: boolean;
}

export interface Saldo {
  planCode: string;
  balance: { plan: number; pack: number; total: number; reserved: number };
  packValidityMonths: number;
  transactions: {
    amount: number;
    bucket: string;
    reason: string;
    description: string | null;
    balanceAfter: number;
    createdAt: string;
  }[];
}

export interface Workspace {
  id: string;
  name: string;
  isDefault: boolean;
  songCount: number;
}

export interface ProgressoGeracao {
  generationId: string;
  songId: string;
  status: string;
  progress: number;
  song?: { id: string; title: string; durationMs: number; audioUrl: string; coverUrl: string | null };
  error?: string;
}

export interface Comentario {
  id: string;
  body: string;
  timestampMs: number | null;
  parentId: string | null;
  createdAt: string;
  author: { handle: string; displayName: string; avatarUrl?: string | null };
  isMine: boolean;
}

export interface Comentarios {
  /** O autor pode desligar os comentários da própria música. */
  allowed: boolean;
  items: Comentario[];
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  songCount: number;
  createdAt: string;
}

export interface PlaylistDetalhe extends Playlist {
  songs: Musica[];
}

export interface EstiloSalvo {
  id: string;
  name: string;
  prompt: string;
  excludeStyles: string | null;
}
