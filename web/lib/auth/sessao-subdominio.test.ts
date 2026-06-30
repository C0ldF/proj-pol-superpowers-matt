import { describe, it, expect } from 'vitest';
import { sessaoConflitaSubdominio } from './sessao-subdominio';

describe('sessaoConflitaSubdominio', () => {
  it('não conflita quando batem', () => {
    expect(sessaoConflitaSubdominio({ tokenCampanhaId: 'a', campanhaIdResolvida: 'a' })).toBe(false);
  });
  it('conflita quando a sessão é de outra campanha', () => {
    expect(sessaoConflitaSubdominio({ tokenCampanhaId: 'a', campanhaIdResolvida: 'b' })).toBe(true);
  });
  it('não conflita quando não há sessão (token null)', () => {
    expect(sessaoConflitaSubdominio({ tokenCampanhaId: null, campanhaIdResolvida: 'b' })).toBe(false);
  });
});
