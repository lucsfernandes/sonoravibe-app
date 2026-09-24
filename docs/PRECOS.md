# Preços: versões do motor, créditos e planos

> Revisado em 2026-09-24, junto com o seletor de versão (v1, v1.5, v2.0, v2.5). A fonte da
> verdade é o código: `packages/shared/src/models.ts` (versões e créditos) e
> `packages/shared/src/plans.ts` (planos). O teste `apps/worker/test/precos.test.ts` falha se um
> preço deixar a GPU passar de 30% da receita.

## 1. As versões

| Versão | Modelo (ACE-Step) | Passos | Reescrita do caption | Endpoint da RunPod |
|---|---|---|---|---|
| **v1** | XL-turbo + LM 1.7B | 8 | ligada | turbo |
| **v1.5** | XL-turbo + LM 1.7B | 8 | desligada | turbo |
| **v2.0** | XL-SFT + LM 1.7B | 32 | desligada | SFT |
| **v2.5** | XL-SFT + LM 1.7B | 50 | desligada | SFT |

Escolhidas por escuta (`docs/BENCHMARK-MIDNIGHT.md`): v1 = a configuração aprovada em
2026-09-23; v2.5 = "S50N", a de melhor construção e harmonia; v2.0 = 32 passos, a opção mais barata
do SFT. **A v1.5 (XL-turbo sem reescrita) ainda não foi ouvida**: é a combinação que funcionou no
XL-SFT aplicada ao turbo.

Só música nova escolhe versão. Remix, cover, trecho e a aba Sons rodam sempre na v1.

## 2. Custo de GPU

Medido na RunPod, GPU **L4** (classe de 24 GB, US$ 0,69/h no serverless), pedido de **duas
faixas**, com o corte de silêncio e o fade no fim:

| Versão | 2 min | 6 min | Fonte |
|---|---|---|---|
| v1 / v1.5 | US$ 0,0071 | ~US$ 0,021 (proporcional) | REF, 2026-09-24 |
| v2.0 | US$ 0,0159 | ~US$ 0,048 (proporcional) | S32N |
| v2.5 | US$ 0,0211 | **US$ 0,0629** (medido) | S50N, S50N360 |

Para o preço, soma-se **30% de folga**: cold start (40–80 s de carga), os 5 s ociosos depois de
cada job, a capa e a letra.

## 3. Créditos por pedido

Duas faixas por pedido, um preço só. Faixa de duração pela duração pedida; **no automático, cobra
como "até 4 min"** (uma música cantada costuma ficar entre 3 e 4 min).

| Versão | até 2 min | até 4 min | até 6 min |
|---|---|---|---|
| v1 / v1.5 | **10** | 20 | 30 |
| v2.0 | 20 | 40 | 60 |
| v2.5 | 26 | 52 | 78 |

Outras operações não mudaram: som curto 5, remix 10, trecho 10, capa nova 2, letra por IA 1.

**Como os números saíram:** custo de GPU com a folga, em reais (câmbio assumido de
**R$ 5,50/US$**), dividido por 30% (margem bruta mínima de 70%) e pelo crédito mais barato que
vendemos (~R$ 0,0198, o do Premier). Arredondado para cima.

## 4. Planos

Preço em reais **mantido**; créditos **reduzidos** para que o crédito valha ~R$ 0,02 em todos os
planos.

| Plano | Preço | Créditos antes | Créditos agora | R$ por crédito | Pedidos v1 de 2 min | Pedidos v2.5 de 6 min |
|---|---|---|---|---|---|---|
| Free | R$ 0 | 30/mês | 30/mês | — | 3 | — (limite de 2 min) |
| Pro | R$ 39 | 5.000 | **2.000** | R$ 0,0195 | 200 | — (limite de 4 min; 38 de 4 min) |
| Premier | R$ 99 | 20.000 | **5.000** | R$ 0,0198 | 500 | 64 |

Pacotes avulsos não mudaram (R$ 0,030 a R$ 0,040 por crédito, acima do valor dos planos).

**Por que reduzir créditos e não subir o preço:** mudar o valor em reais exigiria alterar as
assinaturas já abertas no Asaas. Mudar os créditos só afeta a próxima renovação.

**O que isso muda para quem já assina:** o saldo atual continua. A partir da próxima renovação, o
Pro recebe 2.000 em vez de 5.000, e o Premier 5.000 em vez de 20.000. Vale avisar os assinantes
antes.

## 5. Aplicar em produção

A API só semeia a tabela `plans` quando ela está vazia, e nunca sobrescreve. Depois do deploy:

```bash
kubectl exec -i -n <namespace> <pod-do-postgres> -- psql -U <usuario> <banco> \
  < packages/db/scripts/ajustar-planos-2026-09.sql
```

## 6. Riscos

- **Câmbio.** Se o dólar subir, a margem cai na mesma proporção. Revisar `BRL_POR_USD` no teste.
- **GPU sorteada.** A L4 é a mais lenta da classe; os custos acima são o pior caso da classe.
- **Duração automática.** Cobrada como 4 min; uma música no automático que passe de 4 min dá
  menos margem.
- **Reserva no Lyria.** Se a RunPod falhar, o Lyria atende a US$ 0,08 por faixa: nesse caso a
  margem de uma v1 de 2 min fica negativa. Acompanhe a taxa de fallback.
