import { describe, it, expect } from 'vitest';
import { normalizarCpf, cpfValido } from './cpf';

describe('normalizarCpf', () => {
  it('remove pontuação e espaços', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
  });
});

describe('cpfValido', () => {
  it('aceita um CPF com dígitos verificadores corretos', () => {
    expect(cpfValido('52998224725')).toBe(true);
  });
  it('rejeita dígitos verificadores errados', () => {
    expect(cpfValido('52998224724')).toBe(false);
  });
  it('rejeita todos os dígitos iguais', () => {
    expect(cpfValido('11111111111')).toBe(false);
  });
  it('rejeita comprimento != 11', () => {
    expect(cpfValido('123')).toBe(false);
  });
});
