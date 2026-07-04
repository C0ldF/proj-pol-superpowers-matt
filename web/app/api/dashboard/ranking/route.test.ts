import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/authenticated-rpc', () => ({
  authenticatedRpc: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { GET } from './route';
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

describe('GET /api/dashboard/ranking', () => {
  it('chama authenticatedRpc com "ranking_liderancas"', async () => {
    await GET();
    expect(authenticatedRpc).toHaveBeenCalledWith('ranking_liderancas');
  });
});
