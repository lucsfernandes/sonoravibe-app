# Benchmark da v2.x com voz: agudo estridente e cadência

> 2026-09-25 · RunPod, GPU de 24 GB · `apps/gpu-worker/handler.py` real, no mesmo digest de imagem do
> worker · XL-SFT + LM 1.7B + offload · **custo total: US$ 0,20** (pod destruído, zero pods na conta).
>
> **Não ouvi as faixas.** As métricas abaixo mostram tendências, não decidem. O padrão só muda depois
> do seu veredito.

## Veredito do ouvinte (Lucas, 2026-09-29)

| Faixa | Veredito |
|---|---|
| **C6L-0** | **Muito bom. Bem construído** |
| **C6M-0** | **Gostei da harmonia e do tom de voz; agudo muito pouco presente** |
| **C6MN32-1** | **Ficou muito bem construída** |
| C5MN-0 | Ficou bom |
| C6MN-0 | Voz um pouco mais harmônica; falta acertar a pentatônica e sincronizar com o ritmo |
| C6MN32-0 | Faltou acertar as escalas na voz e a coerência com o ritmo (01:41–01:58 ficou bom) |
| C6L-1 | Agudo presente; a voz não respeitou algumas pausas harmônicas |
| C5MN-1 | Volume parece subir e descer nos compassos |
| C6M-1 | A voz precisa ser mais calma e sutil; mesmo problema de compasso do C5MN-1 |
| REF-0 | Se perde no meio (harmonia, melodia, pentatônica); alguns trechos cantados acertam o tom |
| REF-1 | A voz tentou se encaixar numa melodia totalmente desarmônica; ritmo e tons satisfatórios |
| C6MN-1 | **Horrível: exemplo do que nunca fazer** |

**Leitura:**
- **A configuração de produção (REF: CFG 7, LM 0,85) foi a pior nas duas seeds.** Precisava mudar.
- **CFG 6 com LM 0,8 ou 0,7 (C6M, C6L)** deu duas das três melhores faixas, e o C6M-0 foi a que
  teve menos agudo, que era a queixa principal.
- **O negativo anti-agudo ficou dividido.** Ele deu a pior faixa (C6MN-1) e uma das melhores
  (C6MN32-1). Por isso ele **não** vira padrão; quem quiser continua usando "Excluir estilos".
- **CFG 5 (C5MN)** não foi melhor que o 6.
- **A seed pesa tanto quanto o parâmetro.** Em quase todo par, uma faixa ficou boa e a outra não. As
  duas variantes por pedido ajudam aqui: o usuário tem duas chances.
- **32 passos (v2.0)** não ficou atrás dos 50, então a v2.0 continua como está.

**Decisão aplicada no `handler.py`** (só XL-SFT **com voz**; o instrumental e o turbo não mudam):

| | Antes | Agora |
|---|---|---|
| CFG com "Aderência" 0 / 50 / 100 | 5 / 7 / 9 | **5 / 6 / 7** |
| Temperatura do LM (variedade baixa / média / alta) | 0,7 / 0,8 / 0,85 | **0,7 / 0,8 / 0,8** |
| Negativo anti-agudo padrão | — | — (não vira padrão) |

## 1. O que foi gerado

**O pedido** é o mesmo da produção (música `78f8cb7f`, v2.5):
- **Estilo:** *uplifting outrun synthwave, dreamy retrowave, bright analog synths, shimmering pads,
  driving bassline, hopeful and expansive, cinematic chorus, 116 BPM*
- **Letra:** a de "Chase the electric horizon"
- **BPM e tom:** 116 BPM, tom automático
- **Duração:** 3 min

Todos os jobs usam as mesmas seeds (42 e 43, faixas `-0` e `-1`), 50 passos (exceto o `C6MN32`),
sem reescrita do caption e sem DCW, como a v2.5 de hoje.

| Job | CFG | LM (variedade) | Negativo anti-agudo | Passos | É o quê |
|---|---|---|---|---|---|
| **REF** | 7,0 | 0,85 (alta) | — | 50 | a v2.5 de produção hoje |
| C6M | 6,0 | 0,80 (média) | — | 50 | menos brilho, ritmo mais estável |
| C6L | 6,0 | 0,70 (baixa) | — | 50 | cadência no máximo |
| C6MN | 6,0 | 0,80 | sim | 50 | C6M + negativo |
| C5MN | 5,0 | 0,80 | sim | 50 | o mais suave |
| C6MN32 | 6,0 | 0,80 | sim | 32 | o C6MN na v2.0 |

O negativo anti-agudo é `shrill vocals, piercing high notes, harsh treble, falsetto, screaming`, e
vai ao `lm_negative_prompt`, o único negativo real do ACE-Step.

## 2. Onde ouvir

`docs/benchmarks/synthwave-voz/audio/`: cada faixa em **mp3** (320k, como o produto entrega) e em
**flac**.

Sugestão de ordem:
1. **REF-0 → C6M-0 → C5MN-0**: mesmo começo de seed, CFG descendo.
2. **REF-1 → C6MN-1 → C5MN-1**: a seed que saiu mais brilhante em quase todos os jobs.
3. **C6L-0/1**: variedade baixa.
4. **C6MN32-0/1**: se a v2.0 soa igual à v2.5 com o mesmo ajuste.

## 3. Resultados

### 3.1 Tempo e custo (2 faixas de 3 min por job)

| Job | Geração | Custo do pedido (US$ 0,49/h) |
|---|---|---|
| REF | 169 s | ~0,023 |
| C6M | 176 s | ~0,024 |
| C6L | 181 s | ~0,025 |
| C6MN | 179 s | ~0,024 |
| C5MN | 173 s | ~0,024 |
| C6MN32 | **126 s** | **~0,017** |

