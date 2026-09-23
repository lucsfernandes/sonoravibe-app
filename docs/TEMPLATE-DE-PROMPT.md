# Template de prompt: Sonora Vibe

Para compor na aba **Criar**. Cada regra abaixo vem de como o motor de geração lê os campos.
Se o motor mudar, revise este arquivo e o post
`apps/web/public/blog/como-criar-musicas-no-sonora-vibe.html`.

---

## 1. Qual aba usar

| Quero | Aba |
|---|---|
| Música **cantada com letra** | **Avançado**. A aba Simples não tem campo de letra e manda a letra vazia. |
| Instrumental rápido | Simples, com **Instrumental** ligado |
| Instrumental com BPM ou duração exata | Avançado, com a Letra vazia e **Instrumental** ligado |
| Loop ou efeito curto | Sons (5 créditos) |

---

## 2. Campo Estilos

```
[gênero principal], [subgênero ou época], [energia e andamento], [instrumento 1], [instrumento 2], [instrumento 3], [tipo de voz e idioma], [clima ou emoção], [acabamento da mixagem]
```

- **O mais importante vem primeiro.** O motor pesa mais o começo.
- **Até ~400 caracteres.** O texto final (estilo + voz + exclusões) tem teto de 512 caracteres e
  é cortado no fim. Estilo longo demais derruba a escolha de **Voz** e o **Excluir estilos**, que
  entram depois dele.
- 3 ou 4 instrumentos. Mais que isso, nenhum se destaca.
- Descreva o som em vez de citar artistas.
- Nomes de gênero como são conhecidos (lo-fi, synthwave, trap, boom bap); o resto pode ser em
  português.
- Sem contradições ("calmo e agressivo").

---

## 3. Campo Letra

```
[Intro]

[Verse]
(4 linhas curtas contando a situação)

[Pre-Chorus]
(2 linhas que preparam a subida)

[Chorus]
(4 linhas com a frase principal)

[Verse]
(4 linhas que avançam a história)

[Pre-Chorus]
(as mesmas 2 linhas)

[Chorus]
(o mesmo refrão)

[Bridge]
(2 a 4 linhas com uma virada)

[Chorus]
(o mesmo refrão)

[Outro]
(1 ou 2 linhas)
```

- Marcações disponíveis no botão **Inserir seção**: `[Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]`.
  Uma marcação sem linhas embaixo vira uma parte instrumental.
- Tudo o que está fora dos colchetes pode ser cantado: nada de instruções no meio da letra.
- Linhas de 6 a 10 sílabas, refrão sempre com as mesmas palavras, números por extenso.
- **Tamanho da letra = tamanho da música.** Com a Duração em Auto, o motor ajusta a estrutura à
  letra.

| Tamanho | Estrutura |
|---|---|
| até 2 min (limite do Free) | Intro, Verse, Pre-Chorus, Chorus, Bridge, Chorus, Outro |
| 3 a 4 min | Intro, 2× (Verse + Pre-Chorus + Chorus), Bridge, Chorus, Outro |
| 5 a 6 min (Premier + Max Mode) | a anterior + 3º Verse e partes instrumentais |

---

## 4. Mais opções

| Controle | Recomendação |
|---|---|
| Excluir estilos | 1 a 3 termos. **Nunca comece um termo com "voz", "vocal", "canto" ou "letra"** numa música cantada (nem "voz masculina"): o sistema entende como "sem voz" e gera instrumental. |
| Voz | Masculina ou Feminina quando importar. |
| Duração | **Auto** quando há letra. Um valor fixo quando é instrumental ou precisa encaixar num vídeo. |
| BPM | lo-fi ~80 · pop 100 a 125 · house 120 a 128 · drum and bass ~170. Ou Auto. |
| Tom | Opcional. Útil para combinar com outra faixa ou com um cantor. |
| Estranheza | 50. Só faz efeito em ≤ 20 (estrutura convencional) ou ≥ 80 (experimental). |
| Aderência, Variedade, Personalizar | Deixe como estão. Hoje o motor em produção não usa esses controles. |

---

## 5. Exemplos prontos

### Pop com letra: Avançado

**Estilos**
```
pop dançante, synth-pop moderno, energia alta e andamento médio-rápido, batida four-on-the-floor, baixo sintetizado pulsante, synths brilhantes, palmas no refrão, voz feminina clara e próxima em português do Brasil, clima de noite na cidade, refrão grudento, mixagem limpa e radiofônica
```
**Opções:** Instrumental desligado · Excluir: `autotune, guitarra distorcida` · Voz: Feminina ·
Duração: Auto · BPM: 118 · Título: Sinal Verde.
A letra completa está no post do blog.

### Instrumental: Avançado

**Estilos**
```
lo-fi hip hop, boom bap relaxado, batida abafada com swing, piano Rhodes quente, baixo acústico suave, chiado de vinil, chuva leve ao fundo, clima calmo de madrugada, mixagem macia e sem picos
```
**Opções:** Instrumental ligado · Letra vazia · Excluir: `bateria agressiva, synth brilhante` ·
Duração: 120 s · BPM: 80 · Título: Hora de Foco.

### Instrumental: Simples

```
Um lo-fi hip hop calmo para estudar de madrugada, com piano Rhodes quente, batida abafada, baixo suave, chiado de vinil e som de chuva ao fundo.
```
Com **Instrumental** ligado.

---

## 6. Versão para colar num assistente de IA

Cole no ChatGPT, no Claude ou em outro assistente, troque o que está entre `{chaves}` e copie a
resposta para os campos do Sonora Vibe.

```
Você é um produtor musical ajudando a preencher os campos do Sonora Vibe, uma plataforma de
geração de música com IA. Crie o pedido a partir do briefing abaixo.

BRIEFING
- Ideia / tema: {sobre o que é a música}
- Gênero: {ex.: pop, sertanejo, lo-fi}
- Clima: {ex.: nostálgico, eufórico}
- Com letra ou instrumental: {com letra | instrumental}
- Idioma da letra: {português do Brasil}
- Voz: {feminina | masculina | tanto faz}
- Duração alvo: {ex.: 2 min}  (limites: Free 2 min, Pro 4 min, Premier 6 min)
- Uso: {ex.: Reels, fundo de vídeo, lançamento}

DEVOLVA EXATAMENTE ESTES BLOCOS

1. ESTILOS: uma linha, no máximo 400 caracteres, termos separados por vírgula nesta ordem:
   gênero principal, subgênero/época, energia e andamento, 3 ou 4 instrumentos, tipo de voz e
   idioma, clima, acabamento da mixagem. Sem nomes de artistas. Sem ideias contraditórias.
2. EXCLUIR ESTILOS: de 1 a 3 termos. Se a música tiver letra, nenhum termo pode começar com
   "voz", "vocal", "canto" ou "letra".
3. LETRA (só se for com letra): use apenas as marcações [Intro] [Verse] [Pre-Chorus] [Chorus]
   [Bridge] [Outro], cada uma sozinha numa linha. Linhas de 6 a 10 sílabas, refrão idêntico
   sempre que repetir, números por extenso, nenhuma instrução ou comentário fora dos colchetes.
   Tamanho da estrutura compatível com a duração alvo:
   até 2 min = Intro, Verse, Pre-Chorus, Chorus, Bridge, Chorus, Outro;
   3 a 4 min = dois Verses com Pre-Chorus, três Choruses, Bridge, Outro.
4. OPÇÕES: Voz, Duração (Auto se tiver letra; em segundos se for instrumental), BPM sugerido,
   Instrumental (ligado ou desligado).
5. TÍTULO: até 60 caracteres.
```
