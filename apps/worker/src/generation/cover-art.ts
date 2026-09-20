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
