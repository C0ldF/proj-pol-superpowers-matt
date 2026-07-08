// web/app/redefinir-senha/page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createBrowserClient } from '@supabase/ssr';
import RedefinirSenha from './page';

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function mockUpdateUser(impl: () => Promise<{ error: { message: string } | null }>) {
  const updateUser = vi.fn(impl);
  vi.mocked(createBrowserClient).mockReturnValue({ auth: { updateUser } } as never);
  return updateUser;
}

describe('/redefinir-senha page', () => {
  it('chama updateUser com a senha digitada', async () => {
    const updateUser = mockUpdateUser(async () => ({ error: null }));

    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'senhaNova123' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ password: 'senhaNova123' });
    });
  });

  it('mostra mensagem de sucesso (role="status") quando updateUser não retorna erro', async () => {
    mockUpdateUser(async () => ({ error: null }));
    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'senhaNova123' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Senha redefinida.');
    });
  });

  it('mostra mensagem de erro (role="alert") quando updateUser retorna erro', async () => {
    mockUpdateUser(async () => ({ error: { message: 'falhou' } }));
    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível redefinir.');
    });
  });

  it('uma nova submissão limpa a mensagem anterior antes da nova requisição concluir', async () => {
    mockUpdateUser(async () => ({ error: { message: 'primeiro erro' } }));
    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    let resolveUpdateUser: (value: { error: { message: string } | null }) => void;
    vi.mocked(createBrowserClient).mockReturnValue({
      auth: {
        updateUser: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveUpdateUser = resolve;
            }),
        ),
      },
    } as never);
    fireEvent.click(screen.getByText('Salvar'));

    // Antes da 2ª requisição concluir, a mensagem antiga já deve ter sumido.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    resolveUpdateUser!({ error: null });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Senha redefinida.');
    });
  });
});
