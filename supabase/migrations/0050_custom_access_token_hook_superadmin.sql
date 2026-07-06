CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  rec record;
  eh_superadmin boolean;
BEGIN
  claims := event->'claims';

  SELECT campanha_id, papel INTO rec
    FROM public.usuario_campanha WHERE user_id = (event->>'user_id')::uuid;

  SELECT EXISTS (
    SELECT 1 FROM public.superadmin WHERE user_id = (event->>'user_id')::uuid
  ) INTO eh_superadmin;

  IF jsonb_typeof(claims->'app_metadata') IS NULL THEN
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  END IF;

  IF rec.campanha_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata, campanha_id}', to_jsonb(rec.campanha_id::text));
    claims := jsonb_set(claims, '{app_metadata, papel}', to_jsonb(rec.papel::text));
  END IF;

  IF eh_superadmin THEN
    claims := jsonb_set(claims, '{app_metadata, superadmin}', 'true'::jsonb);
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
