# LoRA/LoKr do ACE-Step: treinar um estilo com músicas próprias

> Para ensinar ao motor **um estilo, um timbre ou uma forma de produzir** (por exemplo, "o nosso
> forró"). Um adapter não deixa o modelo melhor em tudo: ele puxa o XL-SFT para o que as faixas do
> dataset têm em comum.

## Antes de tudo: de onde vêm as faixas

**Nada gerado no Suno.** Os termos do Suno (vigentes em 03/09/2026) proíbem usar as saídas "to power,
enable or train other artificial intelligence and machine learning models". Isso vale para qualquer
serviço com cláusula parecida.

Servem:
- gravações próprias;
- músicos contratados com cláusula de treino de IA;
- um banco de áudio cuja licença permita treino explicitamente.

## O fluxo

```
pasta local ──subir-dataset──► R2 privado ──treinar-lora --so-rotular──► rótulos (revisar)
                                            └─treinar-lora──────────────► lokr_weights.safetensors
```

Os scripts ficam em `scripts/lora/`, fora do git.

### 1. Bucket privado (uma vez)

1. Crie o bucket na Cloudflare: **R2 → Create bucket**, nome `sonora-lora-datasets`, **sem domínio
   público**. O bucket de produção não serve: ele tem o `cdn.sonoravibe.com` ligado, e qualquer
   chave ali pode ser lida por quem souber o caminho.
2. Crie um token R2 próprio, com **Object Read & Write** só nesse bucket.
3. No `.env`, acrescente as três variáveis abaixo. O `R2_ACCOUNT_ID` que já existe é reaproveitado.
   ```
   R2_DATASET_BUCKET=sonora-lora-datasets
   R2_DATASET_ACCESS_KEY_ID=...
   R2_DATASET_SECRET_ACCESS_KEY=...
   ```

**Subpastas:** a pasta pode ter subpastas (artista/álbum). No bucket, o caminho vira parte do nome
(`artista__album__faixa.mp3`), para duas faixas com o mesmo nome em álbuns diferentes não se
sobrescreverem.

Uma pasta pública do Google Drive não serve para o treino:
- ela expõe o áudio a qualquer um;
- arquivos grandes caem na tela de "não foi possível verificar vírus", o que quebra o download
  automático no pod.

O Drive pode servir de caixa de entrada: junte as faixas lá, baixe e rode o passo 2.

### 2. Enviar as faixas

```bash
node scripts/lora/subir-dataset.mjs ~/musicas/forro forro --tenho-direitos --simular   # só confere
node scripts/lora/subir-dataset.mjs ~/musicas/forro forro --tenho-direitos
```
node scripts/lora/subir-dataset.mjs /d/musics/screamo screamo --tenho-direitos

- **Só o áudio é obrigatório** (mp3, wav, flac, ogg, opus). O ideal é de 10 a 20 faixas por estilo.
- **Letra, BPM, tom e descrição:** o ACE-Step gera sozinho no passo 3. Se você tiver a letra de
  alguma faixa, ponha `nome.lyrics.txt` ao lado do áudio; ela vale mais que a transcrição.
- **`--tenho-direitos`:** fica gravado no `manifesto.json`, como confirmação de que as faixas não vêm
  do Suno.

### 3. Rotular e revisar (recomendado)

```bash
node scripts/lora/treinar-lora.mjs forro --so-rotular
```

O pod baixa as faixas por URL assinada e roda a rotulagem da própria imagem do ACE-Step:
- a descrição do estilo;
- BPM, tom e compasso;
- a transcrição da letra, quando falta o `.lyrics.txt`.

O resultado vai para `lora/forro/rotulos/dataset.json` no bucket. O tutorial do ACE-Step avisa que o
LM pode errar BPM e tom, e a transcrição pode errar versos. Revise:
1. baixe o `dataset.json` e corrija `lyrics`, `bpm`, `keyscale` e `caption` onde estiver errado;
2. suba o arquivo como `lora/forro/rotulos/dataset.revisado.json`.

O treino seguinte usa o revisado e não rotula de novo. Sem revisado, ele reaproveita o
`dataset.json` do `--so-rotular`, desde que as faixas sejam as mesmas. Para rotular tudo de novo, use
`--rotular-de-novo`.

### 4. Treinar

```bash
node scripts/lora/treinar-lora.mjs forro                 # 500 épocas
node scripts/lora/treinar-lora.mjs forro --epocas=800    # 10 a 20 faixas: o tutorial sugere ~800
```

- **`--modelo=sft|turbo`:** o trainer embutido do ACE-Step foi feito para o **turbo**. Ele sorteia
  só os 8 timesteps fixos do turbo (1,0 a 0,3) e não faz CFG dropout. No XL-SFT, cuja inferência
  anda 50 passos até 0 com CFG, o adapter atua em níveis de ruído que nunca viu. (O som robótico
  das rodadas do modern-metal não prova isso: lá até as faixas sem adapter saíram ruins.) Com `sft` (padrão), o pod remenda o trainer para sortear como o
  próprio XL-SFT no treino: t é o **máximo de dois** sorteios logit-normais (mu −0,4 e sigma 1,0 do
  `config.json`), com 15% de condição nula. O remendo da rodada 3 sorteava um só, o que puxava o
  treino para pouco ruído. Com `turbo`, treina no XL-turbo, com o remendo do item abaixo, e o
  adapter vale só para v1/v1.5. A família vai no nome da pasta (`adapters/<data>-sft/`), e o `testar-lora.mjs` escolhe o DiT por ela.
- **Timesteps do turbo:** os 8 do trainer (1,0; 0,955; 0,9; 0,833; 0,75; 0,643; 0,5; 0,3) não são
  os da produção. A imagem mapeia o `TURBO_TIMESTEPS` do handler para 0,955; 0,769; 0,625; 0,5; 0,4;
  0,3; 0,222; 0,125. Só 3 coincidem, e abaixo de 0,3 nada era treinado. Com `--modelo=turbo` o pod
  agora remenda o trainer para sortear por igual entre os 8 da produção (linha `TURBO_FIX` na linha
  do tempo). Nenhum adapter turbo até a rodada 3 foi treinado assim. Se o `TURBO_TIMESTEPS` do
  handler mudar, a lista do `treinar-lora.mjs` precisa mudar junto.
- **`--lr`** (padrão 0,03, o do tutorial) e **`--salvar-a-cada`** (padrão 10): com checkpoints
  mais frequentes dá para escolher uma época de antes de uma divergência. Se `--salvar-a-cada` for
  maior que `--epocas`, o script se recusa a começar, porque nenhum checkpoint seria gravado.
- **O que treina:** LoKr sobre o **XL-SFT** (v2.0 e v2.5), com os padrões do tutorial (lr 0,03,
  dim 64, alpha 128) e **sem DoRA** (`lokr_weight_decompose: false`).
- **`dim 64` vira matriz cheia:** o LyCORIS avisa "using full matrix mode" e força `alpha = dim`
  (escala 1). O `alpha 128` não tem efeito. É o mesmo comportamento do padrão do ACE-Step. Quem
  baixar o `dim` abaixo do limiar precisa pôr `alpha = dim`, senão a escala vira `alpha/dim`.
- **Por que sem DoRA:** a rota `start_lokr` do ACE-Step liga o DoRA por padrão. Com ele, o
  multiplicador do LyCORIS só interpola a magnitude: com 0, o delta do adapter continua inteiro nos
  pesos. Um adapter "desligado" mudaria todo job do worker, e a força não funcionaria. Os adapters
  treinados até 01/10/2026 têm DoRA (eletronics, games, hip-hop, instrumental, modern-metal, mpb):
  o handler recusa carregá-los e eles precisam ser treinados de novo.
- **GPU:** o treino só sobe em GPU de **48 GB** (A40, A6000, L40, L40S, RTX 6000 Ada), por folga:
  o trainer converte o decoder do XL-SFT para fp32. Ainda não está provado que 24 GB não bastam;
  as linhas `EPOCH` trazem o `vram_pico` para decidir. O `--so-rotular` continua aceitando 24 GB.
- **LM:** com rótulos prontos (revisados ou do `--so-rotular`), o pod sobe sem o LM. Quando rotula
  e treina na mesma execução, o script espera o servidor restaurar o LM depois do
  pré-processamento (`RESTORED`) antes de iniciar o treino.
- **Quanto custa:** os "~5 min" do tutorial não valem para o XL-SFT. Medido em 29/09/2026 com
  o `country` (20 faixas, GPU de 48 GB a US$ 0,53/h): **~72 s por época**, pico de 22,3 GB de
  VRAM. São 100 épocas em 2 h (~US$ 1,10); 800 épocas dariam ~16 h (~US$ 8,50) por estilo.
- **Teto de tempo:** `--max-min` (padrão 120) limita o treino. Logo nas primeiras épocas o pod
  registra uma linha `ETA` com a projeção; se o teto não alcançar, pare com Ctrl+C e ajuste.
- **Checkpoints:** a cada 10 épocas (`--salvar-a-cada`) o checkpoint sobe para
  `lora/forro/adapters/<data>/epoca-N/lokr_weights.safetensors`. Se o treino bater no teto, fica
  o último checkpoint e o script avisa `TREINO INCOMPLETO`.
- **Onde fica o resultado:** o adapter vai para `lora/forro/adapters/<data>/lokr_weights.safetensors`.
- **O pod:** usa a mesma imagem do worker (digest fixo) e é destruído no fim, em erro, com Ctrl+C
  ou no teto de tempo (`--max-min`).
- **Credenciais:** o pod nunca recebe as credenciais do R2, só URLs assinadas.

### 5. Testar (A/B de escuta)

```bash
node scripts/lora/testar-lora.mjs forro --simular                    # mostra o plano e o custo, sem pod
node scripts/lora/testar-lora.mjs forro                              # adapter mais recente, versão final
node scripts/lora/testar-lora.mjs forro --checkpoints=todos          # compara as épocas (epoca-10, ..., final)
node scripts/lora/testar-lora.mjs forro --adapter=2026-09-30T16-44-33 --escalas=0.3,0.6,1
```

O script sobe um pod com o `handler.py` real, o perfil da versão da família do adapter (pasta
`-sft`: v2.5, XL-SFT com 50 passos e sem reescrita do caption; pasta `-turbo`: v1.5, XL-turbo) e
o adapter em `ACESTEP_LORA_DIR`. Cada prompt é gerado:
- uma vez **sem adapter**, como referência, num processo em que o adapter nem é carregado;
- uma vez **com o adapter** para cada força de `--escalas` (padrão 0,5 e 1) e cada checkpoint.

**A seed não basta para parear.** Ela fixa só o ruído do DiT. O LM roda no backend vllm, que
ignora a seed, então sorteia códigos novos (a estrutura da música) em cada job. Até a rodada 3,
cada coluna era outra música, e a diferença entre colunas misturava adapter e sorteio do LM. O
LoKr só mexe no DiT, então os códigos do LM servem para qualquer coluna. A versão nova do
`testar-lora.mjs` gera os códigos uma vez por prompt e injeta os mesmos em todas as colunas (só na
bancada; o `handler.py` não muda). Ainda não rodou num pod.

- **Prompts:** ficam em `scripts/lora/prompts-teste/<estilo>.json` (copie o `country.json`). Use
  prompts **fora do dataset**: o que interessa é o estilo numa música nova, não repetir o treino.
  Inclua um prompt `"controle": true` de outro estilo. Se o adapter puxar o controle para o estilo
  do dataset, ele só pode ser ligado quando o usuário escolhe aquele estilo. Um prompt com
  `"familias": ["sft"]` só roda no XL-SFT (ex.: variação de aderência, que o turbo ignora).
- **Gatilho:** se o treino usou `--tag`, o script põe o gatilho no caption dos dois lados do A/B.
- **Resultado:** `docs/benchmarks/lora-<estilo>/<data>/pareado-<data da rodada>/escuta.md`, uma
  pasta nova a cada execução (as rodadas antigas, gravadas direto em `<data>/`, ficam intactas:
  o `experimento-render.mjs` lê os códigos e os FLACs delas). É uma folha de escuta **cega**.
  Cada prompt ganha uma letra, e as variações dele aparecem com nomes neutros (A1, A2...) em ordem
  embaralhada, com link para a cópia em `cega/`. O mapa nome → variação fica só no
  `gabarito.json`. Dê as notas antes de abrir o `gabarito.json` ou a pasta `audio/`, que têm os
  nomes reais.
- **Custo:** medido em 01/10/2026 com o `modern-metal` (3 prompts × 90 s, versão final, 9 faixas)
  numa L4: **19 min de pod, ~US$ 0,16**. São ~100 s de GPU por faixa de 90 s com o LoKr carregado,
  mesmo com a força em 0 (sem ele carregado, ~48 s), e ~2 min para carregar o XL-SFT com o LoKr.
  Com `--checkpoints=todos` o tempo cresce por checkpoint; o `--simular` mostra a estimativa.
  Cuidado: com o `--salvar-a-cada` pequeno, `todos` multiplica as faixas (500 épocas a cada 10 são
  50 checkpoints, cada um com uma faixa por prompt e por força). Prefira uma lista
  (`--checkpoints=epoca-100,epoca-200,final`).
- **O pod:** destruído no fim, em erro, com Ctrl+C ou no teto (`--max-min`, padrão 60).
- **DoRA:** antes de criar o pod, o script lê o `lokr_config` do adapter e recusa um treinado com
  DoRA.
- **1ª rodada (modern-metal, 01/10/2026):** as 9 faixas soaram com distorção robótica, inclusive
  as de referência. Causa: o adapter tinha DoRA, e a referência rodava no mesmo processo com
  multiplicador 0, o que deixava o adapter quase inteiro aplicado. A referência agora roda sem
  adapter carregado. Nada se conclui sobre o adapter em si: o instrumental do XL-SFT falha mesmo
  sem adapter, e as colunas não eram pareadas (ver a 3ª rodada).
- **2ª rodada (modern-metal, sem DoRA, lr 0,03):** o loss divergiu na época 30 (de ~0,2 para
  ~0,43) e só o `dueto--base` soou bem. Até `riff--base` e `controle--base`, sem adapter, saíram
  robóticos. A suspeita era o CFG 7 que o handler usa nos instrumentais do SFT (a voz usa 6). A
  rodada 3 derrubou o CFG 7 como causa única (ver abaixo).
- **3ª rodada (eletronics, 02/10/2026):** dois adapters, XL-turbo (`2026-10-02T10-01-07-turbo`) e
  XL-SFT com o trainer remendado (`2026-10-02T10-01-06-sft`), 60 épocas, lr 0,03, os dois estáveis
  (loss final 0,18 e 0,22; não comparáveis, porque os trainers sorteiam timesteps diferentes).
  Checkpoints a cada 20 épocas: os dois têm `epoca-20`, `epoca-40`, `epoca-60` e o `final` no R2,
  prontos para comparar épocas num teste pareado (`--checkpoints=todos`).
  Treinos US$ 0,58 + ~US$ 0,60, testes US$ 0,12 + US$ 0,20. **A/B não pareado:** cada coluna teve
  códigos do LM diferentes, então as diferenças entre colunas não são prova sobre o adapter.
  - **Escuta, XL-SFT:** só os vocais passaram (`vocal--base` e `vocal--final--s050`). Os
    instrumentais saíram ruins em todas as colunas, inclusive sem adapter.
  - **Escuta, XL-turbo:** instrumentais aceitáveis. A melhor foi `pista--final--s050` ("muito bem
    construído e coerente"). As duas `pista` a 1,0 tiveram "queda de volume entre blocos" (2 de 2,
    contra 0 de 4 no base e a 0,5; p≈0,07). O vocal caiu com a força (base "muito boa", 0,5
    "mediana", 1,0 "bem estranho"), com n=1 por célula. No turbo, `pista-cfg6` é uma réplica de
    `pista`: o turbo ignora a aderência.
  - **Instrumental XL-SFT falha sem adapter:** 5 de 5 instrumentais base reprovados (eletronics
    `pista`, `pista-cfg6`, `controle`; modern-metal `riff`, `controle`). Os vocais base passaram
    (2 de 2). O adapter não é a causa.
  - **CFG 7 caiu como causa única:** CFG 6 (`pista-cfg6`) não resolveu (n=1), e o Midnight S50N
    passou com CFG 7. O CFG pode ainda pesar: CFG ≤5 e `cfg_interval_end` < 1 nunca foram testados.
    A causa segue aberta (render do XL-SFT, plano do LM ou formato do pedido).
  - **Decode tiled do VAE descartado:** todo job decodificou em blocos de 128 com overlap 32, uma
    costura a cada 2,56 s. Na réplica com o checkpoint real, a costura muda o nível em ≤0,015 dB
    (bf16). Só 66 de 960 mergulhos caem a <100 ms de uma costura, contra ~75 por acaso. No turbo,
    as quedas seguem a grade musical (compasso, frase, breakdown). No SFT, seguem sem explicação.
- **Experimento de render (`experimento-render.mjs`):** reaproveita os códigos do LM registrados
  na rodada 3 e renderiza o mesmo plano no XL-SFT e no XL-turbo, mudando uma variável por vez
  (CFG, janela de CFG, letra), sem adapter no SFT. Separa "plano do LM" de "render do DiT" e
  confere se o toggle do LoKr altera o áudio. **Ainda não rodou.**

### 6. Usar na geração (depois do A/B de escuta)

O `apps/gpu-worker/handler.py` já sabe carregar adapters:

| Onde | O quê |
|---|---|
| `ACESTEP_LORA_DIR` | pasta com um adapter por subpasta (`<dir>/forro/lokr_weights.safetensors`). Vazio = nada muda |
| input `lora` | nome do adapter para este job; sem ele, o adapter fica desligado |
| input `lora_scale` | força de 0 a 1 (padrão 1) |

Regras do handler:
- **Na inicialização:** os adapters são carregados **desligados**. Um adapter que não carrega
  derruba o worker na inicialização, sem gerar música errada em silêncio.
- **Desligado não é de graça:** desligar só põe o multiplicador em 0, e o LyCORIS continua
  reconstruindo o delta em cada passo. Cada passo do DiT fica 3 a 5 vezes mais lento (warm-up turbo
  0,09 → 0,43 s/passo; SFT 0,08 → 0,46 s/passo; job SFT de 90 s com multiplicador 0: ~100 s contra
  ~48 s). O `bypass_mode` não elimina o custo; só descarregar (`restore()`) ou mesclar elimina.
  **Nunca carregue um LoKr no endpoint compartilhado v1/v1.5:** todo job dele ficaria mais lento.
  Adapter só em endpoint dedicado ao estilo.
- **Um LoKr por imagem:** o ACE-Step não soma um LoKr a outro adapter. Vários estilos na mesma
  imagem pedem LoRA (PEFT), não LoKr.
- **Só na família em que foi treinado:** a imagem `v2-sft` leva só adapters treinados no XL-SFT.

Ainda falta, e fica para depois de o adapter ser escutado com códigos pareados:
- colocar o adapter na imagem de um endpoint dedicado;
- passar `lora` a partir do worker (`buildJobInput`);
- decidir como o usuário escolhe o estilo.

## O que não foi testado

- **O fluxo completo com áudio de verdade.** Os scripts foram validados em simulação, e as rotas da
  API de treino foram lidas no código do commit fixado da imagem (`dce6214`). A primeira execução
  real deve ser com 1 ou 2 faixas.
- **A qualidade da transcrição da letra** pelo LM do ACE-Step em português.
- **O A/B pareado e o experimento de render.** A injeção de códigos do LM ainda não rodou num pod.
  A primeira execução deve conferir que o render sem adapter sai igual ao FLAC original e que o log
  não tem `Phase 2: Generating audio codes`.
