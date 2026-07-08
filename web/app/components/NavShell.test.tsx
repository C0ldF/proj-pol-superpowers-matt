// web/app/components/NavShell.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { NavShell } from './NavShell';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

function renderNav() {
  return render(
    <NavShell>
      <p>conteudo-de-teste</p>
    </NavShell>,
  );
}

describe('NavShell', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
    // @ts-expect-error jsdom não navega de verdade — substitui por um objeto simples e observável
    delete window.location;
    // @ts-expect-error idem
    window.location = { href: '' };
  });

  it('renderiza os 2 links de navegação e o children', () => {
    renderNav();
    expect(screen.getByText('Mapa de Calor')).toHaveAttribute('href', '/mapa-calor');
    expect(screen.getByText('Dashboard')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('conteudo-de-teste')).toBeInTheDocument();
  });

  it('marca aria-current="page" só no link cujo href bate com o pathname atual', () => {
    renderNav();
    expect(screen.getByText('Dashboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Mapa de Calor')).not.toHaveAttribute('aria-current');
  });

  it('clicar em Sair dispara POST /api/auth/logout e redireciona pro /login', async () => {
    renderNav();
    fireEvent.click(screen.getByText('Sair'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    });
    await waitFor(() => {
      expect(window.location.href).toBe('/login');
    });
  });

  it('redireciona pro /login mesmo se o fetch falhar (falha de rede)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as never;
    renderNav();
    fireEvent.click(screen.getByText('Sair'));

    await waitFor(() => {
      expect(window.location.href).toBe('/login');
    });
  });
});
