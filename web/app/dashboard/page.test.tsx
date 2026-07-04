import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('./DashboardClient', () => ({
  DashboardClient: () => 'dashboard-client-mock',
}));

import { ssrClient } from '../../lib/supabase/ssr';
import Page from './page';

describe('/dashboard page', () => {
  it('mostra mensagem quando não autenticado, sem renderizar o dashboard', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('não autenticado');
    expect(html).not.toContain('dashboard-client-mock');
  });

  it('renderiza o dashboard quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('dashboard-client-mock');
  });
});
