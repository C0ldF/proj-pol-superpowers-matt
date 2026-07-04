-- 0045_evolucao_pessoas.sql
CREATE OR REPLACE FUNCTION public.evolucao_pessoas()
RETURNS TABLE (dia date, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel       public.papel_login;
BEGIN
  SELECT campanha_id, papel INTO v_campanha_id, v_papel
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.dia::date,
    (
      SELECT count(*)::integer FROM public.pessoa p
       WHERE p.campanha_id = v_campanha_id
         AND p.criado_em::date <= d.dia
         AND (p.deleted_at IS NULL OR p.deleted_at::date > d.dia)
         AND (
           v_papel IN ('gestor', 'coordenador')
           -- Nota de performance: pessoa_em_subarvore_do_actor roda uma
           -- recursão própria por pessoa candidata, por dia (90 dias x N
           -- candidatos) — mesmo trade-off já aceito em forca_por_area (S4,
           -- migration 0042_forca_por_area.sql). Aceitável na escala MVP;
           -- candidato natural de otimização se a campanha crescer para
           -- dezenas de milhares de pessoas — fora de escopo aqui.
           OR public.pessoa_em_subarvore_do_actor(auth.uid(), p.id)
         )
    ) AS total
  FROM generate_series(CURRENT_DATE - 89, CURRENT_DATE, interval '1 day') AS d(dia)
  ORDER BY d.dia;
END;
$$;
REVOKE ALL ON FUNCTION public.evolucao_pessoas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.evolucao_pessoas() TO authenticated;
