#!/usr/bin/env bash
# Cria o schema do banco do Sonora. Roda UMA vez, depois do primeiro deploy da API.
#
# Por que um script e não um `kubectl run`: o namespace tem PSA `restricted`, e
# um `kubectl run` pelado é rejeitado por não declarar securityContext. Além
# disso, subir a API inteira para criar tabela deixa um processo escutando para
# sempre — como Job ele nunca completaria. O manifesto em k8s/api/job-schema.yaml
# resolve os dois, e este script só preenche a imagem e acompanha o resultado.
#
# Uso:
#   bash scripts/criar-schema.sh

set -euo pipefail

NS=sonora
JOB=sonora-schema
MANIFESTO="$(dirname "$0")/../k8s/api/job-schema.yaml"

echo "Procurando a imagem que está no ar..."
IMG=$(kubectl get deploy sonora-api -n "$NS" \
  -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)

if [ -z "$IMG" ]; then
  echo "ERRO: não encontrei o Deployment sonora-api no namespace $NS." >&2
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
  echo "Schema criado. O Job some sozinho em 10 minutos."
  exit 0
fi

echo "ERRO: o Job não completou. Diagnóstico:" >&2
kubectl describe job "$JOB" -n "$NS" | tail -n 25 >&2
exit 1
