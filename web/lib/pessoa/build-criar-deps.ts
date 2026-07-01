import { tituloHmac } from '../titulo-hmac';
import { encryptTitulo } from '../titulo-enc';
import { cpfHmac } from '../cpf-hmac';
import { adminClient } from '../supabase/server';
import type { CriarPessoaDeps } from './criar';

export async function buildCriarDeps(): Promise<CriarPessoaDeps> {
  return {
    tituloHmac: (t) => tituloHmac(t),
    encryptTitulo: (t) => encryptTitulo(t),
    cpfHmac: (c) => cpfHmac(c),

    async buscarDuplicada(campanha_id, titulo_hmac, cpf_hmac) {
      const admin = adminClient();
      const { data } = await admin.rpc('buscar_pessoa_duplicada', {
        p_campanha_id: campanha_id,
        p_titulo_hmac: titulo_hmac,
        p_cpf_hmac:    cpf_hmac,
      });
      return data?.[0] ?? null;
    },

    async criarPessoaComVinculo(params) {
      const admin = adminClient();
      const { data, error } = await admin.rpc('criar_pessoa_com_vinculo', {
        p_campanha_id:          params.campanha_id,
        p_nome:                 params.nome,
        p_titulo_hmac:          params.titulo_hmac,
        p_titulo_enc:           params.titulo_enc,
        p_cpf_hmac:             params.cpf_hmac,
        p_telefone:             params.telefone ?? null,
        p_email_contato:        params.email_contato ?? null,
        p_base_legal:           'legitimointeresse',
        p_origem_coleta:        'manual',
        p_responsavel_id:       params.responsavel_id,
        p_papel:                params.papel,
        p_criado_por:           params.criado_por,
        p_pessoa_id_existente:  params.pessoa_id_existente,
        p_actor_ip:             params.ip,
        p_actor_ua:             params.user_agent,
      });
      if (error) throw error;
      return data as { pessoa_id: string; vinculo_id: string; public_id: string };
    },
  };
}
