import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({ auth: { signOut } })),
}));

import { POST } from './route';

describe('POST /api/superadmin/logout', () => {
  it('200 e chama signOut, mesmo sem sessão ativa', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(signOut).toHaveBeenCalled();
  });
});
