import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/auth/build-login-deps', () => ({
  buildLoginDeps: async () => ({
    cpfHmac: () => 'h',
    resolverEmailPorCpf: async () => 'gestor@a.com',
    campanhaIdPorSubdominio: async () => 'camp-1',
    signIn: async () => 'camp-1',
    signOut: async () => {},
    registrarEvento: async () => {},
  }),
}));

import { POST } from './route';

function req(body: unknown, sub = 'campanha-a') {
  return new Request('http://campanha-a.localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-campanha-subdominio': sub },
    body: JSON.stringify(body),
  });
}

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
});
