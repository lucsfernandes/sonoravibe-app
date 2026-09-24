# Benchmark de qualidade e custo — faixa "07 - Hot Path"

> Medido em 2026-09-23 na RunPod, com o `handler.py` real do worker e o mesmo digest da imagem
> do ACE-Step que o Dockerfile usa. Custo total do teste: **US$ 0,54**. Todos os Pods foram
> destruídos (conferido pela API: zero Pods na conta ao final).

Este documento responde a três perguntas do pedido:

1. **Por que a faixa ficou ruim e confusa, com ruído de agudos?**
2. **A potência máxima (XL-SFT + LM 4B) é necessária?**
3. **Quais são os prós, contras e custos de cada configuração?**

> **O que este teste NÃO faz: ouvir.** Quem escreveu não escuta áudio. Tudo abaixo é medição
> objetiva (tempo, memória, espectro do sinal) e um indicador automático de aderência ao
> texto (CLAP). Servem para apontar onde olhar, não para decidir a qualidade. A decisão final é
> do seu ouvido — a seção 6 lista exatamente quais arquivos ouvir.

---

> ## ⚠ Decisão final (depois da escuta) — substitui as recomendações abaixo
>
> **Configuração escolhida: XL-turbo (`acestep-v15-xl-turbo`) + LM 1.7B, 8 passos, com offload de
> encoder e VAE (`ACESTEP_OFFLOAD_TO_CPU=true`), numa GPU de 24 GB.** É o padrão do Dockerfile.
>
> - **Escuta de 29 faixas (rodada 1):** só F-0 e F-1 (XL-turbo) soaram nítidas e limpas, sem falha
>   entre uma percussão e outra. Todas as outras, inclusive as de XL-SFT e as do LM 4B, soaram com
>   ruído e desconexas. As métricas espectrais das seções 1, 3 e 7 apontavam o XL-SFT como mais
>   limpo, e **estavam erradas** para este prompt: premiam som escuro, não som coerente. O sinal
>   que concordou com o ouvido foi o **pulso**: variação entre batidas de 1,1–3,1% no XL-turbo,
>   contra ~7% em todas as XL-SFT.
> - **Validação do padrão (rodada 2, `pod-24gb-padrao`):** o Pod rodou o ambiente lido do próprio
>   Dockerfile. **FO360-0 e FO360-1 (6 min, com offload) foram as faixas mais limpas, harmoniosas
>   e de mais qualidade da escuta.** Sem offload, 2 faixas de 6 min são recusadas pela checagem
>   prévia de VRAM do ACE-Step (F360); 2, 4 e 5 min passam dos dois jeitos.
>
> | Pedido de 2 faixas (RTX 3090, US$ 0,69/h) | Geração | VRAM pico | Custo |
> |---|---|---|---|
> | 2 min (F120) | 19,1 s | 18,0 GB | US$ 0,0041 |
> | 4 min (F240) | 35,2 s | 18,3 GB | US$ 0,0071 |
> | 5 min (F300) | 42,4 s | 18,6 GB | US$ 0,0087 |
> | **6 min com offload (FO360)** | 59,5 s | 16,7 GB | **US$ 0,0121** |
>
> Custo de 6 min: ~85% da receita de um pedido no Pro e ~134% no Premier, no pior caso da seção
> 5.3 (câmbio assumido de R$ 5,50). Custos totais dos testes: US$ 0,64.
>
> **Mudou de fato em relação à produção:** o modelo de áudio passou do turbo de **2B**
> (`acestep-v15-turbo`) para o XL-turbo de **4B**, com a mesma receita de 8 passos, e as exclusões
> saíram do texto do caption para o negativo do LM. Corrigir só o prompt, com o turbo de 2B (job
> B), não resolveu na escuta.

---

## 1. Resumo da rodada 1 (antes da escuta — ver a decisão acima)

| Pergunta | Resposta medida |
|---|---|
| Por que ficou ruim? | Reproduzido. O **turbo** tem o dobro de "textura de ruído" nos agudos e energia até 12–16 kHz numa faixa que deveria ser escura. Além disso, o **LM reescreve o seu caption** para algo agressivo, e o código antigo ainda escrevia "without spoken word, choir, rap" no texto. |
| XL-SFT resolve o ruído? | **Sim, pelas métricas**: agudos ~2× menos ruidosos e o corte espectral cai de 12–16 kHz para 5–6 kHz. É o mais limpo dos testados, com 50 passos. |
| O LM 4B é necessário? | **Não, neste prompt.** Não mudou nenhuma métrica de ruído, reescreveu o caption com os mesmos vícios do 1.7B, custa GPU de 48 GB (pico de **26,1 GB**, não cabe em 24 GB) e ~11–13% mais tempo. |
| O LM respeita as exclusões? | **Não, em nenhum tamanho.** Todos os 10 captions reescritos (1.7B e 4B) trouxeram termos que você excluiu, principalmente "four-on-the-floor". |
| Cabe em 24 GB? | **Sim, com `ACESTEP_OFFLOAD_TO_CPU=true`**: 2 faixas de 6 min passaram (pico de 18 GB). Sem offload, só até ~3 min com 2 faixas. |
| Quanto custa? | Pedido de 2 faixas de 2 min: **US$ 0,011–0,014** (24 GB). De 6 min: **US$ 0,039**. **6× o custo do turbo antigo** por pedido. |

**Configuração que os dados apoiam:** XL-SFT + LM 1.7B, 50 passos, GPU de 24 GB com offload
de encoder e VAE. Ver seção 7 para o que falta decidir, inclusive o problema de margem da
seção 5.

---

## 2. Como foi medido

**Prompt** (o seu, exatamente): estilo de 469 caracteres, exclusões `vocals, singing, spoken
word, choir, rap, aggressive drums, distorted guitar, EDM drop, dubstep, big brass, orchestral
swell, glitch stutter, chiptune, sound effects, applause, darksynth, heavy four-on-the-floor
kick, screaming lead synth`. Instrumental (vocal excluído vira `instrumental` nativo).

**Igual em todos os jobs:** seed 42, duração fixa (120 s, 240 s ou 360 s), 2 faixas por
pedido (exceto o job A, que reproduz o código antigo com 1). Cada grupo carregou os modelos
uma vez e rodou um aquecimento de 10 s antes dos jobs medidos.

**Hardware:** a RunPod alocou uma **RTX 3090** na classe de 24 GB e uma **RTX A6000** na de
48 GB. O serverless de 24 GB também sorteia entre L4, A5000 e 3090. **A L4 tende a ser mais
lenta** (a medição antiga, feita na L4, deu 44,8 s para um turbo de 4:30; extrapolando desta
3090, seriam ~22 s), então os custos abaixo podem ser até ~2× maiores se o worker cair numa L4.

