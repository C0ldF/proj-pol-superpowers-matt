import { describe, it, expect, vi } from 'vitest';
import { loginCampanha, identificadorParaChave, type LoginDeps } from './login';

const CAMP = 'aaaaaaaa-0000-0000-0000-000000000001';

function deps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    cpfHmac: (cpf: string) => `hmac-${cpf}`,
    resolverEmailPorCpf: vi.fn(async () => 'gestor@a.com'),
    campanhaIdPorSubdominio: vi.fn(async () => CAMP),
    signIn: vi.fn(async () => CAMP),
    signOut: vi.fn(async () => {}),
    registrarEvento: vi.fn(async () => {}),
    contarFalhasRecentes: vi.fn(async () => 0),
    ...over,
  };
}

describe('identificadorParaChave', () => {
  const hmac = (cpf: string) => `hmac-${cpf}`;

  it('e-mail: normaliza (trim+lowercase), não chama cpfHmac', () => {
    const cpfHmacSpy = vi.fn(hmac);
    const r = identificadorParaChave(' Gestor@A.com ', cpfHmacSpy);
    expect(r).toEqual({ tipo: 'email', chave: 'gestor@a.com' });
    expect(cpfHmacSpy).not.toHaveBeenCalled();
  });

  it('CPF válido: retorna o HMAC do CPF normalizado', () => {
    const r = identificadorParaChave('529.982.247-25', hmac);
    expect(r).toEqual({ tipo: 'cpf', chave: 'hmac-52998224725' });
  });

  it('CPF inválido (checksum errado): cpf_invalido, sem chamar cpfHmac', () => {
    const cpfHmacSpy = vi.fn(hmac);
    const r = identificadorParaChave('12345678900', cpfHmacSpy);
    expect(r).toEqual({ tipo: 'cpf_invalido' });
    expect(cpfHmacSpy).not.toHaveBeenCalled();
  });

  it('mesmo CPF válido produz sempre a mesma chave, com ou sem pontuação', () => {
    const r1 = identificadorParaChave('529.982.247-25', hmac);
    const r2 = identificadorParaChave('52998224725', hmac);
    expect(r1).toEqual(r2);
  });
});

describe('loginCampanha', () => {
  it('loga por CPF válido e audita sucesso com identificador_chave', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.registrarEvento).toHaveBeenCalledWith(
      'login.sucesso', CAMP, expect.objectContaining({ identificador_chave: 'hmac-52998224725' }),
    );
  });

  it('loga por e-mail direto (sem resolver CPF)', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.resolverEmailPorCpf).not.toHaveBeenCalled();
  });

  it('rejeita CPF inválido com falha genérica, sem checar throttle nem gravar identificador_chave', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '12345678900', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.contarFalhasRecentes).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, { ip: undefined, motivo: 'cpf_invalido' });
  });

  it('rejeita senha errada (signIn null)', async () => {
    const d = deps({ signIn: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 'x', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'credenciais' }));
  });

  it('rejeita CPF não encontrado (resolver null) sem chamar signIn', async () => {
    const d = deps({ resolverEmailPorCpf: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'cpf_nao_encontrado' }));
  });

  it('rejeita e desloga quando o token é de outra campanha', async () => {
    const d = deps({ signIn: vi.fn(async () => 'outra-campanha-id') });
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signOut).toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'subdominio' }));
  });

  it('bloqueia sem chamar resolverEmailPorCpf/signIn quando falhasRecentes >= LIMITE_FALHAS, audita login.bloqueado', async () => {
    const d = deps({ contarFalhasRecentes: vi.fn(async () => 5) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.resolverEmailPorCpf).not.toHaveBeenCalled();
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith(
      'login.bloqueado', CAMP, expect.objectContaining({ identificador_chave: 'hmac-52998224725' }),
    );
    expect(d.registrarEvento).not.toHaveBeenCalledWith('login.falha', expect.anything(), expect.anything());
  });

  it('não bloqueia quando falhasRecentes < LIMITE_FALHAS (fluxo segue normal)', async () => {
    const d = deps({ contarFalhasRecentes: vi.fn(async () => 4) });
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
  });

  it('inclui identificador_chave (e-mail normalizado) no meta de uma falha existente', async () => {
    const d = deps({ signIn: vi.fn(async () => null) });
    await loginCampanha({ identificador: ' Gestor@A.com ', senha: 'x', subdominio: 'campanha-a' }, d);
    expect(d.registrarEvento).toHaveBeenCalledWith(
      'login.falha', CAMP,
      expect.objectContaining({ motivo: 'credenciais', identificador_chave: 'gestor@a.com' }),
    );
  });

  it('a identificador_chave é a mesma pro mesmo CPF, mesmo com motivos de falha diferentes (prova também o caminho HMAC)', async () => {
    const cpfNaoEncontrado = deps({ resolverEmailPorCpf: vi.fn(async () => null) });
    await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, cpfNaoEncontrado);
    const metaCpfNaoEncontrado = vi.mocked(cpfNaoEncontrado.registrarEvento).mock.calls[0][2];

    const credenciaisErradas = deps({ signIn: vi.fn(async () => null) });
    await loginCampanha({ identificador: '529.982.247-25', senha: 'x', subdominio: 'campanha-a' }, credenciaisErradas);
    const metaCredenciais = vi.mocked(credenciaisErradas.registrarEvento).mock.calls[0][2];

    expect(metaCpfNaoEncontrado.identificador_chave).toBe(metaCredenciais.identificador_chave);
    expect(metaCpfNaoEncontrado.identificador_chave).toBe('hmac-52998224725');
  });
});
