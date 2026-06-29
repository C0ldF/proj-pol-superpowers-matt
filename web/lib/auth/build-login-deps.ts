import { cookies } from 'next/headers';
import { adminClient } from '../supabase/server';
import { ssrClient } from '../supabase/ssr';
import { cpfHmac } from '../cpf-hmac';
import type { LoginDeps } from './login';

export async function buildLoginDeps(): Promise<LoginDeps> {
  const admin = adminClient();
  const ssr = ssrClient(await cookies());

  return {
    cpfHmac: (cpf) => cpfHmac(cpf),
    resolverEmailPorCpf: async (subdominio, hmac) => {
      const { data } = await admin.rpc('auth_login_email', { p_subdominio: subdominio, p_cpf_hmac: hmac });
      return (data as string | null) ?? null;
    },
    campanhaIdPorSubdominio: async (subdominio) => {
      const { data } = await admin.from('campanha').select('id').eq('subdominio', subdominio).maybeSingle();
      return data?.id ?? null;
    },
    signIn: async (email, senha) => {
      const { data, error } = await ssr.auth.signInWithPassword({ email, password: senha });
      if (error || !data.user) return null;
      const meta = data.user.app_metadata as { campanha_id?: string };
      return meta.campanha_id ?? null;
    },
    signOut: async () => { await ssr.auth.signOut(); },
    registrarEvento: async (acao, campanhaId, meta) => {
      await admin.rpc('registrar_evento_auth', {
        p_campanha_id: campanhaId, p_actor_id: null, p_acao: acao, p_meta: meta,
      });
    },
  };
}
