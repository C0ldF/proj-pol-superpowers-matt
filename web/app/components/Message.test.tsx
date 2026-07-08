// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Message } from './Message';

afterEach(() => {
  cleanup();
});

describe('Message', () => {
  it('renderiza os children', () => {
    render(<Message variant="error">Algo deu errado</Message>);
    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
  });

  it('variante error usa role="alert"', () => {
    render(<Message variant="error">Erro</Message>);
    expect(screen.getByRole('alert')).toHaveTextContent('Erro');
  });

  it('variante error aplica os tokens de cor de erro', () => {
    render(<Message variant="error">Erro</Message>);
    expect(screen.getByRole('alert')).toHaveClass('bg-error-container', 'text-on-error-container');
  });

  it('variante success usa role="status"', () => {
    render(<Message variant="success">Feito</Message>);
    expect(screen.getByRole('status')).toHaveTextContent('Feito');
  });

  it('variante success aplica os tokens de cor de sucesso', () => {
    render(<Message variant="success">Feito</Message>);
    expect(screen.getByRole('status')).toHaveClass('bg-secondary-container', 'text-on-secondary-container');
  });
});
