// web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { DashboardSuperadminClient } from './DashboardSuperadminClient';

const mockCampanhas = [
  {
    id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a',
    modulos_habilitados: ['comunicacao'], status: 'ativa',
  },
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

  it('mostra erro e libera o checkbox quando o POST de módulo falha por rede (fetch rejeita)', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/modulos') {
        throw new Error('network error');
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
    fireEvent.click(checkboxIa);

    expect(checkboxIa).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });

    expect(screen.queryByRole('checkbox', { name: 'ia' })).not.toBeInTheDocument();
  });

  it('mostra erro quando o POST de módulo responde com falha (res.ok === false)', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/modulos') {
        return { ok: false, json: async () => ({}) } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
    fireEvent.click(checkboxIa);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });

  it('preencher e submeter o formulário de nova campanha dispara POST /api/superadmin/campanhas; sucesso adiciona a linha sem refetch', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/superadmin/campanhas' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/campanhas' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'c-2', nome: 'Campanha Nova', subdominio: 'campanha-nova',
            modulos_habilitados: [], status: 'ativa',
          }),
        } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);

    fireEvent.change(screen.getByPlaceholderText('Subdomínio'), { target: { value: 'campanha-nova' } });
    fireEvent.change(screen.getByPlaceholderText('Nome'), { target: { value: 'Campanha Nova' } });
    fireEvent.change(screen.getByPlaceholderText('Código IBGE do município'), { target: { value: '2211001' } });
    fireEvent.change(screen.getByPlaceholderText('Data da eleição'), { target: { value: '2028-10-01' } });
    fireEvent.click(screen.getByText('Nova campanha'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/campanhas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subdominio: 'campanha-nova', nome: 'Campanha Nova', cargo: 'vereador',
          abrangencia: 'municipal', municipioId: 2211001, dataEleicao: '2028-10-01',
        }),
      });
    });
    expect(await screen.findByText(/Campanha Nova/)).toBeInTheDocument();
  });

  it('erro na criação mostra body.erro em role="alert"', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/superadmin/campanhas' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/campanhas' && init?.method === 'POST') {
        return { ok: false, json: async () => ({ erro: 'subdomínio já em uso' }) } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);

    fireEvent.change(screen.getByPlaceholderText('Subdomínio'), { target: { value: 'campanha-a' } });
    fireEvent.change(screen.getByPlaceholderText('Nome'), { target: { value: 'Duplicada' } });
    fireEvent.change(screen.getByPlaceholderText('Código IBGE do município'), { target: { value: '2211001' } });
    fireEvent.change(screen.getByPlaceholderText('Data da eleição'), { target: { value: '2028-10-01' } });
    fireEvent.click(screen.getByText('Nova campanha'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('subdomínio já em uso');
    });
  });

  it('campanha ativa mostra Suspender/Encerrar; suspensa mostra Reativar/Encerrar; encerrada não mostra botão', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return {
          ok: true,
          json: async () => [
            { id: 'c-1', nome: 'Ativa', subdominio: 'ativa', modulos_habilitados: [], status: 'ativa' },
            { id: 'c-2', nome: 'Suspensa', subdominio: 'suspensa', modulos_habilitados: [], status: 'suspensa' },
            { id: 'c-3', nome: 'Encerrada', subdominio: 'encerrada', modulos_habilitados: [], status: 'encerrada' },
          ],
        } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Ativa/);

    const linhaAtiva = screen.getByText(/Ativa \(/).closest('tr')!;
    expect(within(linhaAtiva).getByText('Suspender')).toBeInTheDocument();
    expect(within(linhaAtiva).getByText('Encerrar')).toBeInTheDocument();
    expect(within(linhaAtiva).queryByText('Reativar')).not.toBeInTheDocument();

    const linhaSuspensa = screen.getByText(/Suspensa \(/).closest('tr')!;
    expect(within(linhaSuspensa).getByText('Reativar')).toBeInTheDocument();
    expect(within(linhaSuspensa).getByText('Encerrar')).toBeInTheDocument();

    const linhaEncerrada = screen.getByText(/Encerrada \(/).closest('tr')!;
    expect(within(linhaEncerrada).queryByText('Suspender')).not.toBeInTheDocument();
    expect(within(linhaEncerrada).queryByText('Reativar')).not.toBeInTheDocument();
    expect(within(linhaEncerrada).queryByText('Encerrar')).not.toBeInTheDocument();
  });

  it('clicar em Suspender dispara POST /api/superadmin/campanhas/status, desabilita durante a requisição, atualiza status só depois do 200', async () => {
    let resolveFetch: (value: Response) => void;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/campanhas/status') {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);

    const botaoSuspender = screen.getByText('Suspender');
    fireEvent.click(botaoSuspender);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/campanhas/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: 'c-1', novoStatus: 'suspensa' }),
      });
    });
    expect(botaoSuspender).toBeDisabled();

    resolveFetch!({ ok: true, json: async () => ({ campanha: { id: 'c-1', status: 'suspensa' } }) } as Response);

    await waitFor(() => {
      expect(screen.getByText('Reativar')).toBeInTheDocument();
    });
  });
});
