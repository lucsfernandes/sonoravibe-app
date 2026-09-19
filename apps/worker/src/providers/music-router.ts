import {
  MusicProviderError,
  type MusicGenerationRequest,
  type MusicGenerationResult,
  type MusicProvider,
} from '@sonora/shared';

/**
 * Escolhe o motor e cai na reserva quando o principal falha.
 *
 * Principal: ACE-Step na RunPod (~$0,008/música, até 8 min).
 * Reserva:   Lyria via OpenRouter ($0,08/música, até ~3 min).
 *
 * Regras:
 *  - Só tenta um provider que suporta o tipo de geração e a duração pedida.
 *    Uma música de 6 min não tem reserva: o Lyria para em ~3 min.
 *  - Cai na reserva apenas em erro RETENTÁVEL (fila sem GPU, timeout, 5xx,
 *    worker caiu). Erro não retentável é problema do pedido ou da configuração
 *    — trocar de motor esconderia um bug e pagaria 10x mais por isso.
 *  - Toda queda para a reserva é reportada via `onFallback`: o custo por música
 *    sobe ~10x, e a arquitetura prevê alerta quando a taxa passar de 10%.
 */

export interface RoutedGenerationResult extends MusicGenerationResult {
  /** Provider que efetivamente gerou — vai para Generation.providerId. */
  servedBy: string;
  /** Presente quando a reserva atendeu: por que o principal falhou. */
  fallbackReason?: string;
}

export interface FallbackEvent {
  from: string;
  to: string;
  reason: string;
  kind: MusicGenerationRequest['kind'];
}

export class MusicRouter {
  constructor(
    private readonly primary: MusicProvider,
    private readonly fallback: MusicProvider | null,
    private readonly onFallback: (event: FallbackEvent) => void = () => {},
  ) {}

  /** Providers capazes de atender o pedido, na ordem de preferência. */
  candidatesFor(req: MusicGenerationRequest): MusicProvider[] {
    return [this.primary, this.fallback].filter(
      (p): p is MusicProvider => p !== null && canServe(p, req),
    );
  }

  /** Custo estimado no provider principal que atenderia o pedido. */
  estimateCredits(req: MusicGenerationRequest): number {
    const [first] = this.candidatesFor(req);
    if (!first) throw noProvider(req);
    return first.estimateCredits(req);
  }

  async generate(req: MusicGenerationRequest): Promise<RoutedGenerationResult> {
    const candidates = this.candidatesFor(req);
    if (candidates.length === 0) throw noProvider(req);

    let lastError: unknown;
    for (const [index, provider] of candidates.entries()) {
      try {
        const result = await provider.generate(req);
        return {
          ...result,
          servedBy: provider.id,
          fallbackReason: index > 0 ? describe(lastError) : undefined,
        };
      } catch (err) {
        lastError = err;
        const retryable = err instanceof MusicProviderError ? err.retryable : true;
        const next = candidates[index + 1];
        if (!retryable || !next) throw err;
        this.onFallback({ from: provider.id, to: next.id, reason: describe(err), kind: req.kind });
      }
    }
    // Inalcançável: o laço sempre retorna ou lança.
    throw lastError;
  }
}

function canServe(provider: MusicProvider, req: MusicGenerationRequest): boolean {
  if (!provider.supportedKinds.includes(req.kind)) return false;
  return (req.durationSeconds ?? 0) <= provider.maxDurationSeconds;
}

function noProvider(req: MusicGenerationRequest): MusicProviderError {
  const duration = req.durationSeconds ? ` com ${req.durationSeconds}s` : '';
  return new MusicProviderError(`Nenhum motor atende '${req.kind}'${duration}.`, 'router', false);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
