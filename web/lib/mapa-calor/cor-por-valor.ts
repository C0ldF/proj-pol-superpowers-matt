export const STEPS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700] as const;

export function indiceStep(valor: number, min: number, max: number): number {
  if (min === max) return 6; // step 400 — centro exato dos 13 steps (índice 6 de 0-12)
  const proporcao = (valor - min) / (max - min);
  const indice = Math.round(proporcao * (STEPS.length - 1));
  return Math.max(0, Math.min(STEPS.length - 1, indice)); // clamp defensivo p/ valor fora de [min, max]
}

export function corPorValor(
  valor: number | null,
  min: number,
  max: number,
  camada: 'forca' | 'potencial' | 'penetracao',
): string {
  if (valor === null) return 'var(--color-on-surface-variant)';
  const step = STEPS[indiceStep(valor, min, max)];
  return `var(--color-heatmap-${camada}-${step})`;
}

export function limitesValores(
  areas: { forca: number; potencial: number; penetracao: number | null }[],
  camada: 'forca' | 'potencial' | 'penetracao',
): { min: number; max: number } | null {
  const valores = areas.map((a) => a[camada]).filter((v): v is number => v !== null);
  if (valores.length === 0) return null;
  return { min: Math.min(...valores), max: Math.max(...valores) };
}