**Preços** (serverless flex da página de preços da RunPod, 2026-09-23): classe de 24 GB
**US$ 0,69/h**; 48 GB standard (A6000/A40) **US$ 1,22/h**; 48 GB PRO (L40S) US$ 1,75/h. Custo =
segundos de geração + codificação FLAC × preço por segundo. **Não inclui** cold start (seção
5), tempo ocioso de 5 s nem o custo da capa.

**Métricas de áudio** (`scripts/benchmark-qualidade/analisar.py`):

| Métrica | O que diz | Bom para "sem ruído de agudos" |
|---|---|---|
| `planicidade_hf` | quão parecido com ruído branco é o espectro entre 6 e 16 kHz (0 = tonal, 1 = ruído) | menor |
| `rolloff95_hz` | frequência abaixo da qual está 95% da energia | menor (faixa escura) |
| `centroide_hz` | "brilho" médio | menor |
| `agudos_12k_pct` | % da energia acima de 12 kHz | menor |

---

## 3. O que causou a faixa ruim

### 3.1 O texto que chegava ao modelo era ruim antes mesmo da geração

Com o seu prompt, o código **antigo** enviava ao modelo:

```
…steady minimal electronic beat, hypnotic pulse, without spoken word, choir, rap
```

- "spoken word, choir, rap" entravam no texto que o modelo lê, mesmo com `instrumental`
  ligado. O encoder de texto embute a palavra citada, negada ou não.
- As outras 14 exclusões eram **cortadas** pelo limite de 512 caracteres. Ou seja, quase
  todas as suas exclusões eram ignoradas.

### 3.2 O LM reescreve o caption, e o que ele escreve é o oposto do que você pediu

O ACE-Step tem um LM que reescreve o caption antes de o modelo de áudio ler. Reproduzindo o
job de produção (A, turbo + LM 1.7B, prompt antigo), o modelo de áudio recebeu:

> *An aggressive cyberpunk track driven by a relentless arpeggiated synth bassline and punchy
> electronic drums with trap-style hi-hats. The arrangement is punctuated by heavily distorted
> electric guitar riffs playing blues-rock licks that serve as the main hook…*

Você pediu "dark ambient, calmo, bateria mínima, sem guitarra distorcida". Recebeu agressivo, com
guitarra distorcida (que você excluiu). Nos **10 captions** que o LM reescreveu (1.7B e 4B),
**todos** trouxeram pelo menos um item literal da sua lista de exclusão:

| O que apareceu no caption reescrito | Quantos dos 10 |
|---|---|
| "four-on-the-floor" (você excluiu "heavy four-on-the-floor kick") | **8** |
| tom "aggressive" (você excluiu "aggressive drums" e "screaming lead synth"): descreve a faixa, o lead, o baixo ou a energia, não necessariamente a bateria | 4 |
| "distorted electric guitar" | 1 (job A) |
| "chiptune" literal | 1 (job C); "video game" em 2 (C e D) |

Uma checagem manual do contexto tirou dois falsos positivos do detector automático: "vocal-like
synth sample" (uma textura, não voz) e "the drums drop out" (não é um drop de EDM).

E ele escolhe o andamento sozinho: **75, 100, 103, 120, 125 e até 188 BPM** e 40, para um pedido
de "unhurried… 74 BPM". O "74 BPM" escrito dentro do texto do estilo **não é** o parâmetro de
BPM: só o parâmetro nativo funciona. Nos jobs `Cbpm` e `Nbpm`, com `bpm: 74` nativo, o LM
devolveu 74 nos metadados.

### 3.3 O ruído de agudos é do modelo turbo neste prompt

| Faixa | Modelo | planicidade HF | rolloff 95% | centroide |
|---|---|---|---|---|
| A (produção antiga) | turbo | **0,36** | 11,9 kHz | 3,2 kHz |
| B (turbo, prompt novo) | turbo | **0,39–0,40** | **14,5–15,7 kHz** | 3,6–4,0 kHz |
| F | XL-turbo | 0,23–0,25 | 11,1–12,6 kHz | 2,7–3,5 kHz |
| D | XL-SFT, 32 passos | 0,11 | 10,5–11,5 kHz | 2,4–2,6 kHz |
| **C, N, O\*, C48, E\*** | **XL-SFT, 50 passos** | **0,16–0,18** | **4,9–6,3 kHz** | **1,8–2,0 kHz** |

O XL-SFT com 50 passos tem metade da textura de ruído dos agudos e corta o espectro em 5–6 kHz,
como se espera de um dark ambient. Com 32 passos o corte sobe para ~11 kHz (o dobro de energia
acima de 12 kHz), então **os passos importam para os agudos**: economizar aqui custa brilho.

Nenhuma faixa saturou (`clip_pct` = 0 em todas): o ruído não é clipping.

---

## 4. Prós e contras das configurações, com custos

Custo por pedido = 2 faixas, exceto o job A (1 faixa). Classe de 24 GB a US$ 0,69/h; 48 GB a
US$ 1,22/h.

| # | Configuração | Jobs | GPU | Pedido de 2 min | Pedido de 6 min | Ruído de agudos |
|---|---|---|---|---|---|---|
| 1 | Turbo + LM 1.7B (produção antiga) | A, B | 24 GB | A: **US$ 0,0019** (1 faixa)<br>B: **US$ 0,0024** | não medido | **pior** (0,36–0,40) |
| 2 | XL-turbo + LM 1.7B | F | 24 GB | **US$ 0,0029** | não medido | médio (0,23–0,25) |
| 3 | **XL-SFT 50 passos + LM 1.7B** | C, N, O\* | 24 GB | **US$ 0,0113** sem offload<br>**US$ 0,0141** com offload | **US$ 0,0394** (offload) | **melhor** (0,16–0,18) |
| 4 | XL-SFT 32 passos + LM 1.7B | D | 24 GB | **US$ 0,0081** | não medido | mais brilhante (rolloff ~11 kHz) |
| 5 | XL-SFT 50 passos + LM 4B | E | **48 GB** | **US$ 0,0187** | **US$ 0,0556** | igual ao 3 |
| — | XL-SFT + LM 1.7B em 48 GB | C48 | 48 GB | US$ 0,0166 | US$ 0,0503 | igual ao 3 |

### 1. Turbo + LM 1.7B (o que rodava)

