import { createHmac } from 'node:crypto';

export function normalizarTitulo(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

export function tituloHmac(titulo: string, key?: string): string {
  const chave = key ?? process.env.TITULO_HMAC_KEY;
  if (!chave) throw new Error('TITULO_HMAC_KEY ausente no ambiente do servidor');
  return createHmac('sha256', chave).update(normalizarTitulo(titulo)).digest('hex');
}
