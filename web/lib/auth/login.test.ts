import { describe, it, expect, vi } from 'vitest';
import { loginCampanha, type LoginDeps } from './login';

const CAMP = 'aaaaaaaa-0000-0000-0000-000000000001';

function deps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    cpfHmac: () => 'hmac-x',
    resolverEmailPorCpf: vi.fn(async () => 'gestor@a.com'),
    campanhaIdPorSubdominio: vi.fn(async () => CAMP),
    signIn: vi.fn(async () => CAMP),
    signOut: vi.fn(async () => {}),
    registrarEvento: vi.fn(async () => {}),
    ...over,
  };
}

describe('loginCampanha', () => {
  it('loga por CPF válido e audita sucesso', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.registrarEvento).toHaveBeenCalledWith('login.sucesso', CAMP, expect.anything());
  });

  it('loga por e-mail direto (sem resolver CPF)', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.resolverEmailPorCpf).not.toHaveBeenCalled();
  });

  it('rejeita CPF inválido com falha genérica e audita', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '12345678900', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.anything());
  });

  it('rejeita senha errada (signIn null)', async () => {
    const d = deps({ signIn: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 'x', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.anything());
  });

  it('rejeita CPF não encontrado (resolver null) sem chamar signIn', async () => {
    const d = deps({ resolverEmailPorCpf: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it('rejeita e desloga quando o token é de outra campanha', async () => {
    const d = deps({ signIn: vi.fn(async () => 'outra-campanha-id') });
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signOut).toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'subdominio' }));
  });
});
