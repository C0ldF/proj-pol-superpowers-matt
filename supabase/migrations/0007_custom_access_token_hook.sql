-- S1 Task 2: Custom Access Token Hook. Preenche app_metadata.campanha_id/papel
-- a partir de usuario_campanha. Deny-safe: sem linha, não adiciona claim.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims jsonb;
  rec record;
begin
  claims := event->'claims';

  select campanha_id, papel into rec
    from public.usuario_campanha
   where user_id = (event->>'user_id')::uuid;

  if jsonb_typeof(claims->'app_metadata') is null then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  if rec.campanha_id is not null then
    claims := jsonb_set(claims, '{app_metadata, campanha_id}', to_jsonb(rec.campanha_id::text));
    claims := jsonb_set(claims, '{app_metadata, papel}', to_jsonb(rec.papel::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
