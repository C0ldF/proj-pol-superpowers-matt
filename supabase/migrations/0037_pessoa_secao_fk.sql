ALTER TABLE public.pessoa
  ADD CONSTRAINT pessoa_secao_id_fkey FOREIGN KEY (secao_id) REFERENCES public.secao(id);
