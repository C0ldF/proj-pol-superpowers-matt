import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { cpfHmac } from './cpf-hmac';

const KEY = 'chave-de-teste';
const esperado = createHmac('sha256', KEY).update('52998224725').digest('hex');

describe('cpfHmac', () => {
  it('produz o hex do HMAC-SHA256 com a chave dada', () => {
    expect(cpfHmac('52998224725', KEY)).toBe(esperado);
  });
  it('é determinístico', () => {
    expect(cpfHmac('52998224725', KEY)).toBe(cpfHmac('52998224725', KEY));
  });
  it('difere para CPFs diferentes', () => {
    expect(cpfHmac('52998224725', KEY)).not.toBe(cpfHmac('11144477735', KEY));
  });
  it('lança se nenhuma chave está disponível', () => {
    const old = process.env.CPF_HMAC_KEY;
    delete process.env.CPF_HMAC_KEY;
    expect(() => cpfHmac('52998224725')).toThrow();
    if (old !== undefined) process.env.CPF_HMAC_KEY = old;
  });
});
