import { adminClient } from '../../lib/supabase/server';
import type { RevisarDeps } from './revisar-staging';

export function buildRevisarDeps(): RevisarDeps {
  const admin = adminClient();

  return {
    async listarPendentes(importacaoId) {
      let query = admin
        .from('local_votacao_staging')
        .select('id, importacao_id, linha_original, motivos, criado_em')
        .eq('revisado', false)
        .order('criado_em', { ascending: true });
      if (importacaoId) query = query.eq('importacao_id', importacaoId);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        importacaoId: r.importacao_id,
        linhaOriginal: r.linha_original,
        motivos: r.motivos,
        criadoEm: r.criado_em,
      }));
    },

    async buscarStaging(id) {
      const { data, error } = await admin
        .from('local_votacao_staging')
        .select('importacao_id, linha_original, importacao_tre:importacao_id(municipio_id)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const municipioId = (data.importacao_tre as unknown as { municipio_id: number }).municipio_id;
      return { importacaoId: data.importacao_id, municipioId, linhaOriginal: data.linha_original };
    },

    async upsertZona({ municipioId, numero }) {
      const { data: existente } = await admin
        .from('zona_eleitoral').select('id').eq('municipio_id', municipioId).eq('numero', numero).maybeSingle();
      if (existente) return existente.id as string;
      const { data, error } = await admin
        .from('zona_eleitoral').insert({ municipio_id: municipioId, numero }).select('id').single();
      if (error) throw error;
      return data.id as string;
    },

    async inserirLocalVotacao({ importacaoId, zonaId, bairroOficialId, local }) {
      const temGeo = local.latitude !== null && local.longitude !== null;
      const { data, error } = await admin.from('local_votacao').insert({
        importacao_id: importacaoId, zona_id: zonaId, bairro_oficial_id: bairroOficialId,
        bairro_nome_original: local.bairroNomeOriginal, num_local: local.numLocal, nome: local.nome,
        endereco: local.endereco, cep: local.cep, geo_status: local.geoStatus, tipo: local.tipo,
        situacao: local.situacao, qtd_aptos: local.qtdAptos, qtd_cancelados: local.qtdCancelados,
        qtd_suspensos: local.qtdSuspensos, qtd_vagas_reservadas: local.qtdVagasReservadas,
        qtd_base_historica: local.qtdBaseHistorica, telefone: local.telefone,
        elegivel_calor: local.elegivelCalor, avisos: local.avisos, row_hash: local.rowHash,
        ...(temGeo ? { geo: `SRID=4326;POINT(${local.longitude} ${local.latitude})` } : {}),
      }).select('id').single();
      if (error) throw error;

      if (local.secoes.length > 0) {
        const { error: erroSecoes } = await admin.from('secao').insert(
          local.secoes.map((s) => ({ local_id: data.id, numero: s.numero, aptos: s.aptos })),
        );
        if (erroSecoes) throw erroSecoes;
      }
    },

    async marcarRevisado({ id, resolvidoBairroOficialId, revisadoPor }) {
      const { error } = await admin.from('local_votacao_staging').update({
        revisado: true,
        resolvido_bairro_oficial_id: resolvidoBairroOficialId,
        revisado_por: revisadoPor,
        revisado_em: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
    },
  };
}
