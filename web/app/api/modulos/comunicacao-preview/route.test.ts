import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/require-modulo', () => ({
  requireModulo: vi.fn(async () => null),
}));

import { GET } from './route';
import { requireModulo } from '../../../../lib/supabase/require-modulo';

describe('GET /api/modulos/comunicacao-preview', () => {
  it('retorna 200 {preview:true} quando requireModulo libera (retorna null)', async () => {
    vi.mocked(requireModulo).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ preview: true });
    expect(requireModulo).toHaveBeenCalledWith('comunicacao');
  });

  it('repassa o NextResponse de bloqueio quando requireModulo retorna não-null', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'módulo não habilitado' }, { status: 403 });
    vi.mocked(requireModulo).mockResolvedValueOnce(blocked);
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
