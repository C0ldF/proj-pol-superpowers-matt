import { prepararLinha } from './preparar-linha';
import type { LinhaCsvTre, LocalPreparado } from './tipos';

export interface IngestDeps {
  upsertMunicipio(input: { codIbge: number; nome: string; uf: string }): Promise<void>;
  upsertZona(input: { municipioId: number; numero: number }): Promise<string>;
  matchBairroOficial(municipioId: number, nomeBruto: string, limiar: number): Promise<string | null>;
  criarImportacao(input: {
    municipioId: number; uf: string; ano: number; arquivoNome: string;
    arquivoSha256: string; arquivoTamanhoBytes: number; importerVersion: string;
    operador: string; totalLinhas: number;
  }): Promise<string>;
  atualizarImportacao(id: string, patch: {
    status?: string; totalPublicados?: number; totalStaging?: number; totalErros?: number; log?: unknown;
  }): Promise<void>;
  inserirLocalVotacao(input: {
    importacaoId: string; zonaId: string; bairroOficialId: string; local: LocalPreparado;
  }): Promise<void>;
  inserirStaging(input: {
    importacaoId: string; linhaOriginal: LinhaCsvTre; rowHash: string; motivos: string[];
  }): Promise<void>;
}

export interface IngerirLoteInput {
  linhas: LinhaCsvTre[];
  municipioId: number;
  municipioNome: string;
  uf: string;
  ano: number;
  arquivoNome: string;
  arquivoSha256: string;
  arquivoTamanhoBytes: number;
  operador: string;
  limiar?: number;
  importerVersion?: string;
  dryRun?: boolean;
}

export interface IngerirLoteResultado {
  importacaoId: string | null;
  totalLinhas: number;
  totalPublicados: number;
  totalStaging: number;
  totalErros: number;
}

const IMPORTER_VERSION_PADRAO = 's3.0';
const LIMIAR_PADRAO = 0.4;

// Fase "ingest" do pipeline (spec S3, decisões 2-3): parse + match + insere.
// NUNCA geocodifica, NUNCA publica — essas são as fases separadas `geocode`
// e `publicar`. Termina sempre em status='pendente_revisao'.
export async function ingerirLote(
  input: IngerirLoteInput,
  deps: IngestDeps,
): Promise<IngerirLoteResultado> {
  const limiar = input.limiar ?? LIMIAR_PADRAO;
  const importerVersion = input.importerVersion ?? IMPORTER_VERSION_PADRAO;
  const dryRun = input.dryRun ?? false;

  let totalPublicados = 0;
  let totalStaging = 0;
  let totalErros = 0;
  let importacaoId: string | null = null;

  if (!dryRun) {
    await deps.upsertMunicipio({ codIbge: input.municipioId, nome: input.municipioNome, uf: input.uf });
    importacaoId = await deps.criarImportacao({
      municipioId: input.municipioId,
      uf: input.uf,
      ano: input.ano,
      arquivoNome: input.arquivoNome,
      arquivoSha256: input.arquivoSha256,
      arquivoTamanhoBytes: input.arquivoTamanhoBytes,
      importerVersion,
      operador: input.operador,
      totalLinhas: input.linhas.length,
    });
    await deps.atualizarImportacao(importacaoId, { status: 'processando' });
  }

  for (const linhaCrua of input.linhas) {
    const preparado = prepararLinha(linhaCrua);

    // required fields ausentes/inválidos → staging, nunca chega no match de bairro
    if (preparado.numLocal <= 0 || !preparado.nome.trim()) {
      totalErros++;
      if (!dryRun && importacaoId) {
        await deps.inserirStaging({
          importacaoId,
          linhaOriginal: linhaCrua,
          rowHash: preparado.rowHash,
          motivos: ['erro_parse'],
        });
      }
      continue;
    }

    const bairroOficialId = await deps.matchBairroOficial(input.municipioId, preparado.bairroNomeOriginal, limiar);

    if (!bairroOficialId) {
      totalStaging++;
      if (!dryRun && importacaoId) {
        await deps.inserirStaging({
          importacaoId,
          linhaOriginal: linhaCrua,
          rowHash: preparado.rowHash,
          motivos: ['bairro_sem_match'],
        });
      }
      continue;
    }

    totalPublicados++;
    if (!dryRun && importacaoId) {
      const zonaId = await deps.upsertZona({ municipioId: input.municipioId, numero: preparado.zonaNumero });
      await deps.inserirLocalVotacao({ importacaoId, zonaId, bairroOficialId, local: preparado });
    }
  }

  if (!dryRun && importacaoId) {
    await deps.atualizarImportacao(importacaoId, {
      status: 'pendente_revisao',
      totalPublicados,
      totalStaging,
      totalErros,
      log: {
        warnings: [], errors: [], duration_ms: 0,
        geocode_calls: 0, geocode_failures: 0,
        staging: totalStaging, imported: totalPublicados,
      },
    });
  }

  return { importacaoId, totalLinhas: input.linhas.length, totalPublicados, totalStaging, totalErros };
}
