import { describe, it, expect } from 'vitest';
import { extractSubdomain } from './subdomain';

describe('extractSubdomain', () => {
  it('extrai o subdomínio de um host de campanha', () => {
    expect(extractSubdomain('campanha-a.dominio.com.br')).toBe('campanha-a');
  });
  it('retorna null para o domínio raiz (sem subdomínio)', () => {
    expect(extractSubdomain('dominio.com.br')).toBeNull();
  });
  it('ignora a porta no host de localhost', () => {
    expect(extractSubdomain('campanha-a.localhost:3000')).toBe('campanha-a');
  });
  it('retorna null para www', () => {
    expect(extractSubdomain('www.dominio.com.br')).toBeNull();
  });
});
