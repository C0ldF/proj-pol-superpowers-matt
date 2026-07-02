CREATE TABLE public.secao (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id  uuid        NOT NULL REFERENCES public.local_votacao(id) ON DELETE CASCADE,
  numero    integer     NOT NULL,
  aptos     integer     NOT NULL DEFAULT 0,
  CONSTRAINT secao_unica UNIQUE (local_id, numero),
  CONSTRAINT secao_numero_check CHECK (numero > 0),
  CONSTRAINT secao_aptos_check CHECK (aptos >= 0)
);

CREATE INDEX secao_local_idx ON public.secao (local_id);

ALTER TABLE public.secao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secao FROM anon, public;