- **Prós:** o mais barato (~10 s de GPU para 2 min de áudio) e rápido; cabe folgado em 24 GB (13 GB).
- **Contras:** é onde aparece o ruído de agudos. Não tem CFG (o botão que faz o modelo seguir o
  texto), então "aderência ao estilo" da interface não tem o que controlar. No CLAP, o job A é o
  que mais se aproxima dos termos excluídos (média 0,134) e o de menor margem entre "estilo
  pedido" e "exclusões" (+0,024, contra +0,09 a +0,11 nas demais).

### 2. XL-turbo + LM 1.7B

- **Prós:** ~4× mais barato que o XL-SFT (US$ 0,0029), com metade dos passos do turbo.
- **Contras:** os agudos ficam no meio do caminho (rolloff 11–12,6 kHz); o CLAP acusa
  "chiptune" e "EDM drop" (0,27–0,28); também sem CFG. É a alternativa **barata**, mas não
  resolve o ruído.

### 3. XL-SFT 50 passos + LM 1.7B — a que os dados apoiam

- **Prós:** o mais limpo nas métricas; tem CFG (a "aderência ao estilo" passa a valer); cabe em
  24 GB; o 1.7B é o padrão recomendado pelo ACE-Step; uma faixa de 6 min é tão limpa quanto uma de 2.
- **Contras:** **6× o custo do turbo antigo por pedido** (3× por faixa); cold start de 42–76 s;
  **sem offload só gera 2 faixas até ~3 min** (seção 5); com offload, +25% de tempo.

### 4. XL-SFT 32 passos

- **Prós:** −29% de tempo e custo contra 50 passos.
- **Contras:** mais brilho nos agudos (o problema que você quer evitar). Só vale como recurso de
  custo depois de ouvir.

### 5. XL-SFT + LM 4B (potência máxima)

- **Prós:** "mais conhecimento" de estilos raros, segundo a documentação do ACE-Step.
- **Contras, todos medidos:** nenhuma métrica de ruído mudou; o caption reescrito tem os mesmos
  vícios (four-on-the-floor, "aggressive", BPM 100 e 188); pico de **26,1 GB de VRAM**, então
  **não cabe em 24 GB** e exige 48 GB (US$ 1,22/h, 1,77× o preço da classe de 24 GB); +11–13% de tempo
  contra o 1.7B na mesma GPU. Pagar isso só faria sentido se a escuta mostrar um ganho que as
  métricas não veem.

---

## 5. Custo, memória e margem

### 5.1 Tempo e memória (24 GB, XL-SFT + LM 1.7B, 50 passos)

| Job | Faixas | Duração | Geração | VRAM pico | Custo do pedido |
|---|---|---|---|---|---|
| C, sem offload | 2 | 2 min | 58,6 s | 18,3 GB | US$ 0,0113 |
| **C360, sem offload** | 2 | 6 min | **recusado** | — | — |
| O120, offload | 2 | 2 min | 73,0 s | 16,3 GB | US$ 0,0141 |
| O240, offload | 2 | 4 min | 136,6 s | 16,9 GB | US$ 0,0265 |
| **O360, offload** | 2 | **6 min** | 203,6 s | 18,0 GB | US$ 0,0394 |

**Por que o job de 6 min foi recusado sem offload:** não foi falta real de memória. O ACE-Step
faz uma checagem prévia por estimativa (1,0 GB × faixas × minutos + 0,5 GB) e o job de 6 min pedia
6,5 GB com 6,4 GB livres. Por essa mesma fórmula, **sem offload** cabem **2 faixas até ~3 min**
ou **1 faixa até ~5,9 min** (cálculo, não medido: só o 2 min sem offload e o 6 min recusado foram
testados). Com `ACESTEP_OFFLOAD_TO_CPU=true` (encoder e VAE saem da GPU entre
etapas; o DiT e o LM ficam) a checagem é pulada e o pico real foi de 18 GB.

**O offload custa +25% de tempo** no job de 2 min (73 s contra 58,6 s). Como o offload é uma
variável do processo, dá para: (a) ligar sempre (+25%, mas toda duração funciona), ou (b)
deixar desligado e limitar o produto a 2 faixas até 3 min.

O 4B no 48 GB: pico de 26,1 GB em 2 min e em 6 min. O 1.7B no 48 GB: 20,6–20,7 GB.

### 5.2 Cold start

Carga dos modelos medida: **40–56 s** (24 GB sem offload), **76 s** (com offload), 50–61 s (48
GB). A US$ 0,69/h isso é ~US$ 0,008–0,015 por cold start. Com `Active Workers = 0` cada
período ocioso paga isso de novo; o download da imagem de ~38 GB não é cobrado como GPU, mas
soma minutos de espera (11 min na primeira vez neste teste).

### 5.3 O problema de margem

O produto cobra **10 créditos por música, qualquer duração** (`CREDIT_COSTS.song`). Preços dos
planos (`packages/shared/src/plans.ts`): **Pro R$ 39 por 5.000 créditos**, **Premier R$ 99 por
20.000**. Receita por pedido de 10 créditos, no **pior caso** (o usuário gasta todo o plano) e
com câmbio **assumido em R$ 5,50/US$**: **Pro US$ 0,0142**, **Premier US$ 0,0090**.

Custo de GPU como % dessa receita:

| Pedido (2 faixas) | Custo | % da receita Pro | % da receita Premier |
|---|---|---|---|
| Turbo antigo, 2 min, 1 faixa (A) | US$ 0,0019 | 13% | 21% |
| XL-SFT, 2 min, sem offload (C) | US$ 0,0113 | **80%** | **126%** |
| XL-SFT, 2 min, offload (O120) | US$ 0,0141 | 100% | 157% |
| XL-SFT, 4 min, offload (O240) | US$ 0,0265 | 187% | 294% |
| XL-SFT, 6 min, offload (O360) | US$ 0,0394 | **278%** | **438%** |

Ou seja: com preço fixo por música e duas faixas por pedido, **uma faixa de 6 min custa mais de
2× o que o Pro paga por ela**, e até uma de 2 min passa da receita do Premier. Os números são o
pior caso (créditos não gastos aumentam a receita por crédito usado) e não incluem a capa nem o
tempo ocioso, mas o sentido é claro: **a configuração de qualidade exige repensar preço ou
limite por duração**. Para comparar: o Lyria de reserva custa US$ 0,08 por faixa, ~14× o custo
de uma faixa do XL-SFT de 2 min.

---

## 6. Ouça estes arquivos

Os áudios ficam em `docs/benchmarks/hot-path/pod-*/audio/` (FLAC 24 bits, ignorados pelo git).
Sugestão de ordem, com a mesma seed:

