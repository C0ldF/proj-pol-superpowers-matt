-- S1 fix: resolve e-mail (auth.users) a partir de (subdomínio, e-mail), exigindo
-- que o e-mail pertença à campanha do subdomínio (paridade com auth_login_email).
-- SECURITY DEFINER: lê auth.users. Só service_role executa (sem oráculo p/ o app).
create or replace function public.auth_recuperar_email(p_subdominio text, p_email text)
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
     and lower(u.email) = lower(p_email)
   limit 1;
$$;

revoke execute on function public.auth_recuperar_email(text, text) from authenticated, anon, public;
grant execute on function public.auth_recuperar_email(text, text) to service_role;
