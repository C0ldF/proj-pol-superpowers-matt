import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const mockAreas = [
  { area_id: 'zona-1', area_nome: '1', forca: 10, potencial: 100, penetracao: 0.1, ponto_geojson: { type: 'Point', coordinates: [-42.8, -5.09] } },
];

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = mockAreas, rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

import { GET } from './route';
import { ssrClient } from '../../../lib/supabase/ssr';

describe('GET /api/mapa-calor', () => {
  it('retorna array de áreas com granularidade default (zona)', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockAreas);
    expect(supabase.rpc).toHaveBeenCalledWith('mapa_calor_agregado', { granularidade: 'zona' });
  });

  it('repassa granularidade=bairro da query string', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    await GET(new Request('http://localhost/api/mapa-calor?granularidade=bairro') as never);
    expect(supabase.rpc).toHaveBeenCalledWith('mapa_calor_agregado', { granularidade: 'bairro' });
  });

  it('400 pra granularidade inválida', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor?granularidade=municipio') as never);
    expect(res.status).toBe(400);
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor') as never);
    expect(res.status).toBe(401);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor') as never);
    expect(res.status).toBe(500);
  });
});
