import { prepararLinha } from './preparar-linha';
import type { LinhaCsvTre, LocalPreparado } from './tipos';

export interface IngestDeps {
  upsertMunicipio(input: { codIbge: number; nome: string; uf: string }): Promise<void>;
  upsertZona(input: { municipioId: number; numero: number }): Promise<string>;
  criarImportacao(input: {
    municipioId: number; uf: string; ano: number; arquivoNome: string;
    arquivoSha256: string; arquivoTamanhoBytes: number; importerVersion: string;
    operador: string; totalLinhas: number;
  }): Promise<string>;
  atualizarImportacao(id: string, patch: {
    status?: string; totalPublicados?: number; totalStaging?: number; totalErros?: number; log?: unknown;
  }): Promise<void>;
  inserirLocalVotacao(input: {
    importacaoId: string; zonaId: string; bairroOficialId: string | null; local: LocalPreparado;
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

const IMPORTER_VERSION_PADRAO = 's3.1';

// Fase "ingest" do pipeline. NUNCA geocodifica, NUNCA publica — fases
// separadas `geocode`/`publicar`. Termina sempre em status='pendente_revisao'.
//
// Erratum (Tasks 23-25): (1) o CSV do TRE é estadual, não municipal — só
// linhas cujo COD_LOCALIDADE_IBGE bate com o município pedido entram no
// lote; as demais são descartadas silenciosamente (não contam em nenhum
// total). (2) local_votacao NÃO depende de casar bairro contra
// bairro_oficial — bairro_oficial_id é sempre NULL vindo do CSV; o match
// fuzzy (match_bairro_oficial, Task 6) continua existindo só pra
// bairro_local/reconciliação (Tasks 8-9), não pro CSV de locais de votação.
export async function ingerirLote(
  input: IngerirLoteInput,
  deps: IngestDeps,
): Promise<IngerirLoteResultado> {
  const importerVersion = input.importerVersion ?? IMPORTER_VERSION_PADRAO;
  const dryRun = input.dryRun ?? false;

  const linhasDoMunicipio = input.linhas.filter(
    (l) => l.codLocalidadeIbge === String(input.municipioId),
  );

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
      totalLinhas: linhasDoMunicipio.length,
    });
    await deps.atualizarImportacao(importacaoId, { status: 'processando' });
  }

  const vistoZonaNumLocal = new Set<string>();

  for (const linhaCrua of linhasDoMunicipio) {
    const preparado = prepararLinha(linhaCrua);

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

    const chaveZonaNumLocal = `${preparado.zonaNumero}:${preparado.numLocal}`;
    if (vistoZonaNumLocal.has(chaveZonaNumLocal)) {
      totalStaging++;
      if (!dryRun && importacaoId) {
        await deps.inserirStaging({
          importacaoId,
          linhaOriginal: linhaCrua,
          rowHash: preparado.rowHash,
          motivos: ['num_local_duplicado_mesma_zona'],
        });
      }
      continue;
    }
    vistoZonaNumLocal.add(chaveZonaNumLocal);

    totalPublicados++;
    if (!dryRun && importacaoId) {
      const zonaId = await deps.upsertZona({ municipioId: input.municipioId, numero: preparado.zonaNumero });
      await deps.inserirLocalVotacao({ importacaoId, zonaId, bairroOficialId: null, local: preparado });
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

  return { importacaoId, totalLinhas: linhasDoMunicipio.length, totalPublicados, totalStaging, totalErros };
}
