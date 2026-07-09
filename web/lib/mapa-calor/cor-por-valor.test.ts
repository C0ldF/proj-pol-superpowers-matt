import { describe, it, expect } from 'vitest';
import { STEPS, indiceStep, corPorValor, limitesValores } from './cor-por-valor';

describe('indiceStep', () => {
  it('valor no mínimo retorna índice 0', () => {
    expect(indiceStep(10, 10, 50)).toBe(0);
  });

  it('valor no máximo retorna índice 12 (STEPS.length - 1)', () => {
    expect(indiceStep(50, 10, 50)).toBe(STEPS.length - 1);
  });

  it('valor no meio retorna índice ~6', () => {
    expect(indiceStep(30, 10, 50)).toBe(6);
  });

  it('min === max retorna o step central (índice 6)', () => {
    expect(indiceStep(30, 30, 30)).toBe(6);
  });

  it('valor abaixo do mínimo é clampado pro índice 0', () => {
    expect(indiceStep(-100, 10, 50)).toBe(0);
  });

  it('valor acima do máximo é clampado pro índice 12 (STEPS.length - 1)', () => {
    expect(indiceStep(999, 10, 50)).toBe(STEPS.length - 1);
  });
});

describe('corPorValor', () => {
  it('valor null retorna cinza neutro, independente da camada', () => {
    expect(corPorValor(null, 0, 10, 'forca')).toBe('var(--color-on-surface-variant)');
    expect(corPorValor(null, 0, 10, 'penetracao')).toBe('var(--color-on-surface-variant)');
  });

  it('valor no mínimo retorna o token do step 100 da camada', () => {
    expect(corPorValor(0, 0, 10, 'forca')).toBe('var(--color-heatmap-forca-100)');
    expect(corPorValor(0, 0, 10, 'potencial')).toBe('var(--color-heatmap-potencial-100)');
  });

  it('valor no máximo retorna o token do step 700 da camada', () => {
    expect(corPorValor(10, 0, 10, 'penetracao')).toBe('var(--color-heatmap-penetracao-700)');
  });
});

describe('limitesValores', () => {
  it('lista vazia retorna null', () => {
    expect(limitesValores([], 'forca')).toBeNull();
  });

  it('todos os valores da camada nulos retorna null', () => {
    const areas = [
      { forca: 1, potencial: 1, penetracao: null },
      { forca: 2, potencial: 2, penetracao: null },
    ];
    expect(limitesValores(areas, 'penetracao')).toBeNull();
  });

  it('ignora null e calcula min/max só dos números', () => {
    const areas = [
      { forca: 1, potencial: 1, penetracao: 0.2 },
      { forca: 2, potencial: 2, penetracao: null },
      { forca: 3, potencial: 3, penetracao: 0.8 },
    ];
    expect(limitesValores(areas, 'penetracao')).toEqual({ min: 0.2, max: 0.8 });
  });

  it('calcula min/max pra camada sem valores nulos possíveis (forca)', () => {
    const areas = [
      { forca: 5, potencial: 1, penetracao: 0.1 },
      { forca: 1, potencial: 1, penetracao: 0.1 },
      { forca: 9, potencial: 1, penetracao: 0.1 },
    ];
    expect(limitesValores(areas, 'forca')).toEqual({ min: 1, max: 9 });
  });
});
