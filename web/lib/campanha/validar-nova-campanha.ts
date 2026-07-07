import { isCargo, isAbrangencia, type Cargo, type Abrangencia } from './constantes';
import { subdominioValido, ufValida, dataEleicaoValida } from './validacao';

export type NovaCampanhaInput = {
  subdominio?: string;
  nome?: string;
  cargo?: string;
  abrangencia?: string;
  municipioId?: number;
  uf?: string;
  dataEleicao?: string;
};

export type NovaCampanhaValidada = {
  subdominio: string;
  nome: string;
  cargo: Cargo;
  abrangencia: Abrangencia;
  municipio_id: number | null;
  uf: string | null;
  data_eleicao: string;
};

export type ResultadoValidacaoCampanha =
  | { ok: true; campanha: NovaCampanhaValidada }
  | { ok: false; erro: string };

export function validarNovaCampanha(input: NovaCampanhaInput): ResultadoValidacaoCampanha {
  const { nome, cargo, abrangencia, municipioId, dataEleicao } = input;
  const subdominio = input.subdominio?.trim().toLowerCase();

  if (!subdominio || !nome || !cargo || !abrangencia || !dataEleicao) {
    return { ok: false, erro: 'campos obrigatórios ausentes' };
  }
  if (!subdominioValido(subdominio)) {
    return {
      ok: false,
      erro: 'subdomínio inválido (use apenas letras minúsculas, números e hífen, 3-63 caracteres)',
    };
  }
  if (!isCargo(cargo)) {
    return { ok: false, erro: `cargo inválido: "${cargo}"` };
  }
  if (!isAbrangencia(abrangencia)) {
    return { ok: false, erro: `abrangência inválida: "${abrangencia}"` };
  }

  let uf: string | null = null;
  if (abrangencia === 'municipal') {
    if (municipioId == null || input.uf) {
      return { ok: false, erro: 'abrangência municipal exige municipioId e não aceita uf' };
    }
  } else {
    if (!input.uf || municipioId != null) {
      return { ok: false, erro: 'abrangência estadual exige uf e não aceita municipioId' };
    }
    uf = input.uf.trim().toUpperCase();
    if (!ufValida(uf)) {
      return { ok: false, erro: 'uf inválida (use exatamente 2 letras)' };
    }
  }

  if (!dataEleicaoValida(dataEleicao)) {
    return { ok: false, erro: 'dataEleicao inválida (use o formato YYYY-MM-DD e uma data real)' };
  }

  return {
    ok: true,
    campanha: {
      subdominio,
      nome,
      cargo,
      abrangencia,
      municipio_id: abrangencia === 'municipal' ? municipioId! : null,
      uf,
      data_eleicao: dataEleicao,
    },
  };
}
