import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/auth/build-login-deps', () => ({
  buildLoginDeps: vi.fn(async () => ({
    cpfHmac: () => 'h',
    resolverEmailPorCpf: async () => 'gestor@a.com',
    campanhaIdPorSubdominio: async () => 'camp-1',
    signIn: async () => 'camp-1',
    signOut: async () => {},
    registrarEvento: async () => {},
    contarFalhasRecentes: async () => 0,
  })),
}));

import { POST } from './route';
import { buildLoginDeps } from '../../../../lib/auth/build-login-deps';

function req(body: unknown, sub = 'campanha-a') {
  return new Request('http://campanha-a.localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-campanha-subdominio': sub },
    body: JSON.stringify(body),
  });
}

const ERRO_GENERICO = { erro: 'CPF/e-mail ou senha inválidos' };

describe('POST /api/auth/login', () => {
  it('200 ok em login válido', async () => {
    const res = await POST(req({ identificador: 'gestor@a.com', senha: 's' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('400 quando falta o header de subdomínio', async () => {
    const res = await POST(req({ identificador: 'x', senha: 's' }, ''));
    expect(res.status).toBe(400);
  });
  it('401 com corpo genérico em JSON inválido', async () => {
    const badReq = new Request('http://campanha-a.localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-campanha-subdominio': 'campanha-a' },
      body: 'not-json',
    });
    const res = await POST(badReq);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });
  it('401 com corpo genérico quando identificador ou senha ausentes', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });
  it('401 com corpo genérico quando loginCampanha retorna ok:false', async () => {
    vi.mocked(buildLoginDeps).mockResolvedValueOnce({
      cpfHmac: () => 'h',
      resolverEmailPorCpf: async () => 'gestor@a.com',
      campanhaIdPorSubdominio: async () => 'camp-1',
      signIn: async () => null,
      signOut: async () => {},
      registrarEvento: async () => {},
      contarFalhasRecentes: async () => 0,
    });
    const res = await POST(req({ identificador: 'gestor@a.com', senha: 'errada' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });
});
