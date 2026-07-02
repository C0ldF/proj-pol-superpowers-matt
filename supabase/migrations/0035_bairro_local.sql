CREATE TABLE public.bairro_local (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id                 uuid        NOT NULL REFERENCES public.campanha(id),
  nome                        text        NOT NULL,
  nome_normalizado            text        NOT NULL,
  bairro_oficial_sugerido_id  uuid        REFERENCES public.bairro_oficial(id),
  status                      public.status_bairro_local_enum NOT NULL DEFAULT 'pendente',
  criado_por                  uuid        REFERENCES auth.users(id),
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bairro_local_unico UNIQUE (campanha_id, nome_normalizado)
);

CREATE INDEX bairro_local_campanha_idx ON public.bairro_local (campanha_id);

ALTER TABLE public.bairro_local ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bairro_local FROM anon, public;

CREATE POLICY "bairro_local_select" ON public.bairro_local
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

CREATE POLICY "bairro_local_insert" ON public.bairro_local
  FOR INSERT TO authenticated
  WITH CHECK (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

CREATE POLICY "bairro_local_update" ON public.bairro_local
  FOR UPDATE TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );
