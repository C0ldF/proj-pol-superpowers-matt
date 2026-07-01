ALTER TABLE public.usuario_campanha
  ADD COLUMN pessoa_id uuid REFERENCES public.pessoa(id) ON DELETE SET NULL;

CREATE INDEX uc_pessoa_id_idx ON public.usuario_campanha (pessoa_id) WHERE pessoa_id IS NOT NULL;
