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
  const resposta = await fetch(`${API_URL}${caminho}`, {
    ...init,
    credentials: 'include',
    headers: {
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

function seguroJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    // Resposta não-JSON (um HTML de erro de proxy, por exemplo) não pode
    // derrubar a interface com um SyntaxError obscuro.
    return { message: texto.slice(0, 200) };
  }
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
