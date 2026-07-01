ALTER TABLE public.papel_prioridade ENABLE ROW LEVEL SECURITY;

CREATE POLICY "papel_prioridade_select"
  ON public.papel_prioridade
  FOR SELECT
  USING (true);
