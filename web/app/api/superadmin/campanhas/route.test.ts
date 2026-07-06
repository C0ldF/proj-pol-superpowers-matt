import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

const mockCampanhas = [
  { id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a', modulos_habilitados: ['comunicacao'] },
];

function mockAdmin(overrides: Partial<{ data: unknown; error: unknown }> = {}) {
  const { data = mockCampanhas, error = null } = overrides;
  return {
    from: vi.fn(() => ({
      select: vi.fn(async () => ({ data, error })),
    })),
  };
}

vi.mock('../../../../lib/supabase/server', () => ({ adminClient: vi.fn() }));

import { GET } from './route';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';

describe('GET /api/superadmin/campanhas', () => {
  it('retorna 200 com array de campanhas quando liberado', async () => {
    vi.mocked(adminClient).mockReturnValue(mockAdmin() as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockCampanhas);
  });

  it('repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('500 quando a leitura falha', async () => {
    vi.mocked(adminClient).mockReturnValue(mockAdmin({ data: null, error: { message: 'falha' } }) as never);
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
