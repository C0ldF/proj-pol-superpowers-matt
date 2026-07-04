// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { RankingTable } from './RankingTable';

const mockRanking = [
  { pessoa_id: 'p-1', nome: 'Lider A', subarvore_count: 5, soma_ramos: 7, total_real: 6 },
  { pessoa_id: 'p-2', nome: 'Lider B', subarvore_count: 2, soma_ramos: 7, total_real: 6 },
];

describe('RankingTable', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => mockRanking })) as never;
  });

  afterEach(() => {
    cleanup();
  });

  it('busca /api/dashboard/ranking e renderiza as linhas', async () => {
    render(<RankingTable />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/dashboard/ranking');
    });
    expect(await screen.findByText('Lider A')).toBeInTheDocument();
    expect(screen.getByText('Lider B')).toBeInTheDocument();
  });

  it('mostra a nota soma dos ramos ≠ total real', async () => {
    render(<RankingTable />);
    expect(await screen.findByText(/7/)).toBeInTheDocument();
    expect(screen.getByText(/6/)).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há líder', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as never;
    render(<RankingTable />);
    expect(await screen.findByText(/nenhum líder/i)).toBeInTheDocument();
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<RankingTable />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