| Ordem | Arquivo | O que é | O que ouvir |
|---|---|---|---|
| 1 | `pod-24gb/audio/A-0.flac` | **a faixa ruim reproduzida** (turbo, prompt antigo) | o ruído de agudos e a confusão |
| 2 | `pod-24gb/audio/B-0.flac` | turbo com o prompt novo | se só arrumar o prompt melhora |
| 3 | `pod-24gb/audio/C-0.flac` | **XL-SFT + 1.7B** (LM reescreve o caption) | limpeza, respeito ao estilo |
| 4 | `pod-24gb/audio/N-0.flac` | igual a C, **sem** a reescrita do LM | se soa mais fiel ao pedido que o C |
| 5 | `pod-24gb/audio/Nbpm-0.flac` | igual a N, BPM 74 nativo | andamento lento, "unhurried" |
| 6 | `pod-24gb/audio/D-0.flac` | XL-SFT com 32 passos | se os agudos incomodam mais |
| 7 | `pod-24gb/audio/F-0.flac` | XL-turbo (a alternativa barata) | se é bom o bastante |
| 8 | `pod-48gb/audio/E-0.flac` | **XL-SFT + LM 4B** | se há ganho que justifique 48 GB |
| 9 | `pod-24gb-offload/audio/O360-0.flac` | 6 minutos, 24 GB com offload | se a faixa longa se sustenta |

Há sempre uma segunda faixa (`-1`), a variante do mesmo pedido. **Sobre C × N:** as métricas
automáticas não os distinguem; só o ouvido diz se desligar a reescrita do LM melhora o estilo.

---

## 7. Recomendação da rodada 1 (superada pela decisão no topo)

**Configuração que os dados apoiam:** XL-SFT + LM 1.7B, 50 passos, GPU de 24 GB com
`ACESTEP_OFFLOAD_TO_CPU=true`. O 4B pode ficar de fora da imagem (−8,4 GB) enquanto a escuta
não mostrar um ganho; recolocá-lo é uma linha no Dockerfile.

**Ainda não apliquei nada disso nos padrões do repositório** (hoje o Dockerfile e o handler
continuam em LM 4B, sem offload). Mudanças propostas, depois de você ouvir:

1. **LM padrão 1.7B** no `handler.py` e no Dockerfile; **offload ligado** no Dockerfile. Corrigir
   em `RUNPOD.md` a nota de que o offload "deixaria a geração muito mais lenta": medido, é +25%.
2. **Extrair "NN BPM" do texto do estilo** e mandar como `bpm` nativo quando o campo estiver
   vazio. Foi a única coisa que fez o LM respeitar o andamento (74), e você escreveu "74 BPM"
   no estilo.
3. **`ACESTEP_COT_CAPTION`:** a reescrita do LM se afastou do pedido em 10 de 10 vezes. As métricas
   não mostram efeito no áudio, então a decisão é do ouvido (arquivos 3 e 4 da seção 6). Se o N
   soar mais fiel, desligar por padrão também economiza um pouco de LM.
4. **Preço e limite por duração** (seção 5.3). Opções, que **não implementei**: créditos
   proporcionais à duração; 2 faixas só até 3 min e 1 faixa acima; 32 passos nas longas.

**Riscos abertos:**

- Nenhum job usou a L4, e o custo pode chegar a ~2× nela.
- O turbo e o XL-turbo em 6 min não foram medidos.
- O teste usou um prompt. Ruído e estilo em outros gêneros (com vocal, com letra) não estão
  cobertos.
- O andamento real do áudio não foi verificado: o estimador do librosa erra a oitava em música
  ambiente e a métrica de periodicidade não discriminou (por isso não aparece aqui).

---

## 8. Reproduzir

```bash
# Pod de 24 GB: turbo, XL-turbo, XL-SFT + 1.7B (com e sem reescrita do LM, 32 e 50 passos)
node scripts/benchmark-qualidade.mjs 24
# Pod de 24 GB com offload: 2, 4 e 6 min
node scripts/benchmark-qualidade.mjs 24off
# Pod de 48 GB: XL-SFT + 4B e + 1.7B
node scripts/benchmark-qualidade.mjs 48
```

Lê `RUNPOD_API_KEY` do `.env`, roda o `handler.py` real, baixa áudios e resultados para
`docs/benchmarks/hot-path/`, e **sempre destrói o Pod** (também em erro, Ctrl+C ou depois de 90
min). Depois: `scripts/benchmark-qualidade/analisar.py` (métricas de áudio),
`clap_score.py` (aderência) e `tabelas.py` (tabelas do anexo).

---

## Anexo — tabelas completas (geradas dos JSONs)

### Tempo, memória e custo

