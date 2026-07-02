import { normalizarTexto } from './normalizar';

export interface BairroJsonEntry {
  bairro: string;
}

export type BairrosJson = Record<string, BairroJsonEntry[]>;

export interface BairrosSeedDeps {
  upsertBairro(input: {
    municipioId: number;
    nome: string;
    nomeNormalizado: string;
    regiao: string;
  }): Promise<void>;
}

// bairros_teresina_final.json agrupa por região (chave do objeto) — vira
// bairro_oficial.regiao; upsert idempotente por (municipio_id, nome_normalizado).
export async function seedBairros(
  json: BairrosJson,
  municipioId: number,
  deps: BairrosSeedDeps,
): Promise<{ total: number }> {
  let total = 0;
  for (const [regiao, bairros] of Object.entries(json)) {
    for (const { bairro } of bairros) {
      await deps.upsertBairro({
        municipioId,
        nome: bairro,
        nomeNormalizado: normalizarTexto(bairro),
        regiao,
      });
      total++;
    }
  }
  return { total };
}
