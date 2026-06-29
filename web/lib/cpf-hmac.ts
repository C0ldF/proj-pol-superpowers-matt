import { createHmac } from 'node:crypto';
import { normalizarCpf } from './cpf';

// Índice cego do CPF (ADR 0010). A chave vive em env do server, fora do banco.
export function cpfHmac(cpfNormalizado: string, key?: string): string {
  const chave = key ?? process.env.CPF_HMAC_KEY;
  if (!chave) throw new Error('CPF_HMAC_KEY ausente no ambiente do servidor');
  return createHmac('sha256', chave).update(normalizarCpf(cpfNormalizado)).digest('hex');
}
