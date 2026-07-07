export const CARGOS = ['vereador', 'prefeito', 'deputado_estadual'] as const;
export type Cargo = (typeof CARGOS)[number];
export function isCargo(value: string): value is Cargo {
  return (CARGOS as readonly string[]).includes(value);
}

export const ABRANGENCIAS = ['municipal', 'estadual'] as const;
export type Abrangencia = (typeof ABRANGENCIAS)[number];
export function isAbrangencia(value: string): value is Abrangencia {
  return (ABRANGENCIAS as readonly string[]).includes(value);
}

export const STATUS_CAMPANHA = ['ativa', 'suspensa', 'encerrada'] as const;
export type StatusCampanha = (typeof STATUS_CAMPANHA)[number];
export function isStatusCampanha(value: string): value is StatusCampanha {
  return (STATUS_CAMPANHA as readonly string[]).includes(value);
}
