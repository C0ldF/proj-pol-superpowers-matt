-- 0042_forca_por_area.sql
CREATE OR REPLACE FUNCTION public.forca_por_area(
  p_granularidade public.granularidade_calor_enum,
  p_actor_uid uuid
) RETURNS TABLE (
  area_id text,
  forca integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel public.papel_login;
BEGIN
  SELECT campanha_id, papel INTO v_campanha_id, v_papel
    FROM public.usuario_campanha WHERE user_id = p_actor_uid;
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    CASE WHEN p_granularidade = 'zona' THEN lv.zona_id::text
         ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
    count(p.id)::integer AS forca
  FROM public.pessoa p
  JOIN public.secao s ON s.id = p.secao_id
  JOIN public.local_votacao lv ON lv.id = s.local_id
  WHERE p.campanha_id = v_campanha_id
    AND p.deleted_at IS NULL
    AND (
      v_papel IN ('gestor', 'coordenador')
      OR public.pessoa_em_subarvore_do_actor(p_actor_uid, p.id)
    )
  GROUP BY 1;
END;
$$;
REVOKE ALL ON FUNCTION public.forca_por_area(public.granularidade_calor_enum, uuid) FROM public, authenticated, anon;
