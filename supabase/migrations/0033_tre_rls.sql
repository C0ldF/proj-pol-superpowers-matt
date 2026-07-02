CREATE POLICY "municipio_select" ON public.municipio
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "zona_eleitoral_select" ON public.zona_eleitoral
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bairro_oficial_select" ON public.bairro_oficial
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "local_votacao_select" ON public.local_votacao
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.importacao_tre i
       WHERE i.id = local_votacao.importacao_id AND i.status = 'publicado'
    )
  );

CREATE POLICY "secao_select" ON public.secao
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.local_votacao l
       JOIN public.importacao_tre i ON i.id = l.importacao_id
       WHERE l.id = secao.local_id AND i.status = 'publicado'
    )
  );
