#!/usr/bin/env bash
# Preenche a duração das músicas que nasceram com 0. Roda UMA vez.
#
# Roda DENTRO do cluster de propósito. O script `src/backfill-duracao.ts`
# também roda na máquina local, mas lá o .env aponta para o Postgres de
# desenvolvimento — e um backfill no banco errado é silencioso: ele "funciona",
# só que em dados que ninguém vê.
#
# Por que um Job e não um `kubectl run`: o namespace tem PSA `restricted`, e um
# `kubectl run` pelado é rejeitado por não declarar securityContext. O
# manifesto em k8s/worker/job-backfill-duracao.yaml resolve isso, e este script
# só preenche a imagem e acompanha o resultado.
#
# Uso:
#   bash scripts/backfill-duracao.sh

set -euo pipefail

NS=sonora
JOB=sonora-backfill-duracao
MANIFESTO="$(dirname "$0")/../k8s/worker/job-backfill-duracao.yaml"

echo "Procurando a imagem que está no ar..."
IMG=$(kubectl get deploy sonora-worker -n "$NS" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)

if [ -z "$IMG" ]; then
  echo "ERRO: não encontrei o Deployment sonora-worker no namespace $NS." >&2
  echo "      Rode o workflow 'Deploy API' primeiro — o schema usa a imagem dele." >&2
  exit 1
fi
echo "  $IMG"

# Um Job com o mesmo nome não pode ser reaplicado: os campos de template são
# imutáveis. Se sobrou de uma tentativa anterior, sai fora antes.
if kubectl get job "$JOB" -n "$NS" >/dev/null 2>&1; then
  echo "Removendo a execução anterior do Job..."
  kubectl delete job "$JOB" -n "$NS" --wait=true >/dev/null
fi

echo "Aplicando o Job..."
sed "s|REPLACE_IMAGE|${IMG}|" "$MANIFESTO" | kubectl apply -f - >/dev/null

echo "Aguardando o pod subir..."
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name="$JOB" \
  -n "$NS" --timeout=180s 2>/dev/null || true

echo
echo "─── saída ───────────────────────────────────────────"
kubectl logs -n "$NS" -l app.kubernetes.io/name="$JOB" -f --tail=-1 || true
echo "─────────────────────────────────────────────────────"
echo

if kubectl wait --for=condition=complete job/"$JOB" -n "$NS" --timeout=300s >/dev/null 2>&1; then
  echo "Duração preenchida. O Job some sozinho em 10 minutos."
  exit 0
fi

echo "ERRO: o Job não completou. Diagnóstico:" >&2
kubectl describe job "$JOB" -n "$NS" | tail -n 25 >&2
exit 1
