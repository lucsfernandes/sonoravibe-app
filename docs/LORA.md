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

O treino seguinte usa o revisado e não rotula de novo.

### 4. Treinar

```bash
node scripts/lora/treinar-lora.mjs forro                 # 500 épocas
node scripts/lora/treinar-lora.mjs forro --epocas=800    # 10 a 20 faixas: o tutorial sugere ~800
```

- **O que treina:** LoKr sobre o **XL-SFT** (v2.0 e v2.5), com os padrões do tutorial (lr 0,03,
  dim 64, alpha 128).
- **Quanto custa:** pela documentação, ~5 min de GPU, ou seja, centavos numa L4.
- **Onde fica o resultado:** o adapter vai para `lora/forro/adapters/<data>/lokr_weights.safetensors`.
- **O pod:** usa a mesma imagem do worker (digest fixo) e é destruído no fim, em erro, com Ctrl+C
  ou no teto de tempo (`--max-min`).
- **Credenciais:** o pod nunca recebe as credenciais do R2, só URLs assinadas.

### 5. Usar na geração (depois do A/B de escuta)

O `apps/gpu-worker/handler.py` já sabe carregar adapters:

| Onde | O quê |
|---|---|
| `ACESTEP_LORA_DIR` | pasta com um adapter por subpasta (`<dir>/forro/lokr_weights.safetensors`). Vazio = nada muda |
| input `lora` | nome do adapter para este job; sem ele, o adapter fica desligado |
| input `lora_scale` | força de 0 a 1 (padrão 1) |

Regras do handler:
- **Na inicialização:** os adapters são carregados **desligados**. Um adapter que não carrega
  derruba o worker na inicialização, sem gerar música errada em silêncio.
- **Um LoKr por imagem:** o ACE-Step não soma um LoKr a outro adapter. Vários estilos na mesma
  imagem pedem LoRA (PEFT), não LoKr.
- **Só na família em que foi treinado:** a imagem `v2-sft` leva só adapters treinados no XL-SFT.

Ainda falta, e fica para depois de o adapter ser escutado:
- colocar o adapter na imagem;
- passar `lora` a partir do worker (`buildJobInput`);
- decidir como o usuário escolhe o estilo.

## O que não foi testado

- **O fluxo completo com áudio de verdade.** Os scripts foram validados em simulação, e as rotas da
  API de treino foram lidas no código do commit fixado da imagem (`dce6214`). A primeira execução
  real deve ser com 1 ou 2 faixas.
- **A qualidade da transcrição da letra** pelo LM do ACE-Step em português.
