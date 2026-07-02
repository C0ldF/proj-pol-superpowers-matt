import { adminClient } from '../../lib/supabase/server';
import type { BairrosSeedDeps } from './bairros-seed';

export function buildBairrosSeedDeps(): BairrosSeedDeps {
  const admin = adminClient();
  return {
    async upsertBairro({ municipioId, nome, nomeNormalizado, regiao }) {
      const { error } = await admin
        .from('bairro_oficial')
        .upsert(
          { municipio_id: municipioId, nome, nome_normalizado: nomeNormalizado, regiao },
          { onConflict: 'municipio_id,nome_normalizado' },
        );
      if (error) throw error;
    },
  };
}
