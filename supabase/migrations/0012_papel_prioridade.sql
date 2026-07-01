CREATE TABLE public.papel_prioridade (
  papel public.papel_vinculo PRIMARY KEY,
  prioridade integer NOT NULL
);

INSERT INTO public.papel_prioridade (papel, prioridade) VALUES
  ('gestor',      100),
  ('coordenador',  80),
  ('colaborador',  60),
  ('lideranca',    40),
  ('apoiador',      0);

-- imutável: apenas service_role escreve
REVOKE ALL ON public.papel_prioridade FROM authenticated, anon;
GRANT SELECT ON public.papel_prioridade TO authenticated;
