import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
  })),
}));

vi.mock('../../../../../lib/supabase/server', () => ({
  adminClient: vi.fn(() => ({
    rpc: vi.fn(async () => ({ data: 3, error: null })),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { responsavel_id: 'r-1', pessoa: { public_id: 'pes_r1', nome: 'Resp' } },
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

import { GET } from './route';

describe('GET /api/vinculos/:id/impacto', () => {
  it('retorna count e responsavel_acima', async () => {
    const req = new Request('http://localhost/api/vinculos/v-1/impacto');
    const res = await GET(req as never, { params: Promise.resolve({ id: 'v-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.responsavel_acima).toMatchObject({ nome: 'Resp' });
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const res = await GET(new Request('http://localhost/') as never, { params: Promise.resolve({ id: 'v-1' }) });
    expect(res.status).toBe(401);
  });
});
