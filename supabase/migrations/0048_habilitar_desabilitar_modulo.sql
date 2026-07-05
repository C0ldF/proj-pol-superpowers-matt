-- 0048_habilitar_desabilitar_modulo.sql
CREATE OR REPLACE FUNCTION public.habilitar_modulo(
  p_campanha_id uuid,
  p_modulo public.modulo_enum
) RETURNS boolean
LANGUAGE sql STRICT SECURITY DEFINER SET search_path = ''
AS $$
  WITH atualizado AS (
    UPDATE public.campanha
       SET modulos_habilitados = CASE
             WHEN modulos_habilitados ? p_modulo::text THEN modulos_habilitados
             ELSE modulos_habilitados || to_jsonb(p_modulo::text)
           END
     WHERE id = p_campanha_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM atualizado);
$$;
REVOKE ALL ON FUNCTION public.habilitar_modulo(uuid, public.modulo_enum) FROM public, authenticated, anon;

CREATE OR REPLACE FUNCTION public.desabilitar_modulo(
  p_campanha_id uuid,
  p_modulo public.modulo_enum
) RETURNS boolean
LANGUAGE sql STRICT SECURITY DEFINER SET search_path = ''
AS $$
  WITH atualizado AS (
    UPDATE public.campanha c
       SET modulos_habilitados = coalesce((
             SELECT jsonb_agg(elem)
               FROM jsonb_array_elements_text(c.modulos_habilitados) elem
              WHERE elem <> p_modulo::text
           ), '[]'::jsonb)
     WHERE c.id = p_campanha_id
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM atualizado);
$$;
REVOKE ALL ON FUNCTION public.desabilitar_modulo(uuid, public.modulo_enum) FROM public, authenticated, anon;
