import { adminClient } from '../../lib/supabase/server';
import type { CriarSuperadminDeps } from './criar-superadmin';

export function buildCriarSuperadminDeps(): CriarSuperadminDeps {
  const admin = adminClient();
  return {
    async criarAuthUser(email, senha) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true,
      });
      if (error || !data.user) throw new Error(error?.message ?? 'falha ao criar usuário');
      return data.user.id;
    },
    async inserirSuperadmin(userId) {
      const { error } = await admin.from('superadmin').insert({ user_id: userId });
      if (error) throw new Error(error.message);
    },
    async removerAuthUser(userId) {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}
