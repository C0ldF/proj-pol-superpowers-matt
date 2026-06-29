import { normalizarCpf, cpfValido } from '../cpf';

export interface RecuperacaoDeps {
  cpfHmac(cpf: string): string;
  resolverEmailPorCpf(subdominio: string, hmac: string): Promise<string | null>;
}

export async function resolverEmailParaRecuperacao(
  input: { identificador: string; subdominio: string },
  deps: RecuperacaoDeps,
): Promise<string | null> {
  const { identificador, subdominio } = input;
  if (identificador.includes('@')) return identificador.trim().toLowerCase();
  const cpf = normalizarCpf(identificador);
  if (!cpfValido(cpf)) return null;
  return deps.resolverEmailPorCpf(subdominio, deps.cpfHmac(cpf));
}
