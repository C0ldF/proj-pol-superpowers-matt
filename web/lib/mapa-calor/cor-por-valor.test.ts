import { describe, it, expect } from 'vitest';
import { STEPS, indiceStep, corPorValor } from './cor-por-valor';

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
