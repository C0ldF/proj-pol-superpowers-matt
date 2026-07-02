import { adminClient } from '../../lib/supabase/server';
import type { LoteDeps } from './lote';

export function buildLoteDeps(): LoteDeps {
  const admin = adminClient();

  return {
    async buscarLote(importacaoId) {
      const { data, error } = await admin
        .from('importacao_tre')
        .select('status, municipio_id, ano')
        .eq('id', importacaoId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { status: data.status, municipioId: data.municipio_id, ano: data.ano };
    },

    async atualizarStatus(importacaoId, status, publicadoEm) {
      const payload: Record<string, unknown> = { status };
      if (publicadoEm) payload.publicado_em = publicadoEm;
      const { error } = await admin.from('importacao_tre').update(payload).eq('id', importacaoId);
      if (error) throw error;
    },

    async detectarReconciliacao(importacaoId) {
      const { data, error } = await admin.rpc('detectar_reconciliacao_bairro', { p_importacao_id: importacaoId });
      if (error) throw error;
      return (data as number) ?? 0;
    },

    async listarLotes() {
      const { data, error } = await admin
        .from('importacao_tre')
        .select('id, municipio_id, ano, status, total_publicados, total_staging, total_erros, publicado_em')
        .order('iniciado_em', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        municipioId: r.municipio_id,
        ano: r.ano,
        status: r.status,
        totalPublicados: r.total_publicados,
        totalStaging: r.total_staging,
        totalErros: r.total_erros,
        publicadoEm: r.publicado_em,
      }));
    },
  };
}
