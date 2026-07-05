import { describe, it, expect, vi } from 'vitest';
import { toggleModulo, type ToggleModuloDeps } from './toggle-modulo';

function makeDeps(overrides: Partial<ToggleModuloDeps> = {}): ToggleModuloDeps {
  return {
    chamarRpc: vi.fn(async () => ({ data: true, error: null })),
    ...overrides,
  };
}

describe('toggleModulo', () => {
  it('chama habilitar_modulo quando acao="habilitar"', async () => {
    const deps = makeDeps();
    await toggleModulo('habilitar', 'campanha-1', 'comunicacao', deps);
    expect(deps.chamarRpc).toHaveBeenCalledWith('habilitar_modulo', {
      p_campanha_id: 'campanha-1',
      p_modulo: 'comunicacao',
    });
  });

  it('chama desabilitar_modulo quando acao="desabilitar"', async () => {
    const deps = makeDeps();
    await toggleModulo('desabilitar', 'campanha-1', 'ia', deps);
    expect(deps.chamarRpc).toHaveBeenCalledWith('desabilitar_modulo', {
      p_campanha_id: 'campanha-1',
      p_modulo: 'ia',
    });
  });

  it('lança erro quando a RPC retorna erro', async () => {
    const deps = makeDeps({ chamarRpc: vi.fn(async () => ({ data: null, error: { message: 'falha no banco' } })) });
    await expect(toggleModulo('habilitar', 'campanha-1', 'comunicacao', deps)).rejects.toThrow('falha no banco');
  });

  it('lança erro quando a RPC retorna data=false (campanha inexistente)', async () => {
    const deps = makeDeps({ chamarRpc: vi.fn(async () => ({ data: false, error: null })) });
    await expect(toggleModulo('habilitar', 'campanha-inexistente', 'comunicacao', deps))
      .rejects.toThrow('campanha-inexistente não encontrada');
  });
});
