# Dados de referência: relacional normalizado + PostGIS, versionado por lote

Os dados oficiais (TRE e bairros) são armazenados **relacionais normalizados, não
JSON cru** — porque são consultados/agregados intensamente (autocomplete
zona+seção→local, soma de aptos por área, mapa de calor). O CSV/JSON original fica
só como **staging** para auditoria da importação.

## TRE (camada global, fora do RLS, versionada)

- `importacao_tre` — lote = ano + município/UF + data + status (a "versão"; anos
  coexistem).
- `municipio`, `zona_eleitoral`, `local_votacao` (com lat/long, flag aproximado,
  `bairro_oficial_id` casado, `elegivel_calor`), `secao` (número + aptos,
  `SECOES` **parseado**).
- **PostGIS** habilitado; lat/long como `geometry(Point)` para agregação espacial
  e clusters rápidos.

## Bairros (dupla camada — ADR 0002)

- `bairro_oficial` — global, só Superadmin edita (do `bairros_*.json`:
  numeroBairro IBGE, nome, região, `nome_normalizado`).
- `bairro_local` — overlay por campanha (RLS), com `bairro_oficial_sugerido_id` e
  `status` (pendente/confirmado/fundido).

## Vínculos de dado

- Endereço da Pessoa → **um** bairro (FK oficial **ou** local, exatamente um).
- Pessoa ancorada no calor pela `secao` (zona+seção → secao_id → local → lat/long).
- `COD_BAIRRO` do CSV é **descartado** (ADR 0011); vínculo por nome normalizado +
  revisão.
