import { describe, it, expect, vi } from 'vitest';
import { resolverEmailParaRecuperacao, type RecuperacaoDeps } from './recuperacao';

function deps(over: Partial<RecuperacaoDeps> = {}): RecuperacaoDeps {
  return {
    cpfHmac: () => 'h',
    resolverEmailPorCpf: vi.fn(async () => 'gestor@a.com'),
    resolverEmailNaCampanha: vi.fn(async () => 'gestor@a.com'),
    ...over,
  };
}

describe('resolverEmailParaRecuperacao', () => {
  it('resolve por e-mail membro da campanha (chama resolverEmailNaCampanha c/ lowercase)', async () => {
    const d = deps();
    const e = await resolverEmailParaRecuperacao({ identificador: 'Gestor@A.com', subdominio: 'campanha-a' }, d);
    expect(e).toBe('gestor@a.com');
    expect(d.resolverEmailNaCampanha).toHaveBeenCalledWith('campanha-a', 'gestor@a.com');
  });
  it('retorna null para e-mail que não é membro da campanha', async () => {
    const d = deps({ resolverEmailNaCampanha: vi.fn(async () => null) });
    const e = await resolverEmailParaRecuperacao({ identificador: 'forasteiro@b.com', subdominio: 'campanha-a' }, d);
    expect(e).toBeNull();
    expect(d.resolverEmailNaCampanha).toHaveBeenCalledWith('campanha-a', 'forasteiro@b.com');
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
