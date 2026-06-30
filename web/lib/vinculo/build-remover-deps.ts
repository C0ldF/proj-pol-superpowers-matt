import { adminClient } from '../supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import type { RemoverVinculoDeps } from './remover';

export function buildRemoverDeps(supabase: SupabaseClient): RemoverVinculoDeps {
  return {
    async subarvoreCount(vinculo_id) {
      const { data, error } = await adminClient().rpc('subarvore_count', { p_vinculo_id: vinculo_id });
      if (error) throw error;
      return data as number;
    },
    async realocarSubarvore(vinculo_id, destino_id) {
      const { error } = await adminClient().rpc('realocar_subarvore', {
        p_vinculo_id: vinculo_id,
        p_novo_responsavel_id: destino_id,
      });
      if (error) throw error;
    },
    async deletarVinculo(vinculo_id) {
      // Use user-scoped client so RLS policy vinculo_delete (actor_pode_remover_vinculo) is enforced
      const { error } = await supabase.from('vinculo').delete().eq('id', vinculo_id);
      if (error) throw error;
    },
  };
}
