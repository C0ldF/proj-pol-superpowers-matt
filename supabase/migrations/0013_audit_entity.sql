CREATE TABLE public.audit_entity (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id   uuid        REFERENCES public.campanha(id),
  tabela        text        NOT NULL,
  entidade_id   uuid        NOT NULL,
  antes         jsonb,
  depois        jsonb,
  actor_user_id uuid        REFERENCES auth.users(id),
  ip            inet,
  user_agent    text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- append-only: nenhum UPDATE/DELETE por usuários
ALTER TABLE public.audit_entity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_entity FROM anon, public;

-- Gestor da campanha pode SELECT
CREATE POLICY "audit_entity_gestor_select" ON public.audit_entity
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'papel'
    ) = 'gestor'
  );

-- INSERT apenas via service_role / funções SECURITY DEFINER
-- (nenhum grant de INSERT para authenticated)
