# S0 — Fundação: contrato e operação

## Contrato de claim (JWT)
Toda policy de isolamento lê:
- `app_metadata.campanha_id` (uuid) — campanha do usuário logado.
- `app_metadata.papel` (text) — papel canônico.
Preenchido pelo Custom Access Token Hook no S1. Sem a claim, as queries
retornam vazio (deny seguro).

## Superadmin
Opera SÓ via `service_role` (env `SUPABASE_SECRET_KEY`) num backend server-side
separado. Faz bypass nativo de RLS. Não existe policy `is_superadmin` no banco.
Nunca usar a service_role no browser/middleware.

## audit_log
Append-only: INSERT/SELECT por campanha; UPDATE/DELETE revogados para
authenticated/anon. A view `campanha_publica` é SECURITY DEFINER de propósito
(expõe só subdominio/nome/status, não-PII), por isso pode aparecer no advisor.

## Testes de isolamento
Ver os SQLs da Task 8 do plano; rodam via MCP execute_sql simulando claims.
