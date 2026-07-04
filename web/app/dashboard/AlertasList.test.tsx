// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AlertasList } from './AlertasList';

const mockAlertas = [
  { tipo: 'area', alvo_id: 'zona-1', label: '1', detalhe: { potencial: 500, penetracao: 0.01, media_potencial: 300 } },
  { tipo: 'lideranca_estagnada', alvo_id: 'p-1', label: 'Lider A', detalhe: { lider_desde: '2026-05-01T00:00:00Z' } },
];

describe('AlertasList', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => mockAlertas })) as never;
  });

  it('busca /api/dashboard/alertas e renderiza os 2 tipos', async () => {
    render(<AlertasList />);
    expect(await screen.findByText(/zona 1/i)).toBeInTheDocument();
    expect(screen.getByText(/lider a/i)).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há alerta', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as never;
    render(<AlertasList />);
    expect(await screen.findByText(/nenhum alerta/i)).toBeInTheDocument();
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<AlertasList />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
