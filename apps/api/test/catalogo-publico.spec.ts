import { describe, expect, it, vi } from 'vitest';
import { BillingService } from '../src/billing/billing.service';

/**
 * O catálogo é público. O estado da infraestrutura, não.
 *
 * `GET /plans` roda sem login porque a página de vendas precisa dele. O campo
 * `source` diz se os planos vieram do banco ou do fallback em código, e
 * `source: 'codigo'` significa "a tabela `plans` sumiu ou o Postgres não
 * responde".
 *
 * Numa resposta sem autenticação isso é reconhecimento de graça: avisa a quem
 * estiver sondando que o sistema está degradado agora. Preço é público; saúde
 * interna não é.
 */

/** Monta o serviço com as dependências trocadas por dublês. */
function montar() {
  const planos = {
    listar: vi.fn().mockResolvedValue([
      {
        code: 'free',
        name: 'Free',
        priceBrl: 0,
        monthlyCredits: 0,
        features: { maxDurationSeconds: 120 },
      },
    ]),
    origemAtual: vi.fn().mockResolvedValue('codigo'),
  };

  const servico = new BillingService(
    {} as never,
    { id: 'fake' } as never,
    {} as never,
    {} as never,
    planos as never,
    {} as never,
    { MUSIC_PROVIDER: 'lyria' } as never,
  );

  return { servico, planos };
}

describe('catálogo de planos', () => {
  it('não conta ao anônimo de onde vieram os planos', async () => {
    const { servico, planos } = montar();

    const r = await servico.catalogue();

    expect(r).not.toHaveProperty('source');
    // Nem sequer consulta: o valor não deve existir para vazar por acidente
    // num log ou numa serialização futura.
    expect(planos.origemAtual).not.toHaveBeenCalled();
  });

  it('conta para quem está logado, que é quem opera o sistema', async () => {
    const { servico } = montar();

    const r = await servico.catalogue({ comDiagnostico: true });

    expect(r).toHaveProperty('source', 'codigo');
  });

  it('serve os planos igual nos dois casos', async () => {
    // A proteção não pode mudar o que a página de vendas recebe.
    const { servico } = montar();

    const anonimo = await servico.catalogue();
    const logado = await servico.catalogue({ comDiagnostico: true });

    expect(anonimo.plans).toEqual(logado.plans);
    expect(anonimo.packs).toEqual(logado.packs);
  });
});