| Job | Configuração | GPU | Duração | Faixas | Carga (cold start) | Geração | GPU-s por min de áudio | VRAM pico | Custo do pedido | Custo por faixa |
|---|---|---|---|---|---|---|---|---|---|---|
| **A** | REFERÊNCIA: turbo + LM 1.7B, prompt como o código antigo enviava, 1 faixa | GeForce RTX 3090 | 120s | 1 | 56.4s | 9.6s (+0.3s FLAC/upload) | 5 | 13.2 / 24.0 GB | US$ 0.0019 | US$ 0.0019 |
| **B** | turbo + LM 1.7B, prompt novo (negativo separado), 2 faixas | GeForce RTX 3090 | 120s | 2 | 56.4s | 12.1s (+0.6s FLAC/upload) | 3 | 13.1 / 24.0 GB | US$ 0.0024 | US$ 0.0012 |
| **F** | XL-turbo (8 passos, sem CFG) + LM 1.7B | GeForce RTX 3090 | 120s | 2 | 41.5s | 14.6s (+0.6s FLAC/upload) | 4 | 18.0 / 24.0 GB | US$ 0.0029 | US$ 0.0015 |
| **F120** | PADRÃO do Dockerfile (XL-turbo + LM 1.7B), 120 s: repete o job F | GeForce RTX 3090 | 120s | 2 | 79.1s | 19.1s (+2.2s FLAC/upload) | 5 | 18.0 / 24.0 GB | US$ 0.0041 | US$ 0.0020 |
| **F240** | padrão, 240 s | GeForce RTX 3090 | 240s | 2 | 79.1s | 35.2s (+2.1s FLAC/upload) | 5 | 18.3 / 24.0 GB | US$ 0.0071 | US$ 0.0036 |
| **F300** | padrão, 300 s | GeForce RTX 3090 | 300s | 2 | 79.1s | 42.4s (+3.2s FLAC/upload) | 5 | 18.6 / 24.0 GB | US$ 0.0087 | US$ 0.0044 |
| **F360** | padrão, 6 min (teto do produto), sem offload | GeForce RTX 3090 | 360s | — | 79.1s | **FALHOU** | — | 17.3 / 24.0 GB | — | geração falhou: Insufficient free VRAM: need ~6.5 GB, only 6 |
| **FO360** | padrão, 6 min, COM offload de encoder/VAE | GeForce RTX 3090 | 360s | 2 | 53.6s | 59.5s (+3.6s FLAC/upload) | 5 | 16.7 / 24.0 GB | US$ 0.0121 | US$ 0.0060 |
| **C** | XL-SFT + LM 1.7B, 50 passos, 2 faixas | GeForce RTX 3090 | 120s | 2 | 42.1s | 58.6s (+0.6s FLAC/upload) | 15 | 18.3 / 24.0 GB | US$ 0.0113 | US$ 0.0057 |
| **Cbpm** | igual a C, com BPM 74 como parâmetro nativo | GeForce RTX 3090 | 120s | 2 | 42.1s | 58.9s (+0.6s FLAC/upload) | 15 | 18.3 / 24.0 GB | US$ 0.0114 | US$ 0.0057 |
| **N** | XL-SFT + LM 1.7B, SEM a reescrita do caption pelo LM | GeForce RTX 3090 | 120s | 2 | 39.8s | 58.2s (+0.6s FLAC/upload) | 15 | 18.3 / 24.0 GB | US$ 0.0113 | US$ 0.0056 |
| **Nbpm** | igual a N, com BPM 74 nativo | GeForce RTX 3090 | 120s | 2 | 39.8s | 58.5s (+0.6s FLAC/upload) | 15 | 18.3 / 24.0 GB | US$ 0.0113 | US$ 0.0057 |
| **D** | XL-SFT + LM 1.7B, 32 passos | GeForce RTX 3090 | 120s | 2 | 41.0s | 41.6s (+0.6s FLAC/upload) | 11 | 18.3 / 24.0 GB | US$ 0.0081 | US$ 0.0040 |
| **C360** | igual a C na duração máxima do produto (6 min): teste de memória | GeForce RTX 3090 | 360s | — | 42.1s | **FALHOU** | — | 17.3 / 24.0 GB | — | geração falhou: Insufficient free VRAM: need ~6.5 GB, only 6 |
| **O120** | XL-SFT + LM 1.7B, com offload de encoder/VAE, 120 s | GeForce RTX 3090 | 120s | 2 | 76.2s | 73.0s (+0.8s FLAC/upload) | 18 | 16.3 / 24.0 GB | US$ 0.0141 | US$ 0.0071 |
| **O240** | igual, 240 s | GeForce RTX 3090 | 240s | 2 | 76.2s | 136.6s (+1.5s FLAC/upload) | 17 | 16.9 / 24.0 GB | US$ 0.0265 | US$ 0.0132 |
| **O360** | igual, 6 min (teto do produto), 2 faixas | GeForce RTX 3090 | 360s | 2 | 76.2s | 203.6s (+2.2s FLAC/upload) | 17 | 18.0 / 24.0 GB | US$ 0.0394 | US$ 0.0197 |
| **C48** | XL-SFT + LM 1.7B numa GPU de 48 GB, 120 s | RTX A6000 | 120s | 2 | 61.2s | 48.4s (+0.6s FLAC/upload) | 12 | 20.6 / 48.0 GB | US$ 0.0166 | US$ 0.0083 |
| **C48-360** | XL-SFT + LM 1.7B numa GPU de 48 GB, 6 min (teto do produto) | RTX A6000 | 360s | 2 | 61.2s | 146.7s (+1.8s FLAC/upload) | 12 | 20.7 / 48.0 GB | US$ 0.0503 | US$ 0.0252 |
| **E** | XL-SFT + LM 4B, 50 passos, 2 faixas | RTX A6000 | 120s | 2 | 49.6s | 54.6s (+0.6s FLAC/upload) | 14 | 26.1 / 48.0 GB | US$ 0.0187 | US$ 0.0094 |
| **E360** | igual a E na duração máxima do produto (6 min): teste de memória | RTX A6000 | 360s | 2 | 49.6s | 162.3s (+1.8s FLAC/upload) | 14 | 26.1 / 48.0 GB | US$ 0.0556 | US$ 0.0278 |

### O que o LM decidiu (caption reescrito, andamento) e vazamento das exclusões

| Job | BPM que o LM escolheu (pedido: 74) | Tom | Termos EXCLUÍDOS que aparecem no caption reescrito |
|---|---|---|---|
| **A** | 75 | C# minor | distorted guitar, tom 'aggressive' (excluídos: aggressive drums, screaming lead) |
| **B** | 100 | B♭ major | four-on-the-floor |
| **F** | 100 | G minor | four-on-the-floor |
| **F120** | 120 | B♭ minor | four-on-the-floor, chiptune / 8-bit |
| **F240** | 97 | E♭ minor | four-on-the-floor, tom 'aggressive' (excluídos: aggressive drums, screaming lead), 'video game' (parente de chiptune) |
| **F300** | 200 | C minor | four-on-the-floor, tom 'aggressive' (excluídos: aggressive drums, screaming lead) |
| **F360** | — | — | nenhum |
| **FO360** | 120 | G minor | four-on-the-floor |
| **C** | 75 | F major | chiptune / 8-bit, tom 'aggressive' (excluídos: aggressive drums, screaming lead), 'video game' (parente de chiptune) |
| **Cbpm** | 74 | B♭ minor | four-on-the-floor |
| **N** | 100 | A minor | nenhum |
| **Nbpm** | 74 | F minor | nenhum |
| **D** | 100 | G minor | four-on-the-floor, 'video game' (parente de chiptune) |
| **C360** | — | — | nenhum |
| **O120** | 125 | F minor | nenhum |
| **O240** | 120 | B♭ major | nenhum |
| **O360** | 77 | C minor | nenhum |
| **C48** | 103 | A♭ major | four-on-the-floor |
| **C48-360** | 40 | E minor | four-on-the-floor |
| **E** | 100 | F minor | four-on-the-floor, tom 'aggressive' (excluídos: aggressive drums, screaming lead) |
| **E360** | 188 | F minor | four-on-the-floor, tom 'aggressive' (excluídos: aggressive drums, screaming lead) |

### Caption que o LM reescreveu

