/**
 * Geração da capa por modelo de imagem, via OpenRouter. É a RESERVA: a capa
 * sai primeiro do FLUX.2 [klein] no nosso endpoint (flux-cover.ts).
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
type SongForCover = {
  title: string;
  stylePrompt: string | null;
  lyrics: string | null;
  instrumental: boolean;
};

/** O começo da letra, sem as marcações de seção ([Verso], [Refrão]). */
function lyricsExcerpt(song: SongForCover): string | null {
  if (song.instrumental || !song.lyrics) return null;
  const trecho = song.lyrics
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha && !/^\[.*\]$/.test(linha))
    .slice(0, 6)
    .join(' / ')
    .slice(0, 300);
  return trecho || null;
}

export function coverPromptFor(song: SongForCover): string {
  const partes = [song.title.trim()];

  const estilo = song.stylePrompt?.trim();
  if (estilo && estilo !== song.title.trim()) partes.push(`Estilo: ${estilo}`);

  const trecho = lyricsExcerpt(song);
  if (trecho) partes.push(`Tema da letra: ${trecho}`);

  return partes.join('. ');
}

/**
 * O que um modelo de imagem que DESENHA TEXTO pode receber: o estilo e a letra
 * separados, sem o título. Medido com o FLUX.2 [klein] (docs/benchmarks/capas):
 * com o título e versos no pedido, ele escreveu os dois na capa, com erros; com
 * o estilo e uma cena descrita, não escreveu nada. A letra vira cena antes de
 * chegar lá (flux-cover.ts).
 */
export interface CoverVisual {
  style: string | null;
  lyrics: string | null;
}

export function coverVisualFor(song: SongForCover): CoverVisual {
  const estilo = song.stylePrompt?.trim();
  return { style: estilo || null, lyrics: lyricsExcerpt(song) };
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
