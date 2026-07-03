-- 0043_mapa_calor_agregado.sql
CREATE OR REPLACE FUNCTION public.mapa_calor_agregado(
  granularidade public.granularidade_calor_enum
) RETURNS TABLE (
  area_id text,
  area_nome text,
  forca integer,
  potencial integer,
  penetracao numeric,
  ponto_geojson jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Só GRANT'ada pra authenticated (que sempre carrega um JWT válido), então
  -- auth.uid() NULL não deveria acontecer na prática — mas retorna vazio em
  -- vez de assumir, mesmo padrão de defesa do "sem campanha_id" acima.
  IF auth.uid() IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    pa.area_id, pa.area_nome,
    coalesce(fa.forca, 0),
    pa.potencial,
    CASE WHEN pa.potencial > 0
         THEN round(coalesce(fa.forca, 0)::numeric / pa.potencial, 4)
         ELSE NULL END,
    pa.ponto_geojson
  FROM public.potencial_por_area(granularidade) pa
  LEFT JOIN public.forca_por_area(granularidade, auth.uid()) fa ON fa.area_id = pa.area_id
  -- zona: area_nome é número de zona como texto (ordena numericamente via lpad);
  -- bairro: area_nome é nome alfabético (ordena como texto normal).
  ORDER BY CASE WHEN granularidade = 'zona' THEN lpad(pa.area_nome, 10, '0') ELSE pa.area_nome END;
END;
$$;
REVOKE ALL ON FUNCTION public.mapa_calor_agregado(public.granularidade_calor_enum) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mapa_calor_agregado(public.granularidade_calor_enum) TO authenticated;
