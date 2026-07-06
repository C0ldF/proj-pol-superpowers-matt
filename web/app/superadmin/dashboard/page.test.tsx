import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('./DashboardSuperadminClient', () => ({
  DashboardSuperadminClient: () => 'dashboard-superadmin-client-mock',
}));

import { ssrClient } from '../../../lib/supabase/ssr';
import Page from './page';

describe('/superadmin/dashboard page', () => {
  it('mostra mensagem quando não autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('não autenticado');
    expect(html).not.toContain('dashboard-superadmin-client-mock');
  });

  it('mostra mensagem quando autenticado mas não é superadmin', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
      rpc: async () => ({ data: false, error: null }),
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('acesso restrito ao superadmin');
    expect(html).not.toContain('dashboard-superadmin-client-mock');
  });

  it('renderiza o dashboard quando é superadmin', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
      rpc: async () => ({ data: true, error: null }),
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('dashboard-superadmin-client-mock');
  });
});
