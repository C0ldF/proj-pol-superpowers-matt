-- Índice composto: cobre exatamente o WHERE de contar_falhas_login_recentes
-- (igualdade em campanha_id/acao/identificador_chave, intervalo em criado_em).
-- Entra desde já, não como otimização futura — audit_log é append-only e só
-- cresce (todo evento de toda campanha desde o S1).
CREATE INDEX IF NOT EXISTS audit_log_login_falha_idx ON public.audit_log (
  campanha_id,
  acao,
  (depois->>'identificador_chave'),
  criado_em DESC
);

CREATE OR REPLACE FUNCTION public.contar_falhas_login_recentes(
  p_campanha_id uuid,
  p_identificador_chave text,
  p_janela_minutos int
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.audit_log
  WHERE campanha_id = p_campanha_id
    AND acao = 'login.falha'
    AND depois->>'identificador_chave' = p_identificador_chave
    AND criado_em > now() - (p_janela_minutos || ' minutes')::interval;
$$;

REVOKE ALL ON FUNCTION public.contar_falhas_login_recentes(uuid, text, int)
  FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.contar_falhas_login_recentes(uuid, text, int)
  TO service_role;
