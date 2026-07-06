import { describe, it, expect, vi } from 'vitest';
import { criarSuperadmin, type CriarSuperadminDeps } from './criar-superadmin';

function makeDeps(overrides: Partial<CriarSuperadminDeps> = {}): CriarSuperadminDeps {
  return {
    criarAuthUser: vi.fn(async () => 'user-1'),
    inserirSuperadmin: vi.fn(async () => {}),
    removerAuthUser: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('criarSuperadmin', () => {
  it('cria o auth user e insere em superadmin, nessa ordem', async () => {
    const deps = makeDeps();
    await criarSuperadmin('a@a.com', 'senha123', deps);
    expect(deps.criarAuthUser).toHaveBeenCalledWith('a@a.com', 'senha123');
    expect(deps.inserirSuperadmin).toHaveBeenCalledWith('user-1');
    expect(deps.removerAuthUser).not.toHaveBeenCalled();
  });

  it('reverte o auth user se a inserção em superadmin falhar', async () => {
    const deps = makeDeps({
      inserirSuperadmin: vi.fn(async () => {
        throw new Error('user_id duplicado');
      }),
    });
    await expect(criarSuperadmin('a@a.com', 'senha123', deps)).rejects.toThrow('user_id duplicado');
    expect(deps.removerAuthUser).toHaveBeenCalledWith('user-1');
  });
});
