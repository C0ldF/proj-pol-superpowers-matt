import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
  })),
}));

vi.mock('../../../../lib/vinculo/build-remover-deps', () => ({
  buildRemoverDeps: vi.fn(() => ({
    subarvoreCount:    vi.fn(async () => 0),
    realocarSubarvore: vi.fn(async () => {}),
    deletarVinculo:    vi.fn(async () => {}),
  })),
}));

import { DELETE } from './route';

describe('DELETE /api/vinculos/:id', () => {
  it('204 ao deletar vínculo sem filhos', async () => {
    const req = new Request('http://localhost/api/vinculos/v-1', { method: 'DELETE' });
    const res = await DELETE(req as never, { params: Promise.resolve({ id: 'v-1' }) });
    expect(res.status).toBe(204);
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const res = await DELETE(
      new Request('http://localhost/', { method: 'DELETE' }) as never,
      { params: Promise.resolve({ id: 'v-1' }) },
    );
    expect(res.status).toBe(401);
  });
});
