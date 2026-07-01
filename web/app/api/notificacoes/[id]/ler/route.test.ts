import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

vi.mock('../../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
    },
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  })),
}));

import { PATCH } from './route';

describe('PATCH /api/notificacoes/:id/ler', () => {
  it('200 ao marcar notificação como lida', async () => {
    const req = new Request('http://localhost/api/notificacoes/n-1/ler', { method: 'PATCH' });
    const res = await PATCH(req as never, { params: Promise.resolve({ id: 'n-1' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    } as never);
    const res = await PATCH(
      new Request('http://localhost/', { method: 'PATCH' }) as never,
      { params: Promise.resolve({ id: 'n-1' }) },
    );
    expect(res.status).toBe(401);
  });
});
