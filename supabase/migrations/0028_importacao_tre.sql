CREATE TABLE public.importacao_tre (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id           integer     NOT NULL REFERENCES public.municipio(cod_ibge),
  uf                     char(2)     NOT NULL,
  ano                    integer     NOT NULL,
  status                 public.status_importacao_enum NOT NULL DEFAULT 'pendente',
  arquivo_nome           text,
  arquivo_sha256         text,
  arquivo_tamanho_bytes  bigint,
  importer_version       text        NOT NULL,
  total_linhas           integer,
  total_publicados       integer,
  total_staging          integer,
  total_erros            integer,
  operador               text,
  log                    jsonb       NOT NULL DEFAULT '{}',
  iniciado_em            timestamptz NOT NULL DEFAULT now(),
  publicado_em           timestamptz
);

CREATE UNIQUE INDEX ux_importacao_publicado
  ON public.importacao_tre (municipio_id, ano)
  WHERE status = 'publicado';

CREATE INDEX importacao_tre_municipio_idx ON public.importacao_tre (municipio_id, ano);

ALTER TABLE public.importacao_tre ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.importacao_tre FROM anon, public;
