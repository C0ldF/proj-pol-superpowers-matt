import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = true, rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('./ssr', () => ({ ssrClient: vi.fn() }));

import { hasModulo, requireModulo } from './require-modulo';
import { ssrClient } from './ssr';

describe('hasModulo', () => {
  it('retorna true quando o módulo está habilitado', async () => {
    const supabase = mockSupabase({ rpcData: true });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    expect(await hasModulo('comunicacao')).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('actor_tem_modulo', { p_modulo: 'comunicacao' });
  });

  it('retorna false sem sessão (sem lançar erro)', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    expect(await hasModulo('comunicacao')).toBe(false);
  });

  it('retorna false quando o módulo não está habilitado', async () => {
    const supabase = mockSupabase({ rpcData: false });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    expect(await hasModulo('comunicacao')).toBe(false);
  });

  it('retorna false quando a RPC retorna erro (sem lançar erro)', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    expect(await hasModulo('comunicacao')).toBe(false);
  });
});

describe('requireModulo', () => {
  it('retorna null quando o módulo está habilitado', async () => {
    const supabase = mockSupabase({ rpcData: true });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('actor_tem_modulo', { p_modulo: 'comunicacao' });
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('403 quando o módulo não está habilitado', async () => {
    const supabase = mockSupabase({ rpcData: false });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);
  });
});
