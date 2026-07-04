import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/authenticated-rpc', () => ({
  authenticatedRpc: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { GET } from './route';
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

describe('GET /api/dashboard/alertas', () => {
  it('chama authenticatedRpc com "dashboard_alertas"', async () => {
    await GET();
    expect(authenticatedRpc).toHaveBeenCalledWith('dashboard_alertas');
  });
});
