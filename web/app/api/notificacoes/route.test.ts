import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const mockNotificacoes = [
  { id: 'n-1', tipo: 'vinculo_compartilhado', payload: {}, criado_em: '2026-06-29T10:00:00Z' },
];

vi.mock('../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(async () => ({ data: mockNotificacoes, error: null })),
        })),
      })),
    })),
  })),
}));

import { GET } from './route';

describe('GET /api/notificacoes', () => {
  it('retorna lista de notificações não lidas', async () => {
    const res = await GET(new Request('http://localhost/api/notificacoes') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notificacoes).toHaveLength(1);
    expect(body.notificacoes[0].tipo).toBe('vinculo_compartilhado');
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    } as never);
    const res = await GET(new Request('http://localhost/') as never);
    expect(res.status).toBe(401);
  });
});
