import { adminClient } from '../../lib/supabase/server';
import { esperar } from './geocode';
import type { GeocodePendentesDeps } from './geocode-pendentes';

export function buildGeocodePendentesDeps(): GeocodePendentesDeps {
  const admin = adminClient();

  return {
    async listarPendentes(importacaoId, incluirFalhados) {
      const statusAlvo = incluirFalhados ? ['pendente', 'falhou'] : ['pendente'];
      const { data, error } = await admin
        .from('local_votacao')
        .select('id, endereco, cep, importacao_tre:importacao_id(municipio:municipio_id(nome, uf))')
        .eq('importacao_id', importacaoId)
        .in('geo_status', statusAlvo);
      if (error) throw error;

      return (data ?? []).map((r) => {
        const municipio = (r.importacao_tre as unknown as { municipio: { nome: string; uf: string } }).municipio;
        return { id: r.id, endereco: r.endereco, cep: r.cep, municipioNome: municipio.nome, uf: municipio.uf };
      });
    },

    async marcarSucesso(id, lat, lng) {
      const { error } = await admin
        .from('local_votacao')
        .update({ geo: `SRID=4326;POINT(${lng} ${lat})`, geo_status: 'sucesso' })
        .eq('id', id);
      if (error) throw error;
    },

    async marcarFalha(id) {
      const { error } = await admin.from('local_votacao').update({ geo_status: 'falhou' }).eq('id', id);
      if (error) throw error;
    },

    geocode: { fetchImpl: fetch, userAgent: 'campanha-app-tre-ingest/1.0' },
    esperarMs: esperar,
  };
}
