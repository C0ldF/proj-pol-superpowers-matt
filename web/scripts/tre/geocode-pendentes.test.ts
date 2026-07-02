import { describe, it, expect, vi } from 'vitest';
import { geocodarPendentes, type GeocodePendentesDeps } from './geocode-pendentes';

function mockFetchSequence(respostas: unknown[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = respostas[i++];
    return { ok: true, json: async () => r };
  }) as unknown as typeof fetch;
}

function makeDeps(overrides: Partial<GeocodePendentesDeps> = {}): GeocodePendentesDeps {
  return {
    listarPendentes: vi.fn(async () => [
      { id: 'local-1', endereco: 'RUA A', cep: '64000000', municipioNome: 'TERESINA', uf: 'PI' },
      { id: 'local-2', endereco: 'RUA B', cep: '64000001', municipioNome: 'TERESINA', uf: 'PI' },
    ]),
    marcarSucesso: vi.fn(async () => {}),
    marcarFalha: vi.fn(async () => {}),
    geocode: { fetchImpl: mockFetchSequence([[{ lat: '-5.0', lon: '-42.8' }], []]), userAgent: 'teste' },
    esperarMs: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('geocodarPendentes', () => {
  it('marca sucesso quando geocode encontra e falha quando não encontra', async () => {
    const deps = makeDeps();
    const r = await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);

    expect(r.total).toBe(2);
    expect(r.sucesso).toBe(1);
    expect(r.falha).toBe(1);
    expect(deps.marcarSucesso).toHaveBeenCalledWith('local-1', -5.0, -42.8);
    expect(deps.marcarFalha).toHaveBeenCalledWith('local-2');
  });

  it('espera entre chamadas mas não depois da última', async () => {
    const deps = makeDeps();
    await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);
    expect(deps.esperarMs).toHaveBeenCalledTimes(1);
  });

  it('por padrão não inclui geo_status=falhou anterior', async () => {
    const deps = makeDeps();
    await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);
    expect(deps.listarPendentes).toHaveBeenCalledWith('importacao-1', false);
  });

  it('--retry inclui falhados anteriores', async () => {
    const deps = makeDeps();
    await geocodarPendentes({ importacaoId: 'importacao-1', incluirFalhados: true }, deps);
    expect(deps.listarPendentes).toHaveBeenCalledWith('importacao-1', true);
  });

  it('lista vazia não chama geocode nem espera', async () => {
    const deps = makeDeps({ listarPendentes: vi.fn(async () => []) });
    const r = await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);
    expect(r).toEqual({ total: 0, sucesso: 0, falha: 0 });
    expect(deps.esperarMs).not.toHaveBeenCalled();
  });
});
