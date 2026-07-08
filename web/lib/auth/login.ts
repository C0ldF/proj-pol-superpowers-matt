import { normalizarCpf, cpfValido } from '../cpf';

export const LIMITE_FALHAS = 5;
export const JANELA_MINUTOS = 15;

export interface LoginDeps {
  cpfHmac(cpf: string): string;
  resolverEmailPorCpf(subdominio: string, hmac: string): Promise<string | null>;
  campanhaIdPorSubdominio(subdominio: string): Promise<string | null>;
  signIn(email: string, senha: string): Promise<string | null>; // -> app_metadata.campanha_id ou null
  signOut(): Promise<void>;
  registrarEvento(acao: string, campanhaId: string | null, meta: Record<string, unknown>): Promise<void>;
  contarFalhasRecentes(campanhaId: string, identificadorChave: string): Promise<number>;
}

export interface LoginInput {
  identificador: string;
  senha: string;
  subdominio: string;
  ip?: string;
}

const ehEmail = (s: string) => s.includes('@');

export type IdentificadorResolvido =
  | { tipo: 'email'; chave: string }
  | { tipo: 'cpf'; chave: string }
  | { tipo: 'cpf_invalido' };

export function identificadorParaChave(
  identificador: string,
  cpfHmac: (cpf: string) => string,
): IdentificadorResolvido {
  if (ehEmail(identificador)) {
    return { tipo: 'email', chave: identificador.trim().toLowerCase() };
  }
  const cpf = normalizarCpf(identificador);
  if (!cpfValido(cpf)) {
    return { tipo: 'cpf_invalido' };
  }
  return { tipo: 'cpf', chave: cpfHmac(cpf) };
}

export async function loginCampanha(input: LoginInput, deps: LoginDeps): Promise<{ ok: boolean }> {
  const { identificador, senha, subdominio, ip } = input;
  const campanhaId = await deps.campanhaIdPorSubdominio(subdominio);
  if (!campanhaId) return { ok: false }; // proxy já deveria ter barrado

  const resolvido = identificadorParaChave(identificador, deps.cpfHmac);
  if (resolvido.tipo === 'cpf_invalido') {
    await deps.registrarEvento('login.falha', campanhaId, { ip, motivo: 'cpf_invalido' });
    return { ok: false };
  }

  const falhasRecentes = await deps.contarFalhasRecentes(campanhaId, resolvido.chave);
  if (falhasRecentes >= LIMITE_FALHAS) {
    await deps.registrarEvento('login.bloqueado', campanhaId, { ip, identificador_chave: resolvido.chave });
    return { ok: false };
  }

  const falha = async (motivo: string) => {
    await deps.registrarEvento('login.falha', campanhaId, { ip, motivo, identificador_chave: resolvido.chave });
    return { ok: false as const };
  };

  let email: string | null;
  if (resolvido.tipo === 'email') {
    email = resolvido.chave;
  } else {
    email = await deps.resolverEmailPorCpf(subdominio, resolvido.chave);
    if (!email) return falha('cpf_nao_encontrado');
  }

  const tokenCampanhaId = await deps.signIn(email, senha);
  if (!tokenCampanhaId) return falha('credenciais');

  if (tokenCampanhaId !== campanhaId) {
    await deps.signOut();
    return falha('subdominio');
  }

  await deps.registrarEvento('login.sucesso', campanhaId, { ip, identificador_chave: resolvido.chave });
  return { ok: true };
}
