import { describe, it, expect, vi } from 'vitest';
import { resolverEmailParaRecuperacao, type RecuperacaoDeps } from './recuperacao';

function deps(over: Partial<RecuperacaoDeps> = {}): RecuperacaoDeps {
  return {
    cpfHmac: () => 'h',
    resolverEmailPorCpf: vi.fn(async () => 'gestor@a.com'),
    ...over,
  };
}

describe('resolverEmailParaRecuperacao', () => {
  it('resolve por e-mail direto', async () => {
    const e = await resolverEmailParaRecuperacao({ identificador: 'gestor@a.com', subdominio: 'campanha-a' }, deps());
    expect(e).toBe('gestor@a.com');
  });
  it('resolve por CPF válido', async () => {
    const e = await resolverEmailParaRecuperacao({ identificador: '529.982.247-25', subdominio: 'campanha-a' }, deps());
    expect(e).toBe('gestor@a.com');
  });
  it('devolve null para CPF inválido (sem vazar)', async () => {
    const e = await resolverEmailParaRecuperacao({ identificador: '11111111111', subdominio: 'campanha-a' }, deps());
    expect(e).toBeNull();
  });
});
