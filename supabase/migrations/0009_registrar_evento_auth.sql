-- S1 Task 4: insere evento de auth no audit_log imutável do S0.
-- audit_log não tem coluna de IP; IP e metadados vão no jsonb 'depois'.
create or replace function public.registrar_evento_auth(
  p_campanha_id uuid,
  p_actor_id uuid,
  p_acao text,
  p_meta jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (campanha_id, actor_id, acao, entidade, depois)
  values (p_campanha_id, p_actor_id, p_acao, 'auth', p_meta);
$$;

revoke execute on function public.registrar_evento_auth(uuid, uuid, text, jsonb) from authenticated, anon, public;
grant execute on function public.registrar_evento_auth(uuid, uuid, text, jsonb) to service_role;
