-- 0049_superadmin.sql
CREATE TABLE public.superadmin (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id),
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.superadmin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.superadmin FROM authenticated, anon, public;

-- O hook (rodando como supabase_auth_admin) precisa ler, mesmo padrão de
-- usuario_campanha (0006_papel_login_usuario_campanha.sql).
GRANT SELECT ON TABLE public.superadmin TO supabase_auth_admin;
CREATE POLICY "auth_admin_le_superadmin" ON public.superadmin
  AS PERMISSIVE FOR SELECT TO supabase_auth_admin USING (true);

-- service_role (CLI de criação e rotas administrativas do painel) lê e escreve.
GRANT SELECT, INSERT, DELETE ON TABLE public.superadmin TO service_role;

CREATE OR REPLACE FUNCTION public.actor_e_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.superadmin WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.actor_e_superadmin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actor_e_superadmin() TO authenticated;
