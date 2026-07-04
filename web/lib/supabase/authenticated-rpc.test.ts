import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = [{ ok: true }], rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('./ssr', () => ({ ssrClient: vi.fn() }));

import { authenticatedRpc } from './authenticated-rpc';
import { ssrClient } from './ssr';

describe('authenticatedRpc', () => {
  it('retorna 200 com o payload da RPC', async () => {
    const supabase = mockSupabase({ rpcData: [{ a: 1 }] });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await authenticatedRpc('minha_funcao');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ a: 1 }]);
    expect(supabase.rpc).toHaveBeenCalledWith('minha_funcao');
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await authenticatedRpc('minha_funcao');
    expect(res.status).toBe(401);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await authenticatedRpc('minha_funcao');
    expect(res.status).toBe(500);
  });
});
