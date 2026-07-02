CREATE TABLE public.bairro_oficial (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id      integer     NOT NULL REFERENCES public.municipio(cod_ibge),
  nome              text        NOT NULL,
  nome_normalizado  text        NOT NULL,
  regiao            text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bairro_oficial_unico UNIQUE (municipio_id, nome_normalizado)
);

CREATE INDEX bairro_oficial_trgm_idx
  ON public.bairro_oficial USING gin (nome_normalizado extensions.gin_trgm_ops);

ALTER TABLE public.bairro_oficial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bairro_oficial FROM anon, public;
