import { describe, it, expect, vi } from 'vitest';
import { loginSuperadmin, type LoginSuperadminDeps } from './login-superadmin';

function deps(over: Partial<LoginSuperadminDeps> = {}): LoginSuperadminDeps {
  return {
    signIn: vi.fn(async () => true),
    signOut: vi.fn(async () => {}),
    ...over,
  };
}

describe('loginSuperadmin', () => {
  it('sucesso quando signIn confirma superadmin', async () => {
    const d = deps();
    const r = await loginSuperadmin({ email: 'a@a.com', senha: 's' }, d);
    expect(r.ok).toBe(true);
    expect(d.signOut).not.toHaveBeenCalled();
  });

  it('falha e desloga quando signIn retorna false (credenciais erradas OU não-superadmin)', async () => {
    const d = deps({ signIn: vi.fn(async () => false) });
    const r = await loginSuperadmin({ email: 'a@a.com', senha: 'errada' }, d);
    expect(r.ok).toBe(false);
    expect(d.signOut).toHaveBeenCalled();
  });
});
