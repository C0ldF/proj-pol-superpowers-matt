import type { Modulo } from '../../lib/modulos';

export type ToggleModuloDeps = {
  chamarRpc(
    rpcName: 'habilitar_modulo' | 'desabilitar_modulo',
    args: { p_campanha_id: string; p_modulo: string },
  ): Promise<{ data: boolean | null; error: { message: string } | null }>;
};

export async function toggleModulo(
  acao: 'habilitar' | 'desabilitar',
  campanhaId: string,
  modulo: Modulo,
  deps: ToggleModuloDeps,
): Promise<void> {
  const rpcName = acao === 'habilitar' ? 'habilitar_modulo' : 'desabilitar_modulo';
  const { data, error } = await deps.chamarRpc(rpcName, { p_campanha_id: campanhaId, p_modulo: modulo });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`campanha ${campanhaId} não encontrada`);
}
