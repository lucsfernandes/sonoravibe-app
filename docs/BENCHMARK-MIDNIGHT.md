# Benchmark — "Midnight retrowave" (XL-SFT, com o DCW corrigido)

> Medido em 2026-09-24 numa **NVIDIA L4** (classe de 24 GB do serverless), com o `handler.py`
> real e a imagem fixada do ACE-Step. Custo da rodada válida: **US$ 0,14**. Pod destruído
> (conferido pela API: zero Pods na conta).

**Não ouvi as faixas.** Tudo aqui é medição (tempo, espectro, pulso) e um indicador automático de
aderência ao texto (CLAP). No benchmark anterior as métricas apontaram para o lado errado e o seu
ouvido corrigiu; trate os números como pista, não como veredito.

> ## Escuta da rodada 1 (2026-09-24) — ela manda, não os números
>
> | Faixa | Veredito do ouvinte |
> |---|---|
> | **S50N-0 / S50N-1** | melodia perfeita e limpa, sem ruído, bem coerente |
> | S32-0 / S32-1 | melodia perfeita e limpa, coerente; **final quebrado** (corte seco / últimos segundos interrompidos) |
> | REF-0 / REF-1 | melodia ok; **acabou em 1:55 e 1:52** numa faixa de 2:00 |
> | S50-0 | alguma incoerência, batida repetitiva demais |
> | S50-1 | parece música invertida, não foi um bom áudio |
>
> As métricas da seção 3 apontavam S50 como a melhor. **Estavam erradas de novo**: a escuta
> escolheu S50N (sem reescrita do caption). Os números aqui são registro, não decisão.
>
> **Os finais** foram diagnosticados e corrigidos (seção 7): o problema era a duração fixa, não a
> geração.

---

## 0. O que mudou desde o benchmark anterior: o bug do DCW

