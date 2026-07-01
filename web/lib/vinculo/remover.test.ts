import { describe, it, expect, vi } from 'vitest';
import { removerVinculo, type RemoverVinculoDeps } from './remover';

const makeDeps = (overrides: Partial<RemoverVinculoDeps> = {}): RemoverVinculoDeps => ({
  subarvoreCount:    vi.fn(async () => 3),
  realocarSubarvore: vi.fn(async () => {}),
  deletarVinculo:    vi.fn(async () => {}),
  ...overrides,
});

describe('removerVinculo', () => {
  it('remove sem realocar quando sem filhos', async () => {
    const deps = makeDeps({ subarvoreCount: vi.fn(async () => 0) });
    await removerVinculo({ vinculo_id: 'v-1', destino_id: null }, deps);
    expect(deps.realocarSubarvore).not.toHaveBeenCalled();
    expect(deps.deletarVinculo).toHaveBeenCalledWith('v-1');
  });

  it('realoca antes de deletar quando há filhos', async () => {
    const deps = makeDeps();
    await removerVinculo({ vinculo_id: 'v-1', destino_id: 'dest-1' }, deps);
    expect(deps.realocarSubarvore).toHaveBeenCalledWith('v-1', 'dest-1');
    expect(deps.deletarVinculo).toHaveBeenCalledWith('v-1');
  });
});
