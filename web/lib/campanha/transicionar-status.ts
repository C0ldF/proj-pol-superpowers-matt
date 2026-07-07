import { type StatusCampanha } from './constantes';

export type ResultadoTransicao =
  | { valida: true; update: { status: StatusCampanha; suspensa_em?: string | null } }
  | { valida: false; erro: string };

export function transicionarStatus(
  atual: StatusCampanha,
  novo: StatusCampanha,
  agora: string = new Date().toISOString(),
): ResultadoTransicao {
  if (atual === novo) {
    return { valida: false, erro: 'já está nesse status' };
  }
  if (atual === 'encerrada') {
    return { valida: false, erro: 'campanha encerrada não pode mudar de status' };
  }
  if (novo === 'suspensa') {
    return { valida: true, update: { status: 'suspensa', suspensa_em: agora } };
  }
  if (novo === 'ativa') {
    return { valida: true, update: { status: 'ativa', suspensa_em: null } };
  }
  return { valida: true, update: { status: 'encerrada' } };
}
