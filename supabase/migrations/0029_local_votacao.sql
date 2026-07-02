CREATE TABLE public.local_votacao (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id          uuid        NOT NULL REFERENCES public.importacao_tre(id),
  zona_id                uuid        NOT NULL REFERENCES public.zona_eleitoral(id),
  bairro_oficial_id      uuid        NOT NULL REFERENCES public.bairro_oficial(id),
  bairro_nome_original   text        NOT NULL,
  num_local              integer     NOT NULL,
  nome                   text        NOT NULL,
  endereco               text,
  cep                    text,
  geo                    extensions.geometry(Point, 4326),
  geo_status             public.geo_status_enum NOT NULL DEFAULT 'pendente',
  tipo                   public.tipo_local_enum NOT NULL,
  situacao               public.situacao_local_enum NOT NULL,
  qtd_aptos              integer     NOT NULL DEFAULT 0,
  qtd_cancelados         integer,
  qtd_suspensos          integer,
  qtd_vagas_reservadas   integer,
  qtd_base_historica     integer,
  telefone               text,
  data_criacao_tre       timestamptz,
  elegivel_calor         boolean     NOT NULL DEFAULT false,
  avisos                 text[]      NOT NULL DEFAULT '{}',
  row_hash               text        NOT NULL,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_votacao_unico UNIQUE (importacao_id, num_local),
  CONSTRAINT local_votacao_aptos_check CHECK (qtd_aptos >= 0),
  CONSTRAINT local_votacao_cancelados_check CHECK (qtd_cancelados >= 0),
  CONSTRAINT local_votacao_suspensos_check CHECK (qtd_suspensos >= 0),
  CONSTRAINT local_votacao_vagas_check CHECK (qtd_vagas_reservadas >= 0),
  CONSTRAINT local_votacao_historica_check CHECK (qtd_base_historica >= 0)
);

CREATE INDEX idx_local_votacao_geo ON public.local_votacao USING gist (geo);
CREATE INDEX idx_local_votacao_bairro_oficial ON public.local_votacao (bairro_oficial_id);
CREATE INDEX idx_local_votacao_row_hash ON public.local_votacao (row_hash);
CREATE INDEX idx_local_votacao_importacao ON public.local_votacao (importacao_id);

ALTER TABLE public.local_votacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_votacao FROM anon, public;
