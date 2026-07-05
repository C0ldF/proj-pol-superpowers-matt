-- 0047_modulo_enum_e_actor_tem_modulo.sql
CREATE TYPE public.modulo_enum AS ENUM ('comunicacao', 'ia');

CREATE OR REPLACE FUNCTION public.actor_tem_modulo(
  p_modulo public.modulo_enum
) RETURNS boolean
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuario_campanha uc
      JOIN public.campanha c ON c.id = uc.campanha_id
     WHERE uc.user_id = auth.uid()
       AND c.modulos_habilitados ? p_modulo::text
  );
$$;
REVOKE ALL ON FUNCTION public.actor_tem_modulo(public.modulo_enum) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actor_tem_modulo(public.modulo_enum) TO authenticated;
