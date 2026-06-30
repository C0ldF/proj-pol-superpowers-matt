import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'u-1', app_metadata: { campanha_id: 'c-1', papel: 'gestor' } } },
        error: null,
      })),
    },
  })),
}));

vi.mock('../../../../../lib/supabase/server', () => ({
  adminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: 'pes-uuid-1', cpf_hmac: 'hash-cpf' },
              error: null,
            })),
          })),
        })),
      })),
    })),
    auth: {
      admin: {
        createUser: vi.fn(async () => ({
          data: { user: { id: 'new-user-id' } },
          error: null,
        })),
        deleteUser: vi.fn(async () => ({ error: null })),
      },
    },
    rpc: vi.fn(async () => ({ error: null })),
  })),
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/pessoas/pes_abc/provisionar-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/pessoas/:publicId/provisionar-login', () => {
  it('201 ao provisionar login com sucesso', async () => {
    const res = await POST(req({ email: 'joao@teste.com' }), { params: Promise.resolve({ publicId: 'pes_abc' }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('senha_temporaria');
  });

  it('403 para papel não-gestor', async () => {
    const { ssrClient } = await import('../../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: {
        getUser: async () => ({
          data: { user: { id: 'u-2', app_metadata: { campanha_id: 'c-1', papel: 'lideranca' } } },
          error: null,
        }),
      },
    } as never);
    const res = await POST(req({ email: 'x@x.com' }), { params: Promise.resolve({ publicId: 'pes_abc' }) });
    expect(res.status).toBe(403);
  });
});
