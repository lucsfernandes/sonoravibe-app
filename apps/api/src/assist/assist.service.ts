import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CREDIT_COSTS, GENRES, INSTRUMENTS, MOODS, PRODUCTION } from '@sonora/shared';
import { CreditsService, InsufficientCreditsError } from '../credits/credits.service';
import { CONFIG, type AppConfig } from '../config/env';
import { insufficientCredits } from '../songs/songs.service';

export interface LyricsResult {
  title: string;
  lyrics: string;
  creditsCharged: number;
}

/**
 * Apoio de escrita por LLM: letra e sugestão de estilo.
 *
 * Roda síncrono, sem fila: são poucos segundos, e mandar o usuário esperar um
 * job para receber quatro versos seria pior que a espera. A cobrança acontece
 * depois do sucesso — se o modelo falhar, ninguém paga.
 */
@Injectable()
export class AssistService {
  private readonly logger = new Logger(AssistService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly credits: CreditsService,
  ) {}

  async writeLyrics(
    userId: string,
    brief: string,
    language: string,
    instrumentalHint?: string,
  ): Promise<LyricsResult> {
    // O saldo é conferido antes de gastar a chamada ao modelo: pagar pelo token
    // e só então descobrir que o usuário não tinha crédito é prejuízo nosso.
    const saldo = await this.credits.balanceOf(userId);
    if (saldo.total < CREDIT_COSTS.lyrics) {
      throw insufficientCredits(new InsufficientCreditsError(CREDIT_COSTS.lyrics, saldo.total));
    }

    const idioma = language.startsWith('pt') ? 'português do Brasil' : 'inglês';
    const resposta = await this.complete(
      [
        {
          role: 'system',
          content:
            `Você escreve letras de música em ${idioma}. Devolva APENAS a letra, ` +
            'marcada com [Verse], [Chorus], [Bridge] e [Outro], e na primeira linha ' +
            'um título entre colchetes no formato [Title: ...]. Sem explicações.',
        },
        {
          role: 'user',
          content: instrumentalHint ? `${brief}\n\nEstilo: ${instrumentalHint}` : brief,
        },
      ],
      1200,
    );

    const { title, lyrics } = separarTitulo(resposta);

    await this.credits.spend(userId, CREDIT_COSTS.lyrics, 'generation', 'Letra escrita por IA');

    return { title, lyrics, creditsCharged: CREDIT_COSTS.lyrics };
  }

  /**
   * Sugestão de estilo — o botão de dado da interface. Não custa crédito.
   *
   * Sem chave do OpenRouter, sorteia do catálogo local em vez de falhar: o
   * botão continua útil e ninguém fica travado por causa de configuração.
   *
   * Sem `viaLlm` também vai pro catálogo. A rota é pública e o modelo é pago:
   * se o anônimo chegasse ao LLM, qualquer um na internet queimaria o saldo da
   * OpenRouter em loop, sem nem criar conta.
   */
  async suggestStyle(
    seed?: string,
    { viaLlm = false }: { viaLlm?: boolean } = {},
  ): Promise<{ styles: string; source: 'llm' | 'catalogue' }> {
    if (!viaLlm || !this.config.OPENROUTER_API_KEY) {
      return { styles: sortearDoCatalogo(), source: 'catalogue' };
    }

    try {
      const resposta = await this.complete(
        [
          {
            role: 'system',
            content:
              'Você sugere estilos musicais para geração de música por IA. Responda com ' +
              'uma única linha de 4 a 8 descritores separados por vírgula (gênero, ' +
              'instrumentos, clima, andamento). Sem explicação, sem aspas.',
          },
          {
            role: 'user',
            content: seed
              ? `Sugira um estilo a partir de: ${seed}`
              : 'Sugira um estilo interessante e específico.',
          },
        ],
        120,
      );
      return { styles: resposta.split('\n')[0].trim().slice(0, 300), source: 'llm' };
    } catch (err) {
      this.logger.warn(`Sugestão via LLM falhou, usando o catálogo: ${(err as Error).message}`);
      return { styles: sortearDoCatalogo(), source: 'catalogue' };
    }
  }

  /**
   * Aprimora o prompt de estilo escrito pelo usuário.
   *
   * O modelo recebe o texto e devolve uma linha só, mais específica: gênero,
   * instrumentação, clima, andamento e produção. Não inventa um estilo novo:
   * o pedido é expandir o que já está lá, na língua em que foi escrito. Sem
   * chave configurada, responde 503 em vez de fingir um resultado.
   */
  async enhanceStyle(
    userId: string,
    styles: string,
    language: string,
  ): Promise<{ styles: string; source: 'llm' }> {
    const idioma = language.startsWith('pt') ? 'português do Brasil' : 'inglês';
    const resposta = await this.complete(
      [
        {
          role: 'system',
          content:
            `Você aprimora descrições de estilo para geração de música por IA, em ${idioma}. ` +
            'Receba a descrição do usuário e devolva UMA linha só, de 8 a 16 descritores ' +
            'separados por vírgula, mantendo tudo o que ele pediu e acrescentando o que ' +
            'falta: gênero, subgênero, instrumentos principais, clima, andamento aproximado, ' +
            'tipo de voz (se houver) e detalhes de produção. Sem explicação, sem aspas, sem ' +
            'ponto final.',
        },
        { role: 'user', content: styles },
      ],
      200,
    );
    this.logger.log(`Estilo aprimorado para ${userId}`);
    return { styles: resposta.split('\n')[0].trim().slice(0, 1000), source: 'llm' };
  }

  private async complete(
    messages: { role: string; content: string }[],
    maxTokens: number,
  ): Promise<string> {
    if (!this.config.OPENROUTER_API_KEY) {
      throw new ServiceUnavailableException(
        'Escrita por IA indisponível: OPENROUTER_API_KEY não configurada.',
      );
    }

    const response = await fetch(`${this.config.OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.OPENROUTER_API_KEY}`,
        // O OpenRouter usa estes dois para atribuição de uso na conta.
        'HTTP-Referer': this.config.OPENROUTER_SITE_URL,
        'X-Title': this.config.OPENROUTER_APP_NAME,
      },
      body: JSON.stringify({
        model: this.config.OPENROUTER_TEXT_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const texto = await response.text();
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `OpenRouter respondeu ${response.status}: ${texto.slice(0, 200)}`,
      );
    }

    const json = JSON.parse(texto) as {
      choices?: { message?: { content?: string } }[];
    };
    const conteudo = json.choices?.[0]?.message?.content?.trim();
    if (!conteudo) {
      throw new ServiceUnavailableException('O modelo respondeu vazio.');
    }
    return conteudo;
  }
}

/** Separa o `[Title: ...]` da primeira linha do resto da letra. */
function separarTitulo(resposta: string): { title: string; lyrics: string } {
  const match = resposta.match(/^\s*\[Title:\s*(.+?)\]\s*/i);
  if (!match) return { title: 'Sem título', lyrics: resposta.trim() };
  return {
    title: match[1].trim().slice(0, 120),
    lyrics: resposta.slice(match[0].length).trim(),
  };
}

/**
 * Sorteio local: um de cada grupo, para a sugestão sair coerente.
 * Quatro gêneros aleatórios juntos viram uma descrição contraditória.
 */
function sortearDoCatalogo(): string {
  const sortear = <T>(lista: readonly T[]): T => lista[Math.floor(Math.random() * lista.length)];
  return [sortear(GENRES), sortear(MOODS), sortear(INSTRUMENTS), sortear(PRODUCTION)]
    .map((tag) => tag.pt)
    .join(', ');
}
