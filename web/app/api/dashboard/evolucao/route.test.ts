import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/authenticated-rpc', () => ({
  authenticatedRpc: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { GET } from './route';
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

describe('GET /api/dashboard/evolucao', () => {
  it('chama authenticatedRpc com "evolucao_pessoas"', async () => {
    await GET();
    expect(authenticatedRpc).toHaveBeenCalledWith('evolucao_pessoas');
  });
});
