-- 0041_potencial_por_area.sql
CREATE OR REPLACE FUNCTION public.potencial_por_area(
  p_granularidade public.granularidade_calor_enum
) RETURNS TABLE (
  area_id text,
  area_nome text,
  potencial integer,
  ponto_geojson jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    CASE WHEN p_granularidade = 'zona' THEN lv.zona_id::text
         ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
    CASE WHEN p_granularidade = 'zona' THEN min(ze.numero)::text
         ELSE initcap(min(lv.bairro_nome_original)) END AS area_nome,
    sum(s.aptos)::integer AS potencial,
    -- ST_GeometricMedian: ponto que minimiza distância total até os locais
    -- reais da área — mais robusto que centroide (não cai fora da área com
    -- locais espalhados) e que casco convexo (não pousa longe de qualquer
    -- local real num agrupamento assimétrico).
    extensions.ST_AsGeoJSON(
      extensions.ST_GeometricMedian(extensions.ST_Collect(lv.geo))
    )::jsonb AS ponto_geojson
  FROM public.local_votacao lv
  JOIN public.secao s ON s.local_id = lv.id
  JOIN public.zona_eleitoral ze ON ze.id = lv.zona_id
  WHERE lv.elegivel_calor = true
  GROUP BY 1;
$$;
REVOKE ALL ON FUNCTION public.potencial_por_area(public.granularidade_calor_enum) FROM public, authenticated, anon;
