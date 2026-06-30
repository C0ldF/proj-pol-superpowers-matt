export interface CriarPessoaDeps {
  tituloHmac(titulo: string): string;
  encryptTitulo(titulo: string): Promise<string>;
  cpfHmac(cpf: string): string;
  buscarDuplicada(
    campanha_id: string,
    titulo_hmac: string | null,
    cpf_hmac: string | null,
  ): Promise<{ id: string; public_id: string; nome: string; titulo_hmac: string | null; cpf_hmac: string | null } | null>;
  criarPessoaComVinculo(params: {
    campanha_id: string; nome: string; titulo_hmac: string | null; titulo_enc: string | null;
    cpf_hmac: string | null; telefone?: string; email_contato?: string;
    responsavel_id: string; papel: string; criado_por: string;
    pessoa_id_existente: string | null; ip: string | null; user_agent: string | null;
  }): Promise<{ pessoa_id: string; vinculo_id: string; public_id?: string }>;
}

export interface CriarPessoaInput {
  campanha_id: string;
  nome: string;
  titulo?: string;
  cpf?: string;
  telefone?: string;
  email_contato?: string;
  responsavel_id: string;
  papel: string;
  criado_por: string;
  confirmar_compartilhado: boolean;
  ip?: string;
  user_agent?: string;
}

type CriarPessoaResult =
  | { tipo: 'criado'; pessoa_id: string; vinculo_id: string; public_id?: string }
  | { tipo: 'duplicata'; match_por: 'titulo' | 'cpf'; pessoa_existente: { id: string; public_id: string; nome: string } };

export async function criarPessoa(
  input: CriarPessoaInput,
  deps: CriarPessoaDeps,
): Promise<CriarPessoaResult> {
  const titulo_hmac = input.titulo ? deps.tituloHmac(input.titulo) : null;
  const titulo_enc  = input.titulo ? await deps.encryptTitulo(input.titulo) : null;
  const cpf_hmac    = input.cpf    ? deps.cpfHmac(input.cpf) : null;

  const dup = await deps.buscarDuplicada(input.campanha_id, titulo_hmac, cpf_hmac);

  if (dup && !input.confirmar_compartilhado) {
    const match_por = dup.titulo_hmac === titulo_hmac ? 'titulo' : 'cpf';
    return { tipo: 'duplicata', match_por, pessoa_existente: { id: dup.id, public_id: dup.public_id, nome: dup.nome } };
  }

  const res = await deps.criarPessoaComVinculo({
    campanha_id:          input.campanha_id,
    nome:                 input.nome,
    titulo_hmac,
    titulo_enc,
    cpf_hmac,
    telefone:             input.telefone,
    email_contato:        input.email_contato,
    responsavel_id:       input.responsavel_id,
    papel:                input.papel,
    criado_por:           input.criado_por,
    pessoa_id_existente:  dup?.id ?? null,
    ip:                   input.ip ?? null,
    user_agent:           input.user_agent ?? null,
  });

  return { tipo: 'criado', ...res };
}
