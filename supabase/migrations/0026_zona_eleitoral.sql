CREATE TABLE public.zona_eleitoral (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  integer     NOT NULL REFERENCES public.municipio(cod_ibge),
  numero        integer     NOT NULL,
  nome          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zona_eleitoral_unica UNIQUE (municipio_id, numero)
);

CREATE INDEX zona_eleitoral_municipio_idx ON public.zona_eleitoral (municipio_id);

ALTER TABLE public.zona_eleitoral ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zona_eleitoral FROM anon, public;
