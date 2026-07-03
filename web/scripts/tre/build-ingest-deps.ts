import { adminClient } from '../../lib/supabase/server';
import type { IngestDeps } from './ingest';

// Insere local_votacao e suas seções em duas chamadas sequenciais (não numa
// única transação SQL) — aceitável nesta fatia porque cada linha é
// independente; uma falha entre as duas deixa no máximo um local órfão sem
// seções, corrigível manualmente. Ver spec, seção "Riscos".
export function buildIngestDeps(): IngestDeps {
  const admin = adminClient();

  return {
    async upsertMunicipio({ codIbge, nome, uf }) {
      const { error } = await admin
        .from('municipio')
        .upsert({ cod_ibge: codIbge, nome, uf }, { onConflict: 'cod_ibge' });
      if (error) throw error;
    },

    async upsertZona({ municipioId, numero }) {
      const { data: existente } = await admin
        .from('zona_eleitoral')
        .select('id')
        .eq('municipio_id', municipioId)
        .eq('numero', numero)
        .maybeSingle();
      if (existente) return existente.id as string;

      const { data, error } = await admin
        .from('zona_eleitoral')
        .insert({ municipio_id: municipioId, numero })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async criarImportacao(input) {
      const { data, error } = await admin
        .from('importacao_tre')
        .insert({
          municipio_id: input.municipioId,
          uf: input.uf,
          ano: input.ano,
          status: 'pendente',
          arquivo_nome: input.arquivoNome,
          arquivo_sha256: input.arquivoSha256,
          arquivo_tamanho_bytes: input.arquivoTamanhoBytes,
          importer_version: input.importerVersion,
          operador: input.operador,
          total_linhas: input.totalLinhas,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async atualizarImportacao(id, patch) {
      const payload: Record<string, unknown> = {};
      if (patch.status) payload.status = patch.status;
      if (patch.totalPublicados !== undefined) payload.total_publicados = patch.totalPublicados;
      if (patch.totalStaging !== undefined) payload.total_staging = patch.totalStaging;
      if (patch.totalErros !== undefined) payload.total_erros = patch.totalErros;
      if (patch.log !== undefined) payload.log = patch.log;
      const { error } = await admin.from('importacao_tre').update(payload).eq('id', id);
      if (error) throw error;
    },

    async inserirLocalVotacao({ importacaoId, zonaId, bairroOficialId, local }) {
      const temGeo = local.latitude !== null && local.longitude !== null;

      const { data, error } = await admin
        .from('local_votacao')
        .insert({
          importacao_id: importacaoId,
          zona_id: zonaId,
          bairro_oficial_id: bairroOficialId,
          bairro_nome_original: local.bairroNomeOriginal,
          num_local: local.numLocal,
          nome: local.nome,
          endereco: local.endereco,
          cep: local.cep,
          geo_status: local.geoStatus,
          tipo: local.tipo,
          situacao: local.situacao,
          qtd_aptos: local.qtdAptos,
          qtd_cancelados: local.qtdCancelados,
          qtd_suspensos: local.qtdSuspensos,
          qtd_vagas_reservadas: local.qtdVagasReservadas,
          qtd_base_historica: local.qtdBaseHistorica,
          telefone: local.telefone,
          elegivel_calor: local.elegivelCalor,
          avisos: local.avisos,
          row_hash: local.rowHash,
          // EWKT — Postgres/PostGIS aceita texto no input da coluna geometry
          ...(temGeo ? { geo: `SRID=4326;POINT(${local.longitude} ${local.latitude})` } : {}),
        })
        .select('id')
        .single();
      if (error) throw error;

      if (local.secoes.length > 0) {
        const { error: erroSecoes } = await admin.from('secao').insert(
          local.secoes.map((s) => ({ local_id: data.id, numero: s.numero, aptos: s.aptos })),
        );
        if (erroSecoes) throw erroSecoes;
      }
    },

    async inserirStaging({ importacaoId, linhaOriginal, rowHash, motivos }) {
      const { error } = await admin.from('local_votacao_staging').insert({
        importacao_id: importacaoId,
        linha_original: linhaOriginal,
        row_hash: rowHash,
        motivos,
      });
      if (error) throw error;
    },
  };
}
