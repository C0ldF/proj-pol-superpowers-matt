// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SuperadminLoginPage from './page';

describe('/superadmin/login page', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
  });

  afterEach(() => {
    cleanup();
  });

  it('envia email e senha pro endpoint de login', async () => {
    render(<SuperadminLoginPage />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'admin@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@x.com', senha: 'segredo' }),
      });
    });
  });

  it('mostra mensagem de erro quando o login falha', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ erro: 'e-mail ou senha inválidos' }),
    })) as never;
    render(<SuperadminLoginPage />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'admin@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('e-mail ou senha inválidos');
    });
  });

  it('desabilita o botão durante a requisição e reabilita após erro', async () => {
    let resolveFetch: (value: { ok: boolean; json: () => Promise<{ erro?: string }> }) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    render(<SuperadminLoginPage />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'admin@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByText('Entrar')).toBeDisabled();
    });

    resolveFetch!({ ok: false, json: async () => ({ erro: 'falhou' }) });

    await waitFor(() => {
      expect(screen.getByText('Entrar')).not.toBeDisabled();
    });
  });
});
