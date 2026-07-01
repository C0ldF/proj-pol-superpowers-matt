export interface RemoverVinculoDeps {
  subarvoreCount(vinculo_id: string): Promise<number>;
  realocarSubarvore(vinculo_id: string, destino_id: string): Promise<void>;
  deletarVinculo(vinculo_id: string): Promise<void>;
}

export interface RemoverVinculoInput {
  vinculo_id: string;
  destino_id: string | null;
}

export async function removerVinculo(
  input: RemoverVinculoInput,
  deps: RemoverVinculoDeps,
): Promise<void> {
  const count = await deps.subarvoreCount(input.vinculo_id);
  if (count > 0 && input.destino_id) {
    await deps.realocarSubarvore(input.vinculo_id, input.destino_id);
  }
  await deps.deletarVinculo(input.vinculo_id);
}
