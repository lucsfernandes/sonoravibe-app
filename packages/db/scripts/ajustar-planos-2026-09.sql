-- Créditos mensais dos planos com o switch de versões (2026-09).
--
-- Por que um script: a API só SEMEIA a tabela `plans` quando ela está vazia
-- (plans.repository.ts) e nunca sobrescreve. Mudar `PLANS` no código não muda o
-- que já está no banco de produção.
--
-- O que muda: só `monthly_credits`. O preço em R$ fica igual, então as
-- assinaturas já abertas no Asaas não mudam. Quem já tem saldo continua com ele;
-- a partir da próxima renovação, recebe o valor novo.
--
-- Rodar UMA vez, no banco de produção, depois do deploy da API e do worker:
--   kubectl exec -i -n <namespace> <pod-do-postgres> -- psql -U <usuario> <banco> < este-arquivo.sql

BEGIN;

UPDATE plans SET monthly_credits = 2000 WHERE code = 'pro'     AND monthly_credits = 5000;
UPDATE plans SET monthly_credits = 5000 WHERE code = 'premier' AND monthly_credits = 20000;

-- Conferência: deve mostrar pro = 2000 e premier = 5000.
SELECT code, price_brl, monthly_credits, cycle_credits FROM plans ORDER BY sort_order;

COMMIT;
