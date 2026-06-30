CREATE TABLE public.notificacao (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id          uuid        NOT NULL REFERENCES public.campanha(id),
  destinatario_user_id uuid        NOT NULL REFERENCES auth.users(id),
  tipo                 text        NOT NULL,
  payload              jsonb       NOT NULL DEFAULT '{}',
  lido_em              timestamptz,
  criado_em            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notificacao_destinatario_idx ON public.notificacao (destinatario_user_id) WHERE lido_em IS NULL;

ALTER TABLE public.notificacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificacao FROM anon, public;

-- destinatário vê só as próprias
CREATE POLICY "notificacao_select" ON public.notificacao
  FOR SELECT TO authenticated
  USING (destinatario_user_id = auth.uid());

-- marcar como lida
CREATE POLICY "notificacao_update" ON public.notificacao
  FOR UPDATE TO authenticated
  USING (destinatario_user_id = auth.uid())
  WITH CHECK (destinatario_user_id = auth.uid());

-- INSERT/DELETE: apenas via funções SECURITY DEFINER (service_role)
-- nenhum grant de INSERT/DELETE para authenticated
