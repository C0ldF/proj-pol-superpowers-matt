import { describe, it, expect } from 'vitest';
import {
  normalizarTexto, mapTipoLocal, mapSituacaoLocal, parseSecoes, normalizarCep, hashLinha,
} from './normalizar';

describe('normalizarTexto', () => {
  it('remove acentos, baixa caixa e trima', () => {
    expect(normalizarTexto('  Água Mineral  ')).toBe('agua mineral');
  });
  it('string vazia retorna vazia', () => {
    expect(normalizarTexto('')).toBe('');
  });
});

describe('mapTipoLocal', () => {
  it('CONVENCIONAL mapeia para convencional', () => {
    expect(mapTipoLocal('CONVENCIONAL')).toBe('convencional');
  });
  it('VOTO EM TRÂNSITO mapeia para transito', () => {
    expect(mapTipoLocal('VOTO EM TRÂNSITO')).toBe('transito');
  });
  it('PRESO PROVISÓRIO mapeia para preso_provisorio', () => {
    expect(mapTipoLocal('PRESO PROVISÓRIO')).toBe('preso_provisorio');
  });
  it('valor desconhecido mapeia para outro', () => {
    expect(mapTipoLocal('ESPECIAL')).toBe('outro');
  });
});

describe('mapSituacaoLocal', () => {
  it('ATIVO mapeia para ativo', () => {
    expect(mapSituacaoLocal('ATIVO')).toBe('ativo');
  });
  it('qualquer outro mapeia para bloqueado', () => {
    expect(mapSituacaoLocal('BLOQUEADO')).toBe('bloqueado');
    expect(mapSituacaoLocal('')).toBe('bloqueado');
  });
});

describe('parseSecoes', () => {
  it('parseia múltiplas seções', () => {
    const r = parseSecoes('(s: 185, apt: 253), (s: 186, apt: 258)');
    expect(r.secoes).toEqual([{ numero: 185, aptos: 253 }, { numero: 186, aptos: 258 }]);
    expect(r.avisos).toEqual([]);
  });
  it('string vazia retorna lista vazia sem aviso', () => {
    expect(parseSecoes('')).toEqual({ secoes: [], avisos: [] });
  });
  it('grupo malformado gera aviso e é ignorado', () => {
    const r = parseSecoes('(s: , apt: 10), (s: 20, apt: 5)');
    expect(r.secoes).toEqual([{ numero: 20, aptos: 5 }]);
    expect(r.avisos).toContain('secao_malformada');
  });
  it('seção duplicada mantém a primeira e avisa', () => {
    const r = parseSecoes('(s: 10, apt: 1), (s: 10, apt: 2)');
    expect(r.secoes).toEqual([{ numero: 10, aptos: 1 }]);
    expect(r.avisos).toContain('secao_duplicada');
  });
});

describe('normalizarCep', () => {
  it('remove não-dígitos', () => {
    expect(normalizarCep('64002-510')).toEqual({ cep: '64002510', avisoInvalido: false });
  });
  it('CEP com menos de 8 dígitos gera aviso', () => {
    expect(normalizarCep('6400251')).toEqual({ cep: '6400251', avisoInvalido: true });
  });
  it('vazio retorna null sem aviso', () => {
    expect(normalizarCep('')).toEqual({ cep: null, avisoInvalido: false });
  });
});

describe('hashLinha', () => {
  it('mesma linha (ordem de chaves diferente) produz mesmo hash', () => {
    expect(hashLinha({ a: '1', b: '2' })).toBe(hashLinha({ b: '2', a: '1' }));
  });
  it('linha diferente produz hash diferente', () => {
    expect(hashLinha({ a: '1' })).not.toBe(hashLinha({ a: '2' }));
  });
});
