import { describe, it, expect, vi } from 'vitest';
import { geocodeEndereco } from './geocode';

function mockFetch(resposta: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => resposta })) as unknown as typeof fetch;
}

describe('geocodeEndereco', () => {
  it('retorna lat/lng quando a API encontra resultado', async () => {
    const fetchImpl = mockFetch([{ lat: '-5.067541', lon: '-42.8138009' }]);
    const r = await geocodeEndereco(
      { endereco: 'RUA UM, 100', cep: '64000000', municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toEqual({ lat: -5.067541, lng: -42.8138009 });
  });

  it('retorna null quando a API não encontra nada', async () => {
    const fetchImpl = mockFetch([]);
    const r = await geocodeEndereco(
      { endereco: 'ENDERECO INEXISTENTE', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toBeNull();
  });

  it('retorna null quando a resposta HTTP não é ok', async () => {
    const fetchImpl = mockFetch([], false);
    const r = await geocodeEndereco(
      { endereco: 'X', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toBeNull();
  });

  it('retorna null quando o fetch lança exceção (rede fora do ar) — não propaga erro', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = await geocodeEndereco(
      { endereco: 'X', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toBeNull();
  });

  it('envia User-Agent próprio no header', async () => {
    const fetchImpl = mockFetch([{ lat: '1', lon: '2' }]);
    await geocodeEndereco(
      { endereco: 'X', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'campanha-app/1.0' },
    );
    const chamada = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((chamada[1].headers as Record<string, string>)['User-Agent']).toBe('campanha-app/1.0');
  });
});
