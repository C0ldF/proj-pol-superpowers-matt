import { cookies } from 'next/headers';
import { ssrClient } from '../supabase/ssr';
import type { LoginSuperadminDeps } from './login-superadmin';

export async function buildLoginSuperadminDeps(): Promise<LoginSuperadminDeps> {
  const ssr = ssrClient(await cookies());

  return {
    signIn: async (email, senha) => {
      const { data, error } = await ssr.auth.signInWithPassword({ email, password: senha });
      if (error || !data.user) return false;
      // Mesma lição do bug corrigido no S1: claims custom só existem no JWT
      // emitido pelo hook, nunca em user.app_metadata bruto.
      const { data: claimsData, error: claimsError } = await ssr.auth.getClaims();
      if (claimsError || !claimsData) return false;
      const meta = claimsData.claims.app_metadata as { superadmin?: boolean };
      return meta.superadmin === true;
    },
    signOut: async () => { await ssr.auth.signOut(); },
  };
}
