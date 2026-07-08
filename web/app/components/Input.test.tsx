// web/app/components/Input.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Input } from './Input';

afterEach(() => {
  cleanup();
});

describe('Input', () => {
  it('associa o label ao campo via htmlFor/id', () => {
    render(<Input label="CPF ou e-mail" />);
    const input = screen.getByLabelText('CPF ou e-mail');
    expect(input).toBeInTheDocument();
  });

  it('repassa placeholder e outras props nativas', () => {
    render(<Input label="Senha" type="password" placeholder="Senha" />);
    const input = screen.getByPlaceholderText('Senha');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('usa o id explícito quando fornecido, em vez de gerar um', () => {
    render(<Input label="CPF ou e-mail" id="identificador" />);
    expect(screen.getByLabelText('CPF ou e-mail')).toHaveAttribute('id', 'identificador');
  });

  it('marca aria-invalid quando error=true', () => {
    render(<Input label="Senha" error />);
    expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true');
  });

  it('não marca aria-invalid quando error não é passado', () => {
    render(<Input label="Senha" />);
    expect(screen.getByLabelText('Senha')).not.toHaveAttribute('aria-invalid');
  });

  it('fica desabilitado quando disabled=true', () => {
    render(<Input label="Senha" disabled />);
    expect(screen.getByLabelText('Senha')).toBeDisabled();
  });

  it('quando error=true, o label também fica com a cor de erro (não é só a borda) — evita "cor sozinha" carregar o significado', () => {
    render(<Input label="Senha" error />);
    expect(screen.getByText('Senha')).toHaveClass('text-error');
  });

  it('quando error não é passado, o label usa a cor neutra padrão', () => {
    render(<Input label="Senha" />);
    expect(screen.getByText('Senha')).toHaveClass('text-on-surface-variant');
    expect(screen.getByText('Senha')).not.toHaveClass('text-error');
  });

  it('quando error=true, a classe de hover da borda também é a de erro (hover não pode mascarar o erro)', () => {
    render(<Input label="Senha" error />);
    const input = screen.getByLabelText('Senha');
    expect(input).toHaveClass('border-error', 'hover:border-error');
    expect(input).not.toHaveClass('hover:border-on-surface-variant');
  });
});
