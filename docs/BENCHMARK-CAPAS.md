# Capas com FLUX.2 [klein] 4B — validação

> 2026-09-24, RunPod, GPU **NVIDIA L4** (classe de 24 GB), `apps/image-worker/handler.py` real, com
> a mesma imagem base e as mesmas dependências do Dockerfile. Custo das três rodadas: **US$ 0,08**.
> Pods destruídos (zero na conta ao final). Imagens em `docs/benchmarks/capas*/imagens/` (fora do git).

## Por que o klein

Pedido original: FLUX.1 [schnell]. Trocado pelo **FLUX.2 [klein] 4B**, do mesmo fabricante e com a
mesma licença (**Apache 2.0**, uso comercial), porque:

- **não pede token do Hugging Face** (o schnell é "gated"); baixa como o ACE-Step;
- **cabe inteiro numa GPU de 24 GB em bf16**, sem a quantização NF4 que o schnell exigiria;
- ~16 GB de pesos contra ~34 GB: imagem e cold start menores.

## Números (L4)

| Medida | Valor |
|---|---|
| Carga do modelo (cold start, pesos já no disco) | **11 s** |
| Tempo por capa 1024×1024, 4 passos | **4,2 s** |
| VRAM no pico | 20,3 GB de 22 GB |
| Tamanho do JPEG (qualidade 90) | 77–355 KB |
| Custo por capa (serverless, US$ 0,69/h) | **~US$ 0,0008** |
| Custo de um cold start | ~US$ 0,002 |

Para comparar: o pedido de música mais barato (v1, 2 min) custa ~US$ 0,007 de GPU. Duas capas por
pedido somam ~US$ 0,0016.

## O que a validação encontrou

**Rodada 1 — pedido como o worker montava** (título + estilo + trecho da letra):

- Instrumentais (sem letra): boas capas, sem texto.
- **Com letra: o modelo escreveu o título e versos na capa, com erros** ("QUINTAL A noie",
  "ESTRaJ Aâţ o mar"). "Sem texto" no pedido não adianta: o pedido carregava o texto, e o FLUX
  desenha o que lê.

**Rodada 2 — dois pedidos sem título e sem versos:**

| Variante | Resultado |
|---|---|
| A: só o estilo | sem texto; capa correta, mas **genérica** do gênero |
| B: estilo + a letra descrita como cena | sem texto; capa **específica da música** (o quintal ao luar com o violão na parede; a estrada até o mar ao amanhecer) |

Nos dois, o que sobra de "texto" é, no máximo, uma marca inventada num instrumento.

## Como ficou no worker

1. O processador passa ao FLUX o estilo e a letra **separados, sem o título**
   (`coverVisualFor`, em `cover-art.ts`).
2. O modelo de texto do OpenRouter (o mesmo das letras, `OPENROUTER_TEXT_MODEL`) transforma o trecho
   da letra numa frase em inglês com elementos visuais concretos, sem nomes nem citações
   (`openRouterSceneWriter`).
3. O FLUX recebe: "sem texto" + a cena + o estilo (variante B).
4. Se o escritor de cena falhar, a capa sai só com o estilo (variante A), ainda sem texto.
5. Se o FLUX falhar ou passar de 150 s, o modelo de imagem do OpenRouter desenha (a reserva
   escolhida).
6. Capa pedida pelo usuário com texto próprio vai como ele escreveu (e pode ter texto, se ele pedir).

## O que não foi testado

- A cena escrita **pelo modelo de texto de verdade**: na rodada 2 a cena foi escrita à mão. O
  formato do pedido ao modelo está coberto por teste, mas a qualidade da cena só aparece em uso.
- Estilos fora dos quatro testados (forró, pop rock, cyberpunk, synthwave).
