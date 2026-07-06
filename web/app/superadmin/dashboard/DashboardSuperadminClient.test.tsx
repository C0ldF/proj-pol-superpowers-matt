// web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { DashboardSuperadminClient } from './DashboardSuperadminClient';

const mockCampanhas = [
  { id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a', modulos_habilitados: ['comunicacao'] },
];

describe('DashboardSuperadminClient', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/modulos') {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      if (url === '/api/superadmin/logout') {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;
  });

  it('busca /api/superadmin/campanhas e lista a campanha com o módulo já marcado', async () => {
    render(<DashboardSuperadminClient />);
    expect(await screen.findByText(/Campanha A/)).toBeInTheDocument();
    const checkboxComunicacao = screen.getByRole('checkbox', { name: 'comunicacao' });
    expect(checkboxComunicacao).toBeChecked();
    const checkboxIa = screen.getByRole('checkbox', { name: 'ia' });
    expect(checkboxIa).not.toBeChecked();
  });

  it('marcar o checkbox chama POST /api/superadmin/modulos com acao=habilitar', async () => {
    render(<DashboardSuperadminClient />);
    const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
    fireEvent.click(checkboxIa);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/modulos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: 'c-1', modulo: 'ia', acao: 'habilitar' }),
      });
    });
    await waitFor(() => expect(checkboxIa).toBeChecked());
  });

  it('desmarcar o checkbox chama POST /api/superadmin/modulos com acao=desabilitar', async () => {
    render(<DashboardSuperadminClient />);
    const checkboxComunicacao = await screen.findByRole('checkbox', { name: 'comunicacao' });
    fireEvent.click(checkboxComunicacao);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/modulos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'desabilitar' }),
      });
    });
    await waitFor(() => expect(checkboxComunicacao).not.toBeChecked());
  });

  it('clicar em Sair chama POST /api/superadmin/logout', async () => {
    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);
    fireEvent.click(screen.getByText('Sair'));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/logout', { method: 'POST' });
    });
  });

  it('mostra erro quando a busca de campanhas falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<DashboardSuperadminClient />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
