export const MODULOS = ['comunicacao', 'ia'] as const;
export type Modulo = (typeof MODULOS)[number];

export function isModulo(value: string): value is Modulo {
  return (MODULOS as readonly string[]).includes(value);
}