**Nenhuma combinação muda o custo:** CFG, variedade e negativo não mexem no tempo. Só os passos mexem.

### 3.2 O que o LM decidiu

| Job | Tom escolhido | BPM | Compasso |
|---|---|---|---|
| REF | B♭ major | 116 | 4 |
| C6M | G major | 116 | 4 |
| C6L | D major | 116 | 4 |
| C6MN | B♭ major | 116 | 4 |
| C5MN | D major | 116 | 4 |
| C6MN32 | D major | 116 | 4 |

- **Tom maior em 100% dos jobs.** Com "uplifting / hopeful" no estilo e o tom no automático, o LM
  sempre escolhe maior. Nenhum dos parâmetros testados muda isso; só fixar o tom (Am, Dm, Em) muda.
- **BPM obedecido em todos:** 116.

### 3.3 Espectro e pulso

As bandas de energia são da mixagem inteira, não só da voz. "Presença" é a faixa de 2–5 kHz, onde o
agudo de voz incomoda. O p95 mede os **momentos** mais gritados.

| Faixa | Graves < 250 Hz | Presença 2–5 kHz | Presença, p95 | Acima de 8 kHz | Centroide | Pulso (ibi_cv) |
|---|---|---|---|---|---|---|
| REF-0 | 69,6% | 4,35% | 15,7% | 3,27% | 3978 Hz | 1,4% |
| REF-1 | 54,9% | 8,05% | 24,7% | 3,65% | 4225 Hz | 3,3% |
| C6M-0 | 54,4% | 5,36% | 17,7% | 2,10% | 3581 Hz | 3,0% |
| C6M-1 | 55,9% | 12,08% | 41,5% | 2,11% | 3900 Hz | 3,4% |
| C6L-0 | 57,2% | 8,50% | 34,9% | 3,31% | 3779 Hz | 2,9% |
| C6L-1 | 53,8% | 14,24% | 36,4% | 3,07% | 3996 Hz | 3,2% |
| C6MN-0 | 68,5% | 4,40% | 13,7% | 2,68% | 3578 Hz | 2,8% |
| C6MN-1 | 59,5% | 7,35% | 22,8% | 2,54% | 4022 Hz | 3,7% |
| C5MN-0 | 55,3% | 5,45% | 17,3% | 2,78% | 3666 Hz | 2,8% |
| C5MN-1 | 61,7% | 7,05% | 23,2% | **1,98%** | 3581 Hz | 3,0% |
| C6MN32-0 | 51,1% | 6,37% | 20,1% | 2,08% | **3371 Hz** | 3,0% |
| C6MN32-1 | 54,9% | 8,83% | 24,1% | 2,91% | 3786 Hz | 2,5% |

O que os números sugerem (a confirmar no ouvido):
- **Brilho geral:** **CFG menor** (C6M, C5MN, C6MN32) baixa o centroide e a energia acima de 8 kHz
  em relação ao REF.
- **Voz gritada:** a **variedade baixa (C6L) piorou a presença**: as duas faixas estão entre as mais
  gritadas. Com o LM mais "certo", ele parece cair no refrão de estádio que o estilo pede.
- **Negativo anti-agudo:** com o negativo, os picos de presença ficaram mais baixos e mais parelhos
  entre as duas seeds que sem ele (C6MN × C6M: p95 de 13,7/22,8 contra 17,7/41,5).
- **Seed:** a seed pesa tanto quanto o parâmetro. A faixa `-1` sai mais brilhante em quase todos os
  jobs.
- **Pulso:** firme em todas as faixas (ibi_cv abaixo de 4%). A falta de cadência que você ouviu não
  aparece nesta métrica, que mede o beat e não a divisão da letra no compasso. Aqui só o ouvido
  decide.

### 3.4 MP3 × FLAC

O mp3 de 320k corta em 17,8–18 kHz, igual ao flac, com perda de ≤0,2 dB acima de 16 kHz. O formato
não explica a estridência.

## 4. O que o prompt faz com a voz

Três palavras do estilo pedem o agudo: **bright** (synths), **shimmering** (pads) e **cinematic
chorus**. Com "uplifting, hopeful" o tom sai maior, e com a voz no automático ela sai aguda. Nenhum
ajuste do motor anula o que o texto pede. Para faixas com voz mais grave, o que mais ajuda no
formulário:

- **Voz:** masculina (`vocalGender`).
- **Tom:** fixar um tom menor (Am, Dm, Em).
- **Estilo:** trocar `bright`/`shimmering` por `warm`/`mellow`, e acrescentar `low register, warm
  baritone voice`.

## 5. Próximo passo

Depois da sua escuta, a combinação vencedora vira o padrão da família SFT **só para faixas com voz**.
O instrumental S50N, que você aprovou, continua como está. O que pode mudar:

- **CFG:** uma faixa própria para faixas com voz.
- **Temperatura do LM:** um teto na v2.x.
- **Negativo padrão:** o anti-agudo, somado ao "Excluir estilos" do usuário.

Tudo isso vai no `handler.py` e no worker, com testes, e segue no rebuild da imagem `v2-sft`.

## Reproduzir

```bash
node scripts/benchmark-qualidade.mjs voz --max-min=75
python scripts/benchmark-qualidade/analisar.py docs/benchmarks/synthwave-voz/audio --saida docs/benchmarks/synthwave-voz/metricas.json
python scripts/benchmark-qualidade/comparar_mp3.py docs/benchmarks/synthwave-voz/audio --saida docs/benchmarks/synthwave-voz/mp3.json
```
