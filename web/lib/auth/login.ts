import { normalizarCpf, cpfValido } from '../cpf';

export interface LoginDeps {
  cpfHmac(cpf: string): string;
  resolverEmailPorCpf(subdominio: string, hmac: string): Promise<string | null>;
  campanhaIdPorSubdominio(subdominio: string): Promise<string | null>;
  signIn(email: string, senha: string): Promise<string | null>; // -> app_metadata.campanha_id ou null
  signOut(): Promise<void>;
  registrarEvento(acao: string, campanhaId: string | null, meta: Record<string, unknown>): Promise<void>;
}

export interface LoginInput {
  identificador: string;
  senha: string;
  subdominio: string;
  ip?: string;
}

const ehEmail = (s: string) => s.includes('@');

export async function loginCampanha(input: LoginInput, deps: LoginDeps): Promise<{ ok: boolean }> {
  const { identificador, senha, subdominio, ip } = input;
  const campanhaId = await deps.campanhaIdPorSubdominio(subdominio);
  if (!campanhaId) return { ok: false }; // middleware já deveria ter barrado

  const falha = async (motivo: string) => {
    await deps.registrarEvento('login.falha', campanhaId, { ip, motivo });
    return { ok: false as const };
  };

  // Resolve o e-mail (caminho CPF vs e-mail direto).
  let email: string | null;
  if (ehEmail(identificador)) {
    email = identificador.trim().toLowerCase();
  } else {
    const cpf = normalizarCpf(identificador);
    if (!cpfValido(cpf)) return falha('cpf_invalido');
    email = await deps.resolverEmailPorCpf(subdominio, deps.cpfHmac(cpf));
    if (!email) return falha('cpf_nao_encontrado');
  }

  const tokenCampanhaId = await deps.signIn(email, senha);
  if (!tokenCampanhaId) return falha('credenciais');

  if (tokenCampanhaId !== campanhaId) {
    await deps.signOut();
    return falha('subdominio');
  }

  await deps.registrarEvento('login.sucesso', campanhaId, { ip });
  return { ok: true };
}
