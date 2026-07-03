import { prepararLinha } from './preparar-linha';
import type { LinhaCsvTre, LocalPreparado } from './tipos';

export interface StagingResumo {
  id: string;
  importacaoId: string;
  linhaOriginal: LinhaCsvTre;
  motivos: string[];
  criadoEm: string;
}

export interface RevisarDeps {
  listarPendentes(importacaoId?: string): Promise<StagingResumo[]>;
  buscarStaging(id: string): Promise<{
    importacaoId: string;
    municipioId: number;
    linhaOriginal: LinhaCsvTre;
  } | null>;
  upsertZona(input: { municipioId: number; numero: number }): Promise<string>;
  inserirLocalVotacao(input: {
    importacaoId: string; zonaId: string; bairroOficialId: string | null; local: LocalPreparado;
  }): Promise<void>;
  marcarRevisado(input: {
    id: string; resolvidoBairroOficialId: string | null; revisadoPor: string;
  }): Promise<void>;
}

export async function listarStagingPendente(
  importacaoId: string | undefined,
  deps: RevisarDeps,
): Promise<StagingResumo[]> {
  return deps.listarPendentes(importacaoId);
}

// Promove: reprocessa a linha crua salva em staging com a mesma lógica pura
// do ingest (prepararLinha) e insere em local_votacao. Os motivos de staging
// restantes (erro_parse, num_local_duplicado_mesma_zona) não dependem de um
// Superadmin escolher um bairro — bairro_oficial_id é sempre NULL, igual ao
// fluxo de ingest normal (ver ingerirLote em ingest.ts).
export async function promoverStaging(
  id: string,
  revisadoPor: string,
  deps: RevisarDeps,
): Promise<{ promovido: true }> {
  const registro = await deps.buscarStaging(id);
  if (!registro) throw new Error(`staging não encontrado: ${id}`);

  const preparado = prepararLinha(registro.linhaOriginal);
  const zonaId = await deps.upsertZona({ municipioId: registro.municipioId, numero: preparado.zonaNumero });

  await deps.inserirLocalVotacao({
    importacaoId: registro.importacaoId, zonaId, bairroOficialId: null, local: preparado,
  });
  await deps.marcarRevisado({ id, resolvidoBairroOficialId: null, revisadoPor });

  return { promovido: true };
}

export async function descartarStaging(
  id: string,
  revisadoPor: string,
  deps: RevisarDeps,
): Promise<void> {
  await deps.marcarRevisado({ id, resolvidoBairroOficialId: null, revisadoPor });
}
