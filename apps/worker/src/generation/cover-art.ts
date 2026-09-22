/**
 * Geração da capa por modelo de imagem, via OpenRouter.
 *
 * A capa é opcional por natureza: a música existe e toca sem ela. Por isso as
 * falhas aqui são reportadas ao chamador como `null`, e não como exceção — uma
 * capa que não saiu não pode invalidar uma geração que custou crédito.
 */

export interface CoverArtConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  siteUrl: string;
  appName: string;
}

export interface CoverArtResult {
  data: Buffer;
  mimeType: string;
}

/**
 * O que o modelo de imagem recebe quando a capa sai junto com a música:
 * título, estilo e o começo da letra.
 *
 * Só o estilo dá capa genérica — "forró" vira sanfona em toda música. A letra
 * traz o tema (o quintal, a estrada, a pessoa), que é o que faz a capa parecer
 * desta música e não de qualquer outra do mesmo gênero. Vai só o começo: o
 * modelo não precisa dos três refrões, e prompt comprido custa token à toa.
 */
export function coverPromptFor(song: {
  title: string;
  stylePrompt: string | null;
  lyrics: string | null;
  instrumental: boolean;
}): string {
  const partes = [song.title.trim()];

  const estilo = song.stylePrompt?.trim();
  if (estilo && estilo !== song.title.trim()) partes.push(`Estilo: ${estilo}`);

  if (!song.instrumental && song.lyrics) {
    const trecho = song.lyrics
      .split('\n')
      .map((linha) => linha.trim())
      // Marcações de seção ([Verso], [Refrão]) não descrevem imagem nenhuma.
      .filter((linha) => linha && !/^\[.*\]$/.test(linha))
      .slice(0, 6)
      .join(' / ')
      .slice(0, 300);
    if (trecho) partes.push(`Tema da letra: ${trecho}`);
  }

  return partes.join('. ');
}

export class CoverArtGenerator {
  constructor(private readonly config: CoverArtConfig) {}

  get available(): boolean {
    return Boolean(this.config.apiKey);
  }

  async generate(prompt: string): Promise<CoverArtResult | null> {
    if (!this.config.apiKey) return null;

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        'HTTP-Referer': this.config.siteUrl,
        'X-Title': this.config.appName,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          {
            role: 'user',
            content:
              `Capa de álbum quadrada para uma música com este estilo: ${prompt}. ` +
              'Arte visual apenas, sem texto, sem letras, sem logotipo.',
          },
        ],
        modalities: ['image', 'text'],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      throw new Error(
        `OpenRouter respondeu ${response.status} na capa: ${(await response.text()).slice(0, 200)}`,
      );
    }

    const json = (await response.json()) as {
      choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    };
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) return null;

    // O modelo devolve a imagem como data URI base64, não como link.
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    return { mimeType: match[1], data: Buffer.from(match[2], 'base64') };
  }
}
