# Apontar sonoravibe.com (Cloudflare) para a VPS na Hostinger

O domínio está na Cloudflare e a aplicação roda no k3s da Hostinger. São dois
caminhos possíveis, e a diferença entre eles não é cosmética: ela decide como o
certificado TLS é emitido.

---

## Decisão: proxy ligado ou desligado

A Cloudflare mostra um ícone de nuvem ao lado de cada registro DNS.

| | Nuvem **laranja** (proxy ligado) | Nuvem **cinza** (só DNS) |
|---|---|---|
| Quem atende o visitante | Cloudflare, que repassa para a VPS | A VPS, diretamente |
| IP da VPS | escondido | público, visível em qualquer `dig` |
| Proteção contra DDoS e cache | sim | não |
| Certificado do Let's Encrypt | exige desafio **DNS-01** | HTTP-01 funciona |
| Esforço | um token de API a mais | nenhum |

**Recomendo a laranja**, por dois motivos concretos neste projeto: o IP da sua
VPS hospeda outros sistemas seus, e o R2 (onde ficam os áudios) já é Cloudflare
— manter tudo atrás do mesmo proxy simplifica o dia a dia.

O repositório já está configurado para a laranja. Se preferir a cinza, troque
`letsencrypt-cloudflare` por `letsencrypt-prod` nos dois arquivos de ingress e
pule a seção 2.

### Por que o HTTP-01 não funciona com o proxy ligado

O desafio HTTP-01 pede que o Let's Encrypt acesse
`http://sonoravibe.com/.well-known/acme-challenge/<token>` e encontre lá uma
resposta do seu servidor. Com o proxy ligado, quem responde nesse endereço é a
Cloudflare — e aí o processo trava num impasse:

- Com **Always Use HTTPS** ligado, a Cloudflare redireciona o desafio para
  HTTPS, e o Let's Encrypt só conclui se a origem já tiver certificado válido.
  Que é justamente o que estamos tentando emitir.
- Com o modo SSL em **Full (strict)**, a Cloudflare recusa uma origem sem
  certificado válido e devolve 526 antes do desafio chegar.

O DNS-01 não depende de porta: o cert-manager cria um registro TXT na própria
Cloudflare e o Let's Encrypt consulta esse TXT. Funciona com o proxy ligado e
antes mesmo de a aplicação estar no ar.

---

## 1. Registros DNS na Cloudflare

Painel da Cloudflare → `sonoravibe.com` → **DNS** → **Records**.

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| A | `@` | `<IP da VPS>` | laranja |
| A | `api` | `<IP da VPS>` | laranja |
| CNAME **ou** A | `www` | `sonoravibe.com` **ou** `<IP da VPS>` | laranja |

**Sobre o `www`:** um CNAME apontando para `sonoravibe.com` funciona perfeitamente com o proxy
ligado — e é até preferível a um registro A, porque no dia em que o IP da VPS mudar você troca um
registro só, em vez de três. Se o seu `www` já é CNAME para o domínio raiz, **não mexa**: só
confira se a nuvem está laranja.

Troque para A apenas se o CNAME atual apontar para outro lugar (uma página de estacionamento da
Hostinger, um host antigo, um construtor de sites).

O `cdn` fica para a seção 4 — ele não aponta para a VPS.

Descubra o IP da VPS no painel da Hostinger, ou rodando `curl -4 ifconfig.me`
dentro dela.

### Firewall da VPS

O Traefik precisa receber nas portas 80 e 443. Na Hostinger, confira em
**VPS → Firewall**, e no sistema:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

A porta 80 continua necessária mesmo com o DNS-01: é por ela que o Traefik
redireciona para HTTPS quem digita o endereço sem `https://`.

---

## 2. Token de API para o cert-manager

**My Profile → API Tokens → Create Token → Create Custom Token**

| Campo | Valor |
|---|---|
| Permissões | `Zone` → `DNS` → **Edit** |
| | `Zone` → `Zone` → **Read** |
| Recursos de zona | Include → Specific zone → `sonoravibe.com` |

Use um token com escopo de zona, **não a Global API Key**: a chave global dá acesso a toda a sua
conta Cloudflare, inclusive ao R2 e ao faturamento. Um token de zona vazado só mexe no DNS deste
domínio.

> **Se o desafio falhar com erro de permissão para listar zonas**, troque os recursos para
> *Include → All zones*, mantendo as mesmas duas permissões. O cert-manager consulta o endpoint de
> listagem de zonas para descobrir o ID da zona, e a documentação oficial dele pede *All zones* por
> causa disso. Comece pelo escopo restrito: nas versões atuais ele costuma bastar, e só vale abrir
> mais se der erro.

**Confira o token antes de colocar no cluster** — dois comandos que evitam depurar isto de dentro
do Kubernetes:

```bash
# Deve responder "status": "active"
curl -s -H "Authorization: Bearer SEU_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify

# Deve devolver a zona sonoravibe.com e o id dela
curl -s -H "Authorization: Bearer SEU_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=sonoravibe.com"
```

Guarde o token no cluster e aplique o emissor:

