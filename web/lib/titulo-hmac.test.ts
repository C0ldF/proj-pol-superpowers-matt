import { describe, it, expect } from 'vitest';
import { tituloHmac, normalizarTitulo } from './titulo-hmac';

const KEY = 'test-key-32-bytes-long-padded-here';

describe('normalizarTitulo', () => {
  it('remove não-dígitos', () => {
    expect(normalizarTitulo('012 3456 7890')).toBe('01234567890');
  });
  it('string vazia retorna vazia', () => {
    expect(normalizarTitulo('')).toBe('');
  });
});

describe('tituloHmac', () => {
  it('retorna hex string de 64 chars', () => {
    const h = tituloHmac('01234567890', KEY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('mesmo título normalizado → mesmo hash', () => {
    expect(tituloHmac('012 3456 7890', KEY)).toBe(tituloHmac('01234567890', KEY));
  });
  it('títulos diferentes → hashes diferentes', () => {
    expect(tituloHmac('11111111111', KEY)).not.toBe(tituloHmac('22222222222', KEY));
  });
  it('lança sem TITULO_HMAC_KEY', () => {
    expect(() => tituloHmac('01234567890')).toThrow('TITULO_HMAC_KEY');
  });
});
