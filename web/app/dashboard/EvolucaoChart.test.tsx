// web/app/dashboard/EvolucaoChart.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EvolucaoChart } from './EvolucaoChart';

const mockEvolucao = [
  { dia: '2026-07-03', total: 10 },
  { dia: '2026-07-04', total: 12 },
];

describe('EvolucaoChart', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => mockEvolucao })) as never;
    // Recharts mede o container via ResizeObserver, ausente em jsdom.
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  it('busca /api/dashboard/evolucao', async () => {
    render(<EvolucaoChart />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/dashboard/evolucao');
    });
  });

  it('mostra estado vazio quando a série é toda zero', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ dia: '2026-07-04', total: 0 }],
    })) as never;
    render(<EvolucaoChart />);
    expect(await screen.findByText(/nenhuma movimentação/i)).toBeInTheDocument();
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<EvolucaoChart />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
