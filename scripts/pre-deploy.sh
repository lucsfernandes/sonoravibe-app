#!/usr/bin/env bash
# Pré-voo do primeiro deploy do Sonora.
#
# Confere no cluster o que o deploy vai precisar, ANTES de disparar o workflow.
# É tudo leitura: não cria, não altera e não apaga nada.
#
# Cada falha aqui vira um erro bem mais difícil de ler depois — um pod em
# CreateContainerConfigError ou um timeout de rede não dizem qual foi a causa.
#
# Uso, na VPS ou onde o kubectl aponte para o cluster:
#   bash scripts/pre-deploy.sh

set -uo pipefail

ok=0
falhas=0

titulo() { printf '\n\033[1m%s\033[0m\n' "$1"; }
passou() { printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1)); }
falhou() { printf '  \033[31m✗\033[0m %s\n' "$1"; falhas=$((falhas+1)); }
aviso()  { printf '  \033[33m!\033[0m %s\n' "$1"; }

titulo "1. Acesso ao cluster"
if kubectl version -o json >/dev/null 2>&1; then
  passou "kubectl conecta ($(kubectl config current-context 2>/dev/null))"
else
  falhou "kubectl não conecta — confira o KUBECONFIG"
  echo; echo "Sem acesso ao cluster não dá para conferir o resto."; exit 1
fi

titulo "2. Postgres compartilhado"
if kubectl get svc postgres-rw -n databases >/dev/null 2>&1; then
  passou "Service postgres-rw existe no namespace databases"
else
  falhou "Service postgres-rw NÃO encontrado — a DATABASE_URL vai dar timeout"
fi

# A NetworkPolicy casa o pod por esta label exata. Um caractere diferente
# (postgresql em vez de postgres) bloqueia a conexão em silêncio.
if kubectl get pods -n databases -l app.kubernetes.io/name=postgres \
     -o name 2>/dev/null | grep -q pod; then
  passou "Pod do Postgres tem a label app.kubernetes.io/name=postgres"
else
  falhou "Nenhum pod com essa label — a NetworkPolicy vai bloquear a conexão"
fi

if kubectl get ns databases -o jsonpath='{.metadata.labels.kubernetes\.io/metadata\.name}' 2>/dev/null \
     | grep -q databases; then
  passou "Namespace databases tem a label que a NetworkPolicy exige"
else
  falhou "Label kubernetes.io/metadata.name ausente no namespace databases"
fi

titulo "3. cert-manager e o emissor da Cloudflare"
if kubectl get ns cert-manager >/dev/null 2>&1; then
  passou "Namespace cert-manager existe"
else
  falhou "cert-manager não está instalado — os certificados não serão emitidos"
fi

if kubectl get secret cloudflare-api-token -n cert-manager >/dev/null 2>&1; then
  passou "Secret cloudflare-api-token está no namespace cert-manager"
else
  falhou "Secret cloudflare-api-token ausente — veja docs/CLOUDFLARE.md seção 2"
fi

estado=$(kubectl get clusterissuer letsencrypt-cloudflare \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
if [ "$estado" = "True" ]; then
  passou "ClusterIssuer letsencrypt-cloudflare está Ready"
elif [ -n "$estado" ]; then
  falhou "ClusterIssuer existe mas não está Ready — kubectl describe clusterissuer letsencrypt-cloudflare"
else
  falhou "ClusterIssuer letsencrypt-cloudflare não aplicado"
fi

titulo "4. Traefik"
ns_traefik=$(kubectl get pods -A -l app.kubernetes.io/name=traefik \
  -o jsonpath='{.items[0].metadata.namespace}' 2>/dev/null)
[ -z "$ns_traefik" ] && ns_traefik=$(kubectl get pods -A 2>/dev/null \
  | awk '/traefik/ {print $1; exit}')

if [ "$ns_traefik" = "traefik" ]; then
  passou "Traefik roda no namespace 'traefik', como a NetworkPolicy espera"
elif [ -n "$ns_traefik" ]; then
  falhou "Traefik está em '$ns_traefik', mas a NetworkPolicy libera só 'traefik'"
  aviso  "Ajuste o namespaceSelector em k8s/api/networkpolicy.yaml e k8s/web/networkpolicy.yaml"
else
  falhou "Traefik não encontrado"
fi

titulo "5. Estado do namespace do projeto"
if kubectl get ns sonora >/dev/null 2>&1; then
  aviso "Namespace sonora já existe (deploy repetido, tudo bem)"
  kubectl get pods -n sonora --no-headers 2>/dev/null | sed 's/^/      /'
else
  passou "Namespace sonora ainda não existe — será criado pelo workflow"
fi

titulo "6. DNS"
for host in sonoravibe.com www.sonoravibe.com api.sonoravibe.com; do
  if ip=$(getent hosts "$host" 2>/dev/null | head -1 | awk '{print $1}'); [ -n "${ip:-}" ]; then
    passou "$host resolve para $ip"
  else
    falhou "$host não resolve ainda"
  fi
done
aviso "Com o proxy da Cloudflare ligado, o IP acima é da Cloudflare, não da VPS. É o esperado."

printf '\n\033[1m%s\033[0m\n' "Resultado: $ok ok, $falhas falha(s)"
if [ "$falhas" -gt 0 ]; then
  echo "Resolva as falhas antes de disparar o Deploy API — elas viram erros bem mais obscuros depois."
  exit 1
fi
echo "Pronto para rodar o workflow Deploy API."
