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

import { requireSuperadmin } from './require-superadmin';
import { ssrClient } from './ssr';

describe('requireSuperadmin', () => {
  it('retorna null quando é superadmin', async () => {
    const supabase = mockSupabase({ rpcData: true });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('actor_e_superadmin');
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('403 quando não é superadmin', async () => {
    const supabase = mockSupabase({ rpcData: false });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);
  });
});
