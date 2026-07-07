import { describe, it, expect } from 'vitest';
import { subdominioValido, ufValida, dataEleicaoValida } from './validacao';

describe('subdominioValido', () => {
  it('aceita minúsculas/números/hífen dentro do tamanho', () => {
    expect(subdominioValido('campanha-2028')).toBe(true);
  });
  it('rejeita maiúscula (quem chama deve normalizar antes)', () => {
    expect(subdominioValido('ABC')).toBe(false);
  });
  it('rejeita espaço e pontuação', () => {
    expect(subdominioValido('a b')).toBe(false);
    expect(subdominioValido('teste!!!')).toBe(false);
  });
  it('rejeita menos de 3 ou mais de 63 caracteres', () => {
    expect(subdominioValido('ab')).toBe(false);
    expect(subdominioValido('a'.repeat(64))).toBe(false);
  });
});

describe('ufValida', () => {
  it('aceita exatamente 2 letras maiúsculas', () => {
    expect(ufValida('PI')).toBe(true);
  });
  it('rejeita minúsculas (quem chama deve normalizar antes)', () => {
    expect(ufValida('pi')).toBe(false);
  });
  it('rejeita formato errado', () => {
    expect(ufValida('P1')).toBe(false);
    expect(ufValida('PIA')).toBe(false);
  });
});

describe('dataEleicaoValida', () => {
  it('aceita data real bem formatada', () => {
    expect(dataEleicaoValida('2028-10-01')).toBe(true);
  });
  it('rejeita formato errado', () => {
    expect(dataEleicaoValida('10/01/2028')).toBe(false);
  });
  it('rejeita string vazia', () => {
    expect(dataEleicaoValida('')).toBe(false);
  });
  it('rejeita data impossível mesmo com formato correto (2028-02-30)', () => {
    expect(dataEleicaoValida('2028-02-30')).toBe(false);
  });
  it('rejeita 29 de fevereiro em ano não-bissexto (2027)', () => {
    expect(dataEleicaoValida('2027-02-29')).toBe(false);
  });
  it('aceita 29 de fevereiro em ano bissexto (2028)', () => {
    expect(dataEleicaoValida('2028-02-29')).toBe(true);
  });
});
