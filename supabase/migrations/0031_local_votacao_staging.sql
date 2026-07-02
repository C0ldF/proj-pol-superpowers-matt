CREATE TABLE public.local_votacao_staging (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id               uuid        NOT NULL REFERENCES public.importacao_tre(id),
  linha_original              jsonb       NOT NULL,
  row_hash                    text        NOT NULL,
  motivos                     text[]      NOT NULL,
  revisado                    boolean     NOT NULL DEFAULT false,
  resolvido_bairro_oficial_id uuid        REFERENCES public.bairro_oficial(id),
  revisado_em                 timestamptz,
  revisado_por                text,
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staging_motivos_check CHECK (cardinality(motivos) > 0)
);

CREATE INDEX idx_staging_linha_original ON public.local_votacao_staging USING gin (linha_original);
CREATE INDEX idx_staging_importacao_pendente ON public.local_votacao_staging (importacao_id) WHERE revisado = false;

ALTER TABLE public.local_votacao_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_votacao_staging FROM anon, public;
