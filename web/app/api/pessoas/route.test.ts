import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../lib/pessoa/build-criar-deps', () => ({
  buildCriarDeps: vi.fn(async () => ({
    tituloHmac:    (t: string) => 'h-' + t,
    encryptTitulo: async (t: string) => 'e-' + t,
    cpfHmac:       (c: string) => 'h-' + c,
    buscarDuplicada:       vi.fn(async () => null),
    criarPessoaComVinculo: vi.fn(async () => ({ pessoa_id: 'pid-1', vinculo_id: 'vid-1' })),
  })),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'u-1', app_metadata: { campanha_id: 'c-1' } } },
        error: null,
      })),
    },
  })),
}));

import { POST } from './route';

function req(body: unknown, sub = 'campanha-a') {
  return new Request('http://localhost/api/pessoas', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-campanha-subdominio': sub },
    body: JSON.stringify(body),
  });
}

describe('POST /api/pessoas', () => {
  it('201 ao criar pessoa nova', async () => {
    const res = await POST(req({ nome: 'João', responsavel_id: 'r-1', papel: 'apoiador' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ public_id: expect.stringMatching(/^pes_/) });
  });

  it('400 sem nome', async () => {
    const res = await POST(req({ responsavel_id: 'r-1', papel: 'apoiador' }));
    expect(res.status).toBe(400);
  });

  it('401 sem usuário autenticado', async () => {
    const { ssrClient } = await import('../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const res = await POST(req({ nome: 'X', responsavel_id: 'r-1', papel: 'apoiador' }));
    expect(res.status).toBe(401);
  });
});