- **A**: An aggressive cyberpunk track driven by a relentless arpeggiated synth bassline and punchy electronic drums with trap-style hi-hats. The arrangement is punctuated by heavily distorted electric guitar riffs playing blues-rock licks that serve as the main hook. A brief atmospheric breakdown around the midpoint features ambient pads before slamming back into the high-energy groove. The production includes robotic vocoder samples at the intro and outro, enhancing its futuristic, dystopian feel.
- **B**: An intense, driving synthwave track powered by a relentless four-on-the-floor kick drum and a pulsing, sequenced synth bassline. The arrangement builds with layers of arpeggiated synthesizers and atmospheric pads, creating a futuristic and cinematic soundscape. The main section introduces a powerful, anthemic synth lead melody that soars over the propulsive rhythm. The track features dynamic shifts, including a brief breakdown where the beat drops out, leaving only the swirling synth textures before slamming back into the full-throttle groove for a powerful climax.
- **F**: An intense synthwave track driven by a relentless four-on-the-floor drum machine beat with heavily gated reverb on the snare. The soundscape is built from layers of shimmering arpeggiated synths that create a constant sense of motion, underpinned by lush atmospheric pads providing harmonic depth. A powerful saw-wave lead synth carries soaring melodic themes during the epic chorus sections, while a driving sequenced bassline anchors the rhythm. The arrangement features dynamic builds using filter sweeps and risers, leading into expansive choruses where layered harmonies and counter-melodies intensify the futuristic atmosphere before breaking down into more contemplative bridge sections focused on intricate synth textures and eventually fading out on an ambient chord progression.
- **F120**: An instrumental synthwave track built on layers of clean, arpeggiated synthesizers that create an intricate, interlocking melodic texture reminiscent of chiptune music. A steady four-on-the-floor drum machine beat provides a driving pulse underneath shimmering bell-like synths and atmospheric pads with moderate reverb. The song progresses through distinct sections, introducing new melodic motifs while maintaining its core rhythmic and harmonic drive before breaking down into a more ambient passage featuring sustained chords and eventually fading out completely.
- **F240**: An intense, driving synthwave track powered by relentless arpeggiated synthesizers that form its core melodic and rhythmic identity. The song opens with layered synths building anticipation before slamming into a powerful four-on-the-floor drum machine beat with crisp hi-hats and an aggressive snare. A deep sub-bass anchors the low end while various saw-wave lead synths carry epic melodies over atmospheric pads drenched in cavernous reverb. The arrangement dynamically shifts between high-energy sections dominated by fast-paced arpeggios and more expansive passages where soaring leads take prominence, creating a futuristic and cinematic soundscape reminiscent of cyberpunk or video game soundtracks.
- **F300**: An intense, driving synthwave track powered by a punchy four-on-the-floor drum machine beat and an aggressive saw-wave bassline playing rapid-fire arpeggios. A bright, melodic lead synthesizer carries the main theme over atmospheric pads that fill out the mix. The arrangement builds with additional layers before dropping into a brief breakdown featuring filtered synths and ethereal textures. This transitions into a more contemplative section led by clean electric guitar chords drenched in delay, which then carries through to the end where it fades away.
- **F360**: (sem reescrita)
- **FO360**: An atmospheric synthwave track built on layers of shimmering arpeggiated synths that create a constant sense of motion. A steady four-on-the-floor drum machine beat provides a driving foundation with crisp hi-hats and a solid kick-snare pattern. The arrangement evolves through the addition of warm, expansive synth pads and melodic lead lines soaked in reverb. A brief breakdown section strips away the drums to feature ambient textures before reintroducing the main groove for an uplifting climax, finally fading out into its component synth parts.
- **C**: An energetic electronic track driven by layers of clean, arpeggiated synthesizers that create a complex, cascading melodic texture reminiscent of video game music or chiptune. A punchy drum machine beat with crisp hi-hats establishes a driving rhythm from the start. The arrangement builds dynamically, introducing new synth counter-melodies before dropping into an intense section featuring aggressive, bitcrushed lead synths playing powerful chords over a hard-hitting kick pattern. Following a brief atmospheric breakdown where only shimmering pads remain, the full instrumental force returns for a final climactic push before fading out on its core synth motifs.
- **Cbpm**: An epic synthwave track driven by an insistent four-on-the-floor kick drum that builds with a filter sweep into a grand soundscape. Lush, wide stereo synth pads lay down powerful chord progressions while shimmering arpeggiated synths create constant motion underneath soaring lead melodies drenched in cavernous reverb. The arrangement features dynamic shifts between high-energy sections and atmospheric breakdowns where bell-like tones and evolving textures take center stage before building back to full intensity for a cinematic climax.
- **N**: (sem reescrita)
- **Nbpm**: (sem reescrita)
- **D**: 'An energetic synthwave track driven by a relentless 16th-note arpeggiated synthesizer that forms its core melodic and rhythmic identity. A punchy four-on-the-floor drum machine beat provides a solid foundation with crisp hi-hats and snares soaked in reverb. The arrangement evolves through distinct sections: an initial driving intro gives way to more atmospheric passages where lush synth pads create harmonic depth under evolving lead melodies. The main thematic sections feature layered synths playing chordal stabs and soaring lead lines over the persistent arpeggio bassline, creating a feeling of forward momentum perfect for a retro video game or film soundtrack.'
- **C360**: (sem reescrita)
- **O120**: (sem reescrita)
- **O240**: (sem reescrita)
- **O360**: (sem reescrita)
- **C48**: 'An energetic synthwave track driven by a relentless four-on-the-floor drum machine beat and layers of shimmering arpeggiated synthesizers. A punchy digital bassline provides a solid rhythmic foundation while atmospheric pads create an expansive, futuristic soundscape with generous reverb. The arrangement builds progressively, introducing new melodic synth lines that evolve into driving motifs. At the midpoint, the song transitions to a brief breakdown before reintroducing its core elements: a more contemplative piano-like melody over sustained chords, then rebuilding its propulsive energy for a powerful finish.'
- **C48-360**: An atmospheric electronic track that opens with evolving synth pads creating an ambient soundscape before introducing a driving arpeggiated synth sequence. A steady four-on-the-floor drum machine beat enters, building momentum towards more complex melodic sections featuring layered synths and prominent filter sweeps for dynamic transitions. The arrangement includes brief breakdowns where the drums drop out to emphasize the chord progressions or lead melodies, followed by re-entries of the full energetic groove. The latter half introduces new textures like a rhythmic vocal-like synth sample and a final section driven by a powerful kick drum pattern reminiscent of progressive house or trance music.
- **E**: An intense synthwave track driven by a relentless four-on-the-floor drum machine beat with gated reverb on the snare and an aggressive 16th-note sequenced synth bassline that provides constant rhythmic momentum. The soundscape is built from layers of shimmering arpeggiated synths and broad, atmospheric pads drenched in cavernous reverb. The arrangement evolves through dynamic shifts, introducing new melodic lead lines played on bright synthesizers to build tension before dropping back into its core driving groove. A brief breakdown offers a moment of atmospheric respite before launching into a more complex second half featuring layered counter-melodies and intensified energy, culminating in a powerful climax and fading out on lingering ambient textures.
- **E360**: An intense, driving electronic track built on a foundation of a relentless, sequenced synth bassline and a punchy, four-on-the-floor drum machine beat. The arrangement starts with this core groove and methodically builds in complexity and intensity, layering multiple interlocking synth arpeggios and melodic lines. The synth textures are sharp and digital, with a driving, almost aggressive energy. The track progresses through several dynamic sections, each adding more layers and increasing the harmonic density, creating a powerful sense of forward momentum and tension, characteristic of EBM or dark synthwave. The piece is entirely instrumental, focusing on rhythmic and melodic development before ending abruptly.

