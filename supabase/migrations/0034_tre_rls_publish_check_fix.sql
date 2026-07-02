-- Task 7 follow-up: local_votacao_select's EXISTS on importacao_tre never
-- matched under role=authenticated, because importacao_tre has deny-all RLS
-- (no SELECT policy) -- the subquery itself was blocked before the WHERE
-- clause could even be evaluated. Fix: check publish status through a
-- SECURITY DEFINER function that bypasses importacao_tre's RLS internally,
-- and grant EXECUTE to authenticated (unlike the ingest-only match functions,
-- which revoke EXECUTE from authenticated).

CREATE OR REPLACE FUNCTION public.importacao_esta_publicada(p_importacao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.importacao_tre
     WHERE id = p_importacao_id AND status = 'publicado'
  );
$$;
REVOKE ALL ON FUNCTION public.importacao_esta_publicada(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.importacao_esta_publicada(uuid) TO authenticated;

DROP POLICY "local_votacao_select" ON public.local_votacao;
CREATE POLICY "local_votacao_select" ON public.local_votacao
  FOR SELECT TO authenticated
  USING (public.importacao_esta_publicada(importacao_id));

-- secao_select delegates to local_votacao's own (now-correct) RLS: the
-- subquery below only sees a row when local_votacao_select already allows
-- it, so no need to duplicate the publish check here.
DROP POLICY "secao_select" ON public.secao;
CREATE POLICY "secao_select" ON public.secao
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.local_votacao l WHERE l.id = secao.local_id)
  );
