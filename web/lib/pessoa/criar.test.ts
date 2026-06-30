import { describe, it, expect, vi } from 'vitest';
import { criarPessoa, type CriarPessoaDeps, type CriarPessoaInput } from './criar';

const makeDeps = (overrides: Partial<CriarPessoaDeps> = {}): CriarPessoaDeps => ({
  tituloHmac:    (t) => 'hmac-' + t,
  encryptTitulo: async (t) => 'enc-' + t,
  cpfHmac:       (c) => 'hmac-' + c,
  buscarDuplicada: vi.fn(async () => null),
  criarPessoaComVinculo: vi.fn(async () => ({ pessoa_id: 'pid-1', vinculo_id: 'vid-1' })),
  ...overrides,
});

const input: CriarPessoaInput = {
  campanha_id: 'camp-1',
  nome: 'João Silva',
  titulo: '01234567890',
  cpf: '12345678909',
  responsavel_id: 'resp-1',
  papel: 'apoiador',
  criado_por: 'user-1',
  confirmar_compartilhado: false,
  ip: '1.2.3.4',
  user_agent: 'test',
};

describe('criarPessoa', () => {
  it('retorna pessoa_id ao criar nova pessoa sem duplicata', async () => {
    const deps = makeDeps();
    const res = await criarPessoa(input, deps);
    expect(res.tipo).toBe('criado');
    if (res.tipo === 'criado') expect(res.pessoa_id).toBe('pid-1');
    expect(deps.criarPessoaComVinculo).toHaveBeenCalledOnce();
  });

  it('retorna duplicata_titulo quando título já existe', async () => {
    const deps = makeDeps({
      buscarDuplicada: vi.fn(async () => ({
        id: 'dup-id', public_id: 'pes_abc', nome: 'João',
        titulo_hmac: 'hmac-01234567890', cpf_hmac: null,
      })),
    });
    const res = await criarPessoa(input, deps);
    expect(res.tipo).toBe('duplicata');
    if (res.tipo === 'duplicata') {
      expect(res.match_por).toBe('titulo');
      expect(res.pessoa_existente.public_id).toBe('pes_abc');
    }
    expect(deps.criarPessoaComVinculo).not.toHaveBeenCalled();
  });

  it('cria vínculo compartilhado quando confirmar_compartilhado=true', async () => {
    const existente = { id: 'dup-id', public_id: 'pes_abc', nome: 'João',
                        titulo_hmac: 'hmac-01234567890', cpf_hmac: null };
    const deps = makeDeps({
      buscarDuplicada: vi.fn(async () => existente),
    });
    const res = await criarPessoa({ ...input, confirmar_compartilhado: true }, deps);
    expect(res.tipo).toBe('criado');
    expect(deps.criarPessoaComVinculo).toHaveBeenCalledWith(
      expect.objectContaining({ pessoa_id_existente: 'dup-id' })
    );
  });
});
