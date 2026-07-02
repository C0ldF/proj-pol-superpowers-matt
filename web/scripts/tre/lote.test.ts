import { describe, it, expect, vi } from 'vitest';
import { publicarLote, despublicarLote, listarLotes, type LoteDeps } from './lote';

function makeDeps(overrides: Partial<LoteDeps> = {}): LoteDeps {
  return {
    buscarLote: vi.fn(async () => ({ status: 'pendente_revisao', municipioId: 2211001, ano: 2026 })),
    atualizarStatus: vi.fn(async () => {}),
    detectarReconciliacao: vi.fn(async () => 0),
    listarLotes: vi.fn(async () => []),
    ...overrides,
  };
}

describe('publicarLote', () => {
  it('publica lote em pendente_revisao e roda detecção de reconciliação', async () => {
    const deps = makeDeps({ detectarReconciliacao: vi.fn(async () => 2) });
    const r = await publicarLote('lote-1', deps);

    expect(r.alertasReconciliacao).toBe(2);
    expect(deps.detectarReconciliacao).toHaveBeenCalledWith('lote-1');
    expect(deps.atualizarStatus).toHaveBeenCalledWith('lote-1', 'publicado', expect.any(String));
  });

  it('lança se o lote não está em pendente_revisao', async () => {
    const deps = makeDeps({
      buscarLote: vi.fn(async () => ({ status: 'publicado', municipioId: 2211001, ano: 2026 })),
    });
    await expect(publicarLote('lote-1', deps)).rejects.toThrow('só pode publicar');
    expect(deps.atualizarStatus).not.toHaveBeenCalled();
  });

  it('lança se o lote não existe', async () => {
    const deps = makeDeps({ buscarLote: vi.fn(async () => null) });
    await expect(publicarLote('inexistente', deps)).rejects.toThrow('lote não encontrado');
  });
});

describe('despublicarLote', () => {
  it('arquiva lote publicado', async () => {
    const deps = makeDeps({
      buscarLote: vi.fn(async () => ({ status: 'publicado', municipioId: 2211001, ano: 2026 })),
    });
    await despublicarLote('lote-1', deps);
    expect(deps.atualizarStatus).toHaveBeenCalledWith('lote-1', 'arquivado');
  });

  it('lança se o lote não está publicado', async () => {
    const deps = makeDeps({
      buscarLote: vi.fn(async () => ({ status: 'pendente_revisao', municipioId: 2211001, ano: 2026 })),
    });
    await expect(despublicarLote('lote-1', deps)).rejects.toThrow('só pode despublicar');
  });
});

describe('listarLotes', () => {
  it('delega para deps.listarLotes', async () => {
    const deps = makeDeps({ listarLotes: vi.fn(async () => [{ id: 'x' } as never]) });
    const r = await listarLotes(deps);
    expect(r).toHaveLength(1);
  });
});
