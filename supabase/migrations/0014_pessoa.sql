-- gera public_id no formato pes_XXXXXXXX (4 bytes = 8 hex chars)
CREATE OR REPLACE FUNCTION public.generate_pessoa_public_id()
RETURNS text
LANGUAGE sql
SET search_path = 'public'
AS $$
  SELECT 'pes_' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);
$$;

CREATE TABLE public.pessoa (
  id                        uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                 text               UNIQUE NOT NULL DEFAULT public.generate_pessoa_public_id(),
  campanha_id               uuid               NOT NULL REFERENCES public.campanha(id),
  nome                      text               NOT NULL,
  titulo_hmac               text,
  titulo_enc                text,
  cpf_hmac                  text,
  telefone                  text,
  email_contato             text,
  secao_id                  uuid,              -- FK para secao(id) adicionada no S3
  base_legal                public.base_legal_enum  NOT NULL DEFAULT 'legitimointeresse',
  data_coleta               timestamptz        NOT NULL DEFAULT now(),
  origem_coleta             public.origem_coleta_enum NOT NULL DEFAULT 'manual',
  consentimento_dado_em     timestamptz,
  consentimento_revogado_em timestamptz,
  deleted_at                timestamptz,
  criado_em                 timestamptz        NOT NULL DEFAULT now(),
  atualizado_em             timestamptz        NOT NULL DEFAULT now()
);

-- dedup: título único por campanha (quando presente)
CREATE UNIQUE INDEX pessoa_titulo_hmac_idx
  ON public.pessoa (campanha_id, titulo_hmac)
  WHERE titulo_hmac IS NOT NULL;

-- dedup: CPF único por campanha (quando presente)
CREATE UNIQUE INDEX pessoa_cpf_hmac_idx
  ON public.pessoa (campanha_id, cpf_hmac)
  WHERE cpf_hmac IS NOT NULL;

-- index for RLS scan by campanha
CREATE INDEX pessoa_campanha_idx ON public.pessoa (campanha_id);

ALTER TABLE public.pessoa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pessoa FROM anon, public;

-- SELECT: tenant isolation + sub-árvore (função actor_pode_ver_pessoa criada em 0016)
-- Política usa referência forward — válida pois criada depois da função existir.
-- Aqui criamos policy mínima de tenant isolation; será substituída em 0016.
CREATE POLICY "pessoa_tenant_select" ON public.pessoa
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND deleted_at IS NULL
  );

CREATE POLICY "pessoa_insert" ON public.pessoa
  FOR INSERT TO authenticated
  WITH CHECK (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

CREATE POLICY "pessoa_update" ON public.pessoa
  FOR UPDATE TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

-- hard DELETE proibido para authenticated; soft-delete via UPDATE (deleted_at)
CREATE POLICY "pessoa_delete" ON public.pessoa
  FOR DELETE TO authenticated
  USING (false);
