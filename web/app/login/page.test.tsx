// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LoginPage from './page';

function fakeResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function fakeResponseThatFailsToParse(ok = false) {
  return {
    ok,
    json: async () => {
      throw new Error('invalid json');
    },
  } as Response;
}

describe('/login page', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => fakeResponse({ ok: true })) as never;
  });

  afterEach(() => {
    cleanup();
  });

  it('envia identificador e senha pro endpoint de login', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identificador: 'user@campanha.com', senha: 'segredo' }),
      });
    });
  });

  it('mostra a mensagem de erro do servidor quando o login falha', async () => {
    globalThis.fetch = vi.fn(async () => fakeResponse({ erro: 'CPF/e-mail ou senha inválidos' }, false)) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('CPF/e-mail ou senha inválidos');
    });
  });

  it('usa mensagem genérica quando a resposta de erro não tem body.erro', async () => {
    globalThis.fetch = vi.fn(async () => fakeResponse({}, false)) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar.');
    });
  });

  it('usa mensagem genérica quando o fetch rejeita (falha de rede)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar.');
    });
  });

  it('usa mensagem genérica e reabilita o botão quando res.json() falha (resposta sem JSON válido)', async () => {
    globalThis.fetch = vi.fn(async () => fakeResponseThatFailsToParse()) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar.');
      expect(screen.getByText('Entrar')).not.toBeDisabled();
    });
  });

  it('desabilita o botão durante a requisição e reabilita após erro', async () => {
    let resolveFetch: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByText('Entrar')).toBeDisabled();
    });

    resolveFetch!(fakeResponse({ erro: 'falhou' }, false));

    await waitFor(() => {
      expect(screen.getByText('Entrar')).not.toBeDisabled();
    });
  });

  it('uma nova submissão limpa a mensagem de erro anterior antes da nova requisição concluir', async () => {
    globalThis.fetch = vi.fn(async () => fakeResponse({ erro: 'primeiro erro' }, false)) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('primeiro erro');
    });

    let resolveFetch: (value: Response) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    fireEvent.click(screen.getByText('Entrar'));

    // Antes da 2ª requisição concluir, o alerta antigo já deve ter sumido.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    resolveFetch!(fakeResponse({ erro: 'segundo erro' }, false));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('segundo erro');
    });
  });
});
