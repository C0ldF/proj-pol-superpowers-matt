import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/auth/build-login-superadmin-deps', () => ({
  buildLoginSuperadminDeps: vi.fn(async () => ({
    signIn: async () => true,
    signOut: async () => {},
  })),
}));

import { POST } from './route';
import { buildLoginSuperadminDeps } from '../../../../lib/auth/build-login-superadmin-deps';

function req(body: unknown) {
  return new Request('http://localhost/api/superadmin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ERRO_GENERICO = { erro: 'e-mail ou senha inválidos' };

describe('POST /api/superadmin/login', () => {
  it('200 ok em login válido', async () => {
    const res = await POST(req({ email: 'admin@x.com', senha: 's' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('401 com corpo genérico quando email ou senha ausentes', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });

  it('401 com corpo genérico em JSON inválido', async () => {
    const badReq = new Request('http://localhost/api/superadmin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(badReq);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });

  it('401 com corpo genérico quando loginSuperadmin retorna ok:false', async () => {
    vi.mocked(buildLoginSuperadminDeps).mockResolvedValueOnce({
      signIn: async () => false,
      signOut: async () => {},
    });
    const res = await POST(req({ email: 'admin@x.com', senha: 'errada' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });
});
