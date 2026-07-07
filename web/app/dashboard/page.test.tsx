import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

const DashboardClient = vi.fn(() => 'dashboard-client-mock');
vi.mock('./DashboardClient', () => ({ DashboardClient: () => DashboardClient() }));

const REDIRECT_SENTINEL = Symbol('NEXT_REDIRECT');
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw REDIRECT_SENTINEL;
  }),
}));

import { ssrClient } from '../../lib/supabase/ssr';
import { redirect } from 'next/navigation';
import Page from './page';

describe('/dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redireciona pro /login quando não autenticado, sem renderizar o dashboard', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    await expect(Page()).rejects.toBe(REDIRECT_SENTINEL);
    expect(redirect).toHaveBeenCalledWith('/login');
    expect(DashboardClient).not.toHaveBeenCalled();
  });

  it('renderiza o dashboard quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('dashboard-client-mock');
    expect(redirect).not.toHaveBeenCalled();
  });
});