### Ruído, brilho e pulso (objetivo)

| arquivo | duracao_s | agudos_pct | agudos_12k_pct | planicidade_hf | centroide_hz | rolloff95_hz | pico_dbfs | clip_pct | tempo_bpm | ibi_cv_pct | onsets_por_s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A-0.flac | 120.0 | 0.958 | 0.335 | 0.358 | 3179 | 11854 | -1.0 | 0.0 | 152.0 | 3.61 | 3.93 |
| B-0.flac | 120.0 | 1.235 | 0.632 | 0.3943 | 4028 | 15727 | -1.0 | 0.0 | 99.4 | 1.62 | 5.67 |
| B-1.flac | 120.0 | 0.724 | 0.306 | 0.4048 | 3617 | 14520 | -1.0 | 0.0 | 99.4 | 1.49 | 3.71 |
| F-0.flac | 120.0 | 0.75 | 0.31 | 0.2254 | 2680 | 11098 | -1.0 | 0.0 | 99.4 | 1.4 | 3.31 |
| F-1.flac | 120.0 | 1.52 | 0.608 | 0.2547 | 3454 | 12633 | -1.0 | 0.0 | 99.4 | 2.65 | 5.0 |
| F120-0.flac | 120.0 | 0.322 | 0.108 | 0.2374 | 2171 | 9270 | -1.0 | 0.0 | 117.5 | 2.32 | 4.77 |
| F120-1.flac | 120.0 | 1.757 | 0.67 | 0.2544 | 3010 | 11432 | -1.0 | 0.0 | 117.5 | 2.02 | 3.46 |
| F240-0.flac | 240.0 | 1.879 | 0.627 | 0.3198 | 3428 | 13113 | -1.0 | 0.0 | 95.7 | 1.14 | 5.93 |
| F240-1.flac | 240.0 | 0.845 | 0.337 | 0.3267 | 2802 | 11590 | -1.0 | 0.0 | 95.7 | 2.04 | 5.46 |
| F300-0.flac | 300.0 | 0.773 | 0.319 | 0.3068 | 2821 | 11906 | -1.0 | 0.0 | 99.4 | 1.41 | 4.27 |
| F300-1.flac | 300.0 | 0.607 | 0.248 | 0.3038 | 2824 | 12176 | -1.0 | 0.0 | 99.4 | 1.44 | 4.75 |
| FO360-0.flac | 360.0 | 0.861 | 0.255 | 0.308 | 2507 | 10594 | -1.0 | 0.0 | 117.5 | 2.7 | 4.33 |
| FO360-1.flac | 360.0 | 0.751 | 0.344 | 0.3323 | 2172 | 8801 | -1.0 | 0.0 | 117.5 | 3.09 | 3.92 |
| C-0.flac | 120.0 | 0.428 | 0.23 | 0.1805 | 1851 | 5156 | -1.0 | 0.0 | 112.3 | 7.11 | 6.07 |
| C-1.flac | 120.0 | 0.402 | 0.243 | 0.1776 | 1834 | 5309 | -1.0 | 0.0 | 129.2 | 6.71 | 5.76 |
| Cbpm-0.flac | 120.0 | 0.524 | 0.276 | 0.1767 | 1925 | 5414 | -1.0 | 0.0 | 112.3 | 6.91 | 5.99 |
| Cbpm-1.flac | 120.0 | 0.532 | 0.324 | 0.175 | 1978 | 5918 | -1.0 | 0.0 | 129.2 | 6.97 | 5.61 |
| N-0.flac | 120.0 | 0.582 | 0.319 | 0.177 | 1997 | 5584 | -1.0 | 0.0 | 107.7 | 7.1 | 6.1 |
| N-1.flac | 120.0 | 0.529 | 0.32 | 0.1748 | 1953 | 5941 | -1.0 | 0.0 | 129.2 | 6.87 | 5.77 |
| Nbpm-0.flac | 120.0 | 0.523 | 0.28 | 0.1792 | 1905 | 5250 | -1.0 | 0.0 | 117.5 | 7.4 | 5.88 |
| Nbpm-1.flac | 120.0 | 0.429 | 0.259 | 0.178 | 1836 | 5291 | -1.0 | 0.0 | 129.2 | 6.96 | 5.58 |
| D-0.flac | 120.0 | 0.895 | 0.526 | 0.1086 | 2601 | 11461 | -1.0 | 0.0 | 123.0 | 6.95 | 6.29 |
| D-1.flac | 120.0 | 0.838 | 0.566 | 0.1153 | 2435 | 10541 | -1.0 | 0.0 | 129.2 | 7.25 | 5.42 |
| O120-0.flac | 120.0 | 0.392 | 0.214 | 0.1819 | 1776 | 4934 | -1.0 | 0.0 | 112.3 | 7.13 | 5.94 |
| O120-1.flac | 120.0 | 0.443 | 0.276 | 0.176 | 1867 | 5250 | -1.0 | 0.0 | 129.2 | 6.6 | 5.58 |
| O240-0.flac | 240.0 | 0.468 | 0.236 | 0.1709 | 1908 | 5473 | -1.0 | 0.0 | 117.5 | 6.89 | 5.32 |
| O240-1.flac | 240.0 | 0.589 | 0.346 | 0.1678 | 2031 | 6340 | -1.0 | 0.0 | 123.0 | 6.82 | 5.01 |
| O360-0.flac | 360.0 | 0.397 | 0.197 | 0.1707 | 1826 | 5303 | -1.0 | 0.0 | 123.0 | 6.8 | 5.65 |
| O360-1.flac | 360.0 | 0.453 | 0.259 | 0.1655 | 1902 | 6000 | -1.0 | 0.0 | 107.7 | 7.04 | 5.35 |
| C48-0.flac | 120.0 | 0.378 | 0.207 | 0.1832 | 1765 | 4875 | -1.0 | 0.0 | 107.7 | 6.39 | 5.97 |
| C48-1.flac | 120.0 | 0.473 | 0.297 | 0.1745 | 1890 | 5262 | -1.0 | 0.0 | 129.2 | 7.11 | 5.7 |
| C48-360-0.flac | 360.0 | 0.441 | 0.222 | 0.1684 | 1891 | 5613 | -1.0 | 0.0 | 123.0 | 6.93 | 5.6 |
| C48-360-1.flac | 360.0 | 0.49 | 0.282 | 0.1647 | 1951 | 6006 | -1.0 | 0.0 | 129.2 | 6.83 | 5.43 |
| E-0.flac | 120.0 | 0.442 | 0.253 | 0.1835 | 1825 | 4992 | -1.0 | 0.0 | 112.3 | 6.85 | 5.85 |
| E-1.flac | 120.0 | 0.431 | 0.273 | 0.1819 | 1837 | 5086 | -1.0 | 0.0 | 129.2 | 7.09 | 6.03 |
| E360-0.flac | 360.0 | 0.417 | 0.215 | 0.1708 | 1841 | 5156 | -1.0 | 0.0 | 123.0 | 7.03 | 5.63 |
| E360-1.flac | 360.0 | 0.419 | 0.242 | 0.1703 | 1830 | 5174 | -1.0 | 0.0 | 123.0 | 7.05 | 5.45 |

