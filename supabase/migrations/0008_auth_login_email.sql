-- S1 Task 3: resolve e-mail (auth.users) a partir de (subdomínio, cpf_hmac).
-- SECURITY DEFINER: lê auth.users e usuario_campanha. Só service_role executa,
-- para nunca virar oráculo de enumeração pelo app.
create or replace function public.auth_login_email(p_subdominio text, p_cpf_hmac text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
    from public.usuario_campanha uc
    join public.campanha c on c.id = uc.campanha_id
    join auth.users u on u.id = uc.user_id
   where c.subdominio = p_subdominio
     and uc.cpf_hmac = p_cpf_hmac
   limit 1;
$$;

revoke execute on function public.auth_login_email(text, text) from authenticated, anon, public;
grant execute on function public.auth_login_email(text, text) to service_role;