A imagem do ACE-Step que usamos (commit `dce6214`, maio de 2026) liga o **DCW** para qualquer
modelo. O DCW é uma correção feita para os modelos **turbo**; num modelo não destilado, como o
XL-SFT, ela distorce o áudio (issue #1259 do ACE-Step, corrigida numa versão posterior).

Os logs mostram DCW ligado em **todas** as faixas XL-SFT dos benchmarks anteriores. Aquelas
faixas não representam o XL-SFT. O `handler.py` agora desliga o DCW no perfil SFT e mantém ligado
no turbo. Nesta rodada: DCW ativo **0 vezes** nos grupos XL-SFT, e **2** na referência XL-turbo
(correto).

---

## 1. O que foi gerado

**Prompt**, compilado pelo `buildJobInput` real, como a aba Advanced envia:

- estilo: `Midnight retrowave instrumental, minimal synthwave, sparse clean arpeggios, deep steady
  sub bass, very soft percussion, wide glowing pads, 84 BPM, calm unbroken focus atmosphere, no
  vocals, minimal variation for deep work`
- letra: `[instrumental]`, instrumental desligado, sem exclusões

**Igual em todos:** seed 42 (faixas 0 e 1 = seeds 42 e 43), 120 s, 2 faixas por pedido, offload
de encoder/VAE ligado. Na L4 o offload é necessário: sem ele o ACE-Step corta o lote do XL-SFT
de 2 para 1 faixa (aconteceu numa tentativa anterior).

| Job | Configuração |
|---|---|
| **S50** | XL-SFT + LM 1.7B, 50 passos |
| **S50N** | XL-SFT + LM 1.7B, 50 passos, **sem** a reescrita do caption pelo LM |
| **S32** | XL-SFT + LM 1.7B, 32 passos |
| REF | referência: o padrão atual (XL-turbo + LM 1.7B, 8 passos) |

**MP3 × FLAC:** o worker entrega o master em FLAC 24 bits; o MP3 foi gerado a partir dele com
exatamente os argumentos do produto (`libmp3lame`, 320 kbps, `mp3ArgsFor('full')`).

---

## 2. Onde ouvir

Pasta `docs/benchmarks/midnight-retrowave/pod-24gb/audio/` (fora do git). Cada faixa existe em
`.flac` e `.mp3`, com o mesmo nome.

| Ouça | O que é |
|---|---|
| `S50-0` e `S50-1` | XL-SFT, 50 passos |
| `S50N-0` e `S50N-1` | igual, sem reescrita do caption |
| `S32-0` e `S32-1` | XL-SFT, 32 passos |
| `REF-0` e `REF-1` | o padrão atual, para comparar |

---

## 3. Resultados

### 3.1 Custo e tempo (2 faixas de 2 min, L4, US$ 0,69/h)

| Job | Geração | VRAM pico | Custo do pedido | vs. padrão |
|---|---|---|---|---|
| S50 | 112,4 s | 16,1 GB | **US$ 0,0216** | 3,0× |
| S50N | 109,8 s | 16,1 GB | **US$ 0,0211** | 3,0× |
| S32 | 83,1 s | 16,2 GB | **US$ 0,0160** | 2,3× |
| REF | 36,3 s | 16,2 GB | **US$ 0,0071** | 1× |

A L4 é ~2× mais lenta que a RTX 3090 do benchmark anterior. Pela proporção, uma faixa de 6 min em
XL-SFT com 50 passos custaria ~US$ 0,065 por pedido na L4, contra ~US$ 0,02 do padrão (estimativa,
não medida).

### 3.2 O que o LM decidiu (BPM pedido: 84, só no texto)

| Job | BPM | Tom | Caption reescrito (início) |
|---|---|---|---|
| S50 | 88 | G menor | "A driving, hypnotic synth arpeggio… a deep, sustained synth…" |
| S50N | **188** | G menor | (sem reescrita: o DiT recebe o seu texto) |
| S32 | 91 | F# menor | "A dreamy, nostalgic… bright, cascading arpeggios… video game soundtracks" |
| REF | 88 | B♭ menor | "An energetic **chiptune-inspired** synthwave… steady **four-on-the-floor** beat" |

- O caption de **S50** é o mais próximo do pedido.
- **REF** descreve algo enérgico, com bumbo marcado; o pedido era "very soft percussion" e "calm".
- Sem a reescrita (**S50N**), o LM ainda escolhe os metadados sozinho e escolheu **188 BPM**
  para um pedido de 84. O "84 BPM" escrito no texto não é o parâmetro de BPM.

### 3.3 Espectro, pulso e aderência (faixa 0 / faixa 1)

| Job | Agudos acima de 8 kHz | Rolloff 95% | Planicidade HF (ruído) | Variação entre batidas | CLAP: estilo − evitar | CLAP: voz |
|---|---|---|---|---|---|---|
| **S50** | **0,01% / 0,01%** | **6,2 / 6,3 kHz** | 0,22 / 0,35 | **0,95% / 2,32%** | **+0,174 / +0,197** | **0,02 / 0,08** |
| S50N | 0,54% / 0,56% | 10,4 / 10,9 kHz | 0,13 / 0,38 | 2,26% / 3,10% | +0,097 / +0,133 | 0,12 / 0,09 |
| S32 | 0,53% / 0,52% | 8,9 / 12,0 kHz | 0,17 / 0,33 | 1,63% / 2,36% | +0,099 / +0,099 | **0,19** / 0,14 |
| REF | 1,69% / 0,63% | 10,5 / 12,5 kHz | 0,30 / 0,25 | 1,96% / 1,93% | +0,191 / +0,110 | 0,05 / 0,10 |

- **S50** é o destaque nos números: o pulso mais estável da rodada (0,95% na faixa 0), a maior
  aderência ao pedido no CLAP e a menor semelhança com voz. Também quase **não tem conteúdo acima
  de 8 kHz** (0,01%): pode soar limpo e aveludado, ou abafado. Só o ouvido distingue.
- **S50N** (sem reescrita) ficou pior que S50 em tudo, inclusive no pulso. Neste prompt, desligar
  a reescrita não ajudou.
- **S32** tem a maior semelhança com voz no CLAP (0,19), mesmo com "no vocals" no texto (ver 4).
- **REF** mistura as duas coisas: faixa 0 próxima de S50 no CLAP, faixa 1 bem mais longe.
- Pico real de clipping: nenhum arquivo satura (`clip_pct` = 0). Antes da normalização, porém, o
  áudio encostou em 1,0 em 4 de 4 gerações do XL-turbo (com DCW) contra 1–2 de 4 no XL-SFT.

### 3.4 MP3 × FLAC

| Faixa | SNR do MP3 contra o FLAC | Corte do MP3 | FLAC | MP3 |
|---|---|---|---|---|
| S50-0 / S50-1 | 45,5 / 47,9 dB | sem corte (a faixa quase não tem agudos) | 22,3 MB | 4,8 MB |
| S50N-0 / S50N-1 | 36,8 / 35,6 dB | 20,0 / 18,0 kHz | 24,9 / 24,4 MB | 4,8 MB |
| S32-0 / S32-1 | 38,9 / 35,4 dB | 18,8 / 18,4 kHz | 24,5 / 24,8 MB | 4,8 MB |
| REF-0 / REF-1 | 35,3 / 38,0 dB | 19,0 / 19,6 kHz | 23,4 / 24,5 MB | 4,8 MB |

- O MP3 de 320 kbps ficou **entre 35 e 48 dB** de distância do FLAC. Acima de ~30 dB a diferença
  costuma ser inaudível num fone comum.
- Ele corta acima de 18–20 kHz, fora da faixa que a maioria dos adultos ouve.
- Métricas de pulso, espectro e CLAP ficaram **iguais** entre MP3 e FLAC em todas as faixas.
- Na prática, **se uma faixa soa ruim no MP3, ela soa ruim no FLAC**: o problema vem da geração,
  não do formato. O FLAC é ~5× maior.

---

## 4. O que o prompt pode estar atrapalhando

- **"no vocals" no texto do estilo.** O encoder de texto embute a palavra citada, com ou sem
  "no". Como a letra é `[instrumental]` e o botão instrumental está desligado, o modelo recebe
  "vocals" e nada o impede de cantarolar. É o provável motivo do CLAP de voz alto em S32 e S50N.
  Remédio sem código: tirar "no vocals" do estilo e ligar o **Instrumental**, ou pôr `vocals` no
  **Excluir estilos** (o produto converte em instrumental nativo).
- **"84 BPM" no texto.** Não chega ao parâmetro de BPM; o LM escolheu 88, 91 e 188. Use o campo
  BPM da interface. Converter "NN BPM" do texto em parâmetro nativo automaticamente é uma melhoria
  que proponho e ainda não implementei.

---

## 5. Leitura geral

| Configuração | Prós | Contras |
|---|---|---|
| **S50** (XL-SFT 50) | melhor em todos os indicadores objetivos: pulso mais estável, mais aderência ao pedido, menos voz; caption do LM fiel | 3× o custo do padrão; quase sem agudos (pode soar abafado); ~112 s para 2 faixas de 2 min na L4 |
| S50N (sem reescrita) | recebe o texto do usuário sem interpretação | pior que S50 em pulso e aderência; BPM escolhido absurdo (188) |
| S32 (XL-SFT 32) | −26% de custo contra S50 | mais semelhança com voz; aderência igual à de S50N |
| REF (XL-turbo) | 3× mais barato; foi o que você aprovou na rodada anterior | caption do LM contraria o pedido (chiptune, bumbo marcado) |

**Recomendação honesta:** os números favorecem **S50**, e esta é a primeira vez que o XL-SFT
roda sem o bug. Mas a última recomendação baseada em números errou e a sua escuta corrigiu. Ouça
`S50-0`, `S50-1` e `REF-0` lado a lado. Se o S50 soar melhor, a decisão seguinte é de custo: 3×
por pedido.

**Nada mudou no padrão do produto.** O Dockerfile continua em XL-turbo. A única mudança de código
desta rodada é o DCW desligado no perfil SFT do `handler.py`. Ela não afeta o XL-turbo e ainda não
foi commitada.

---

## 6. Custos desta rodada

| Tentativa | Resultado | Custo |
|---|---|---|
| 1 | Pod travado puxando a imagem, sem IP por 40 min | ~US$ 0,34 |
| 2 | sem GPU de 24 GB disponível | US$ 0 |
| 3 | L4: XL-SFT cortou o lote para 1 faixa sem offload | ~US$ 0,07 |
| 4 | com o bug do DCW (descartada) | ~US$ 0,08 |
| **5** | **válida** | **US$ 0,14** |

O script agora destrói o Pod que não ganha IP em 15 min.

---

## 7. Rodada 2 — finais corrigidos, 32 passos sem reescrita, 6 minutos

### 7.1 Por que os finais quebravam

A duração foi fixada em 120 s, mas quem decide onde a música acaba é o plano do LM. Medido no fim
de cada faixa da rodada 1 (RMS por segundo):

| Faixa | O que acontecia |
|---|---|
| S50N-0 / S50N-1 | fade natural, fim em 1:59 — os únicos finais bons |
| S32-0 | volume cheio até 1:55 e silêncio em menos de 1 s: corte seco |
| S32-1 | música até 1:49, queda brusca, 11 s de silêncio |
| REF-0 / REF-1 | música até 1:52 e 1:50, depois 8–10 s de silêncio |
| S50-0 | música até 1:35, depois 25 s de silêncio |

**Correção no `handler.py`** (`_finish_ending`, só em música nova, não em cover/repaint): corta o
silêncio final (RMS abaixo de −50 dBFS, deixando 0,3 s de respiro, só se sobrar ≥ 0,5 s) e aplica
um fade de 1,5 s (meio cosseno) no fim. A duração gravada passa a ser a real. Configurável por
`ACESTEP_TRIM_TAIL` e `ACESTEP_FADE_OUT_S`. As faixas da rodada 1 com essa correção aplicada estão
em `docs/benchmarks/midnight-retrowave/fim-corrigido/` (REF-0 passa a 1:52 com fade; S50N quase
não muda: 0,8–1,1 s cortados).

### 7.2 Resultados (L4, handler com o fim corrigido, sem DCW)

| Job | Configuração | Faixas (duração final) | Geração | VRAM | Custo do pedido (L4) |
|---|---|---|---|---|---|
| **S32N** | XL-SFT, **32 passos**, sem reescrita, 2 min | 1:59,2 e 2:00,0 | 81,7 s | 16,1 GB | **US$ 0,0159** |
| **S50N360** | XL-SFT, 50 passos, sem reescrita, **6 min** | 5:57,9 e 6:00,0 | 325,5 s | 17,6 GB | **US$ 0,0629** |
| (S50N, rodada 1) | XL-SFT, 50 passos, sem reescrita, 2 min | — | 109,8 s | 16,1 GB | US$ 0,0211 |

- Todas terminam com fade (os últimos segundos descem de ~−25 para ~−45 dBFS), sem corte seco nem
  silêncio sobrando.
- **6 min cabem na L4** com offload (pico de 17,6 GB).
- **32 passos custam 25% menos** que 50 (US$ 0,0159 contra 0,0211 em 2 min).
- A faixa `S32N-0` tem o pulso menos estável da rodada (4,2%, contra 1,0–2,3% nas outras), e
  `S50N360-0` tem mais agudos (4,6% da energia acima de 8 kHz, contra <1% nas outras). São pistas
  para a escuta, não veredito.
- MP3 × FLAC: SNR de 33–39 dB, mesma conclusão da seção 3.4.

### 7.3 Custo contra a receita

Receita de um pedido de 10 créditos no pior caso (câmbio assumido R$ 5,50): Pro **US$ 0,014**,
Premier **US$ 0,009**.

| Pedido de 2 faixas | S32N (32 passos) | S50N (50 passos) | XL-turbo (padrão atual) |
|---|---|---|---|
| 2 min | US$ 0,016 | US$ 0,021 | US$ 0,007 |
| 6 min | ~US$ 0,047 (estimado) | **US$ 0,063** (medido) | ~US$ 0,021 (estimado) |

Com o XL-SFT, **nenhuma duração se paga no preço atual** (10 créditos por pedido, qualquer
duração). Trocar o padrão exige decidir o preço junto.

### 7.4 Ouça

`docs/benchmarks/midnight-retrowave/rodada-2/audio/` — `S32N-0`, `S32N-1`, `S50N360-0`,
`S50N360-1`, em `.flac` e `.mp3`. Compare `S32N` com o `S50N` da rodada 1: se soar igual, 32 passos
é a escolha (25% mais barato).