### Aderência ao pedido (CLAP; só vale comparando as linhas entre si)

| Faixa | Estilo pedido (média) | Exclusões (média) | Estilo − exclusões | Exclusões mais altas |
|---|---|---|---|---|
| A-0.flac | 0.158 | 0.134 | +0.024 | bateria_agressiva 0.30, drop_edm 0.30, rap 0.27 |
| B-0.flac | 0.199 | 0.093 | +0.106 | bateria_agressiva 0.33, drop_edm 0.27, rap 0.21 |
| B-1.flac | 0.203 | 0.102 | +0.101 | bateria_agressiva 0.31, dubstep 0.23, drop_edm 0.23 |
| F-0.flac | 0.209 | 0.129 | +0.080 | drop_edm 0.27, chiptune 0.27, bateria_agressiva 0.25 |
| F-1.flac | 0.226 | 0.116 | +0.110 | chiptune 0.28, drop_edm 0.27, bateria_agressiva 0.23 |
| F120-0.flac | 0.213 | 0.127 | +0.087 | bateria_agressiva 0.25, drop_edm 0.24, orquestra 0.24 |
| F120-1.flac | 0.208 | 0.088 | +0.120 | chiptune 0.24, bateria_agressiva 0.22, efeitos_sonoros 0.20 |
| F240-0.flac | 0.202 | 0.132 | +0.070 | chiptune 0.28, drop_edm 0.27, bateria_agressiva 0.26 |
| F240-1.flac | 0.229 | 0.126 | +0.103 | chiptune 0.29, orquestra 0.29, drop_edm 0.27 |
| F300-0.flac | 0.191 | 0.117 | +0.073 | bateria_agressiva 0.27, drop_edm 0.21, efeitos_sonoros 0.20 |
| F300-1.flac | 0.224 | 0.137 | +0.087 | chiptune 0.33, drop_edm 0.31, bateria_agressiva 0.28 |
| FO360-0.flac | 0.214 | 0.091 | +0.123 | bateria_agressiva 0.22, efeitos_sonoros 0.21, orquestra 0.18 |
| FO360-1.flac | 0.226 | 0.121 | +0.106 | bateria_agressiva 0.27, drop_edm 0.24, orquestra 0.22 |
| C-0.flac | 0.103 | 0.006 | +0.096 | rap 0.30, dubstep 0.14, glitch 0.14 |
| C-1.flac | 0.107 | 0.010 | +0.097 | rap 0.30, dubstep 0.16, glitch 0.14 |
| Cbpm-0.flac | 0.101 | 0.005 | +0.096 | rap 0.30, glitch 0.13, dubstep 0.13 |
| Cbpm-1.flac | 0.106 | 0.012 | +0.094 | rap 0.30, dubstep 0.16, glitch 0.15 |
| N-0.flac | 0.101 | 0.003 | +0.097 | rap 0.30, glitch 0.14, dubstep 0.14 |
| N-1.flac | 0.103 | 0.008 | +0.096 | rap 0.30, dubstep 0.16, glitch 0.14 |
| Nbpm-0.flac | 0.097 | 0.007 | +0.090 | rap 0.31, glitch 0.15, dubstep 0.14 |
| Nbpm-1.flac | 0.101 | 0.005 | +0.095 | rap 0.29, dubstep 0.16, glitch 0.14 |
| D-0.flac | 0.119 | 0.025 | +0.094 | rap 0.26, dubstep 0.20, glitch 0.15 |
| D-1.flac | 0.113 | 0.019 | +0.094 | rap 0.27, dubstep 0.19, glitch 0.13 |
| O120-0.flac | 0.101 | 0.009 | +0.092 | rap 0.30, dubstep 0.15, glitch 0.13 |
| O120-1.flac | 0.095 | 0.008 | +0.087 | rap 0.31, dubstep 0.15, glitch 0.14 |
| O240-0.flac | 0.097 | 0.001 | +0.095 | rap 0.29, dubstep 0.14, glitch 0.12 |
| O240-1.flac | 0.106 | 0.011 | +0.095 | rap 0.30, glitch 0.16, dubstep 0.15 |
| O360-0.flac | 0.104 | 0.011 | +0.093 | rap 0.31, dubstep 0.13, glitch 0.13 |
| O360-1.flac | 0.104 | 0.005 | +0.099 | rap 0.29, glitch 0.15, dubstep 0.14 |
| C48-0.flac | 0.104 | 0.008 | +0.096 | rap 0.30, dubstep 0.14, glitch 0.14 |
| C48-1.flac | 0.106 | 0.007 | +0.099 | rap 0.30, dubstep 0.17, glitch 0.15 |
| C48-360-0.flac | 0.094 | 0.010 | +0.084 | rap 0.31, dubstep 0.15, glitch 0.14 |
| C48-360-1.flac | 0.108 | 0.013 | +0.094 | rap 0.30, dubstep 0.16, glitch 0.14 |
| E-0.flac | 0.102 | 0.011 | +0.091 | rap 0.31, glitch 0.15, dubstep 0.15 |
| E-1.flac | 0.104 | 0.005 | +0.099 | rap 0.29, dubstep 0.17, glitch 0.14 |
| E360-0.flac | 0.095 | 0.008 | +0.087 | rap 0.31, dubstep 0.15, glitch 0.14 |
| E360-1.flac | 0.106 | 0.012 | +0.094 | rap 0.30, dubstep 0.16, glitch 0.14 |

_Referência: uma faixa do Lyria (reserva) custa US$ 0.08._