```bash
kubectl create secret generic cloudflare-api-token \
  --namespace cert-manager \
  --from-literal=api-token='<o token>'

kubectl apply -f k8s/cert-manager/clusterissuer-cloudflare.yaml
kubectl get clusterissuer letsencrypt-cloudflare   # READY=True
```

O secret vai no namespace `cert-manager` porque um `ClusterIssuer` é um objeto
global: ele lê segredos do namespace onde o cert-manager roda, não do namespace
da aplicação.

---

## 3. Configurações da Cloudflare que afetam este app

**SSL/TLS → Overview → Configure**

| Configuração | Valor | Por quê |
|---|---|---|
| Modo de criptografia | **Full (strict)** | Cloudflare valida o certificado da origem. Em "Flexible" o trecho Cloudflare→VPS fica em HTTP puro: o cookie de sessão viajaria em claro dentro da internet. |
| Always Use HTTPS | ligado | — |
| Minimum TLS Version | 1.2 | — |

> **Ordem importa:** só mude para *Full (strict)* **depois** que os certificados
> estiverem emitidos (seção 5). Antes disso a Cloudflare devolve 526.

**Speed → Optimization**

| Configuração | Valor | Por quê |
|---|---|---|
| Auto Minify / Rocket Loader | **desligado** | Reescrevem o JavaScript e quebram a hidratação do Next.js, com sintomas difíceis de diagnosticar (botões que não respondem só em produção). |
| Brotli | pode deixar ligado | — |

**Caching → Configuration**

O padrão serve. Só não crie regra de cache para `api.sonoravibe.com`: respostas
de API com sessão não podem ser cacheadas — um usuário receberia a biblioteca do
outro.

### O SSE atravessa o proxy da Cloudflare?

Sim, e este app já está preparado. Dois detalhes que costumam derrubar streaming
atrás da Cloudflare, e como cada um está resolvido aqui:

- A Cloudflare encerra conexão ociosa. O `/generations/stream` manda um evento
  `ping` a cada 25 segundos, justamente para a conexão nunca ficar ociosa.
- A Cloudflare não faz buffer de `text/event-stream`, que é o `Content-Type`
  que o `@Sse()` do Nest emite.

Se um dia o progresso da geração parar de aparecer e pular direto para 100%,
comece checando se alguma regra nova de cache ou de compressão foi criada para
`api.sonoravibe.com`.

---

## 4. `cdn.sonoravibe.com` → Cloudflare R2

Este registro **não aponta para a VPS**. Como o R2 já é Cloudflare, ele tem
domínio personalizado nativo:

**R2 → seu bucket → Settings → Public access → Custom Domains → Connect Domain**
→ `cdn.sonoravibe.com`

A Cloudflare cria o CNAME e emite o certificado sozinha. Não crie o registro à
mão: o painel do R2 precisa gerenciá-lo.

Isso é opcional para o produto funcionar — os downloads usam URL assinada, que
aponta para o domínio interno do R2. O domínio próprio serve para as capas
públicas não exporem `<conta>.r2.cloudflarestorage.com`.

---

## 5. Ordem de execução e verificação

```bash
# 1. Registros DNS criados e propagando
dig +short sonoravibe.com
dig +short api.sonoravibe.com
# Com o proxy ligado, isso devolve IPs da Cloudflare (104.x, 172.67.x),
# NÃO o IP da sua VPS. É o esperado — não é sinal de erro.

# 2. Emissor pronto
kubectl get clusterissuer letsencrypt-cloudflare

# 3. Deploy (GitHub Actions) e emissão dos certificados
kubectl get certificate -n sonora -w
# READY=True em sonora-web-tls e sonora-api-tls. Leva de 1 a 3 minutos.

# 4. Só agora: mude o modo SSL para Full (strict) na Cloudflare

# 5. Verificação de ponta a ponta
curl -I https://sonoravibe.com
curl -s https://api.sonoravibe.com/health
node scripts/verify-routes.mjs https://api.sonoravibe.com
```

---

## 6. Quando algo dá errado

| Sintoma | Causa provável | O que conferir |
|---|---|---|
| **521** Web server is down | Traefik não recebe na 443, ou a VPS está fora | firewall da Hostinger e `ufw status` |
| **522** Connection timed out | firewall bloqueando a Cloudflare | libere 80 e 443 |
| **526** Invalid SSL certificate | modo *Full (strict)* antes de o certificado sair | volte para *Full* até o `Certificate` ficar READY |
| **525** SSL handshake failed | Traefik sem certificado para aquele host | `kubectl get certificate -n sonora` |
| Certificado preso em `False` | token sem permissão de DNS Edit, ou zona errada | `kubectl describe challenge -n sonora` |
| **401 em tudo, mesmo logado** | `CORS_ORIGINS` sem o domínio que o navegador usa | inclui `https://www.sonoravibe.com`? |
| Progresso da geração não aparece | regra de cache ou compressão na rota da API | remova a regra para `api.sonoravibe.com` |
| Botões não respondem só em produção | Rocket Loader ou Auto Minify ligados | desligue os dois |

O erro 5xx com número (521, 522, 525, 526) é **sempre** da Cloudflare falando
sobre a origem — a página de erro diz qual dos dois lados falhou, e isso já
elimina metade das hipóteses.
