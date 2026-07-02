# S3 — Ingestão TRE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o pipeline curado de ingestão do cadastro TRE (municípios, zonas, bairros oficiais, locais de votação, seções) em tabelas globais relacionais + PostGIS, com fuzzy match de bairro, geocode assíncrono, staging de revisão e reconciliação com `bairro_local` de campanha — via scripts CLI server-side em fases explícitas (`dry-run → ingest → revisar → geocode → publicar → despublicar`).

**Architecture:** 15 migrations Postgres (0023–0037 — one extra vs. the original 14, see Task 7's RLS fix) criam extensões (`pg_trgm`, `unaccent`), 6 enums, 9 tabelas globais/overlay e 4 funções `SECURITY DEFINER`. Camada de scripts em `web/scripts/tre/` segue o padrão de injeção de dependências já usado no S2 (função pura orquestradora + `build*Deps` que injeta `adminClient()`), com um wrapper CLI fino por fase em `web/scripts/tre/cli/`.

**Tech Stack:** PostgreSQL 17 + PostGIS (Supabase cloud `axcftjqdjvknrpqzrxls`), Node.js `tsx` (CLI runner), TypeScript, Vitest 4, `csv-parse`, `iconv-lite`, `@supabase/supabase-js`, Nominatim/OSM (geocode HTTP).

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/` (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`). Scripts desta fatia não usam rotas Next, mas vivem dentro de `web/` e reusam `web/lib/supabase/server.ts`.
- Branch de trabalho: `s3-ingestao-tre` criada a partir de `main`.
- Migrations via `mcp__supabase__apply_migration` no projeto `axcftjqdjvknrpqzrxls` — uma por task; cópia idêntica salva em `supabase/migrations/`.
- `get_advisors(type=security)` obrigatório após as tasks 7 e 9 (tasks que mexem em RLS/funções `SECURITY DEFINER`).
- `adminClient()` = `web/lib/supabase/server.ts#adminClient` (service_role, ignora RLS) — toda a camada de scripts usa só esse cliente, nunca `ssrClient`.
- CSV real do TRE: `D:\projeto-pol-superpowers\4a-ad1b-420e-9d99-aa785ee2386b.csv` — **fica local, não é commitado** (arquivo de produção, 3556 linhas). Scripts recebem o caminho via flag `--csv`.
- **Encoding do CSV é `latin1`/CP1252, nunca `utf8`** — decodificar explicitamente com `iconv-lite` antes de parsear.
- `bairros_teresina_final.json`: `D:\projeto-pol-superpowers\bairros_teresina_final.json` — usado por `tre:seed-bairros`.
- Código de município de Teresina: `cod_ibge = 2211001`, `uf = 'PI'`.
- Testes rodam com `cd web && npx vitest run <caminho>`.
- Toda função `SECURITY DEFINER` desta fatia: `search_path = ''`, `REVOKE EXECUTE FROM public, authenticated, anon`, identificadores fully-qualified (`public.tabela`, `extensions.funcao`) — padrão do S2.
- Commits frequentes; mensagens em inglês, estilo do repo (`feat(s3): ...`).
- Progresso rastreado automaticamente pela skill `subagent-driven-development` (`.superpowers/sdd/progress-s3.md`).

---

## File Map

### Migrations
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0023_extensoes_tre.sql` | `pg_trgm`, `unaccent` |
| `supabase/migrations/0024_enums_tre.sql` | 6 enums desta fatia |
| `supabase/migrations/0025_municipio.sql` | Tabela `municipio` + seed de Teresina |
| `supabase/migrations/0026_zona_eleitoral.sql` | Tabela `zona_eleitoral` |
| `supabase/migrations/0027_bairro_oficial.sql` | Tabela `bairro_oficial` + índice GIN trigram |
| `supabase/migrations/0028_importacao_tre.sql` | Tabela `importacao_tre` + índice único parcial |
| `supabase/migrations/0029_local_votacao.sql` | Tabela `local_votacao` + constraints + GIST/btree |
| `supabase/migrations/0030_secao.sql` | Tabela `secao` |
| `supabase/migrations/0031_local_votacao_staging.sql` | Tabela `local_votacao_staging` + GIN |
| `supabase/migrations/0032_funcoes_match_bairro.sql` | `normalizar_texto`, `match_bairro_oficial` |
| `supabase/migrations/0033_tre_rls.sql` | RLS em 0025–0031 |
| `supabase/migrations/0034_tre_rls_publish_check_fix.sql` | **Correção descoberta na execução (Task 7):** `local_votacao_select`/`secao_select` checavam `importacao_tre.status` via `EXISTS` direto — mas `importacao_tre` é deny-all pra `authenticated`, então o `EXISTS` nunca via a linha e a política nunca liberava nada. Fix: função `importacao_esta_publicada(uuid)` `SECURITY DEFINER` (bypassa a RLS de `importacao_tre` internamente) com `GRANT EXECUTE` pra `authenticated`; `secao_select` passou a delegar pra RLS de `local_votacao` em vez de duplicar o check. |
| `supabase/migrations/0035_bairro_local.sql` | Tabela `bairro_local` + RLS |
| `supabase/migrations/0036_reconciliacao_bairro.sql` | `bairro_reconciliacao_alerta` + `detectar_reconciliacao_bairro` + `resolver_reconciliacao_bairro` + RLS |
| `supabase/migrations/0037_pessoa_secao_fk.sql` | FK `pessoa.secao_id → secao(id)` |

### Scripts — núcleo puro
| Arquivo | Responsabilidade |
|---|---|
| `web/scripts/tre/tipos.ts` | Tipos compartilhados (`LinhaCsvTre`, `LocalPreparado`, `SecaoParseada`) |
| `web/scripts/tre/normalizar.ts` | Funções puras: `normalizarTexto`, `mapTipoLocal`, `mapSituacaoLocal`, `parseSecoes`, `normalizarCep`, `hashLinha` |
| `web/scripts/tre/normalizar.test.ts` | Testes unitários |
| `web/scripts/tre/parse-csv.ts` | `parseCsvTre(buffer): LinhaCsvTre[]` — decode latin1 + `csv-parse` |
| `web/scripts/tre/parse-csv.test.ts` | Testes com fixture |
| `web/scripts/tre/preparar-linha.ts` | `prepararLinha(linha): LocalPreparado` — combina normalizar.ts |
| `web/scripts/tre/preparar-linha.test.ts` | Testes unitários |
| `web/scripts/tre/geocode.ts` | `geocodeEndereco(input, deps)` — cliente Nominatim injetável |
| `web/scripts/tre/geocode.test.ts` | Testes com fetch mockado |

### Scripts — orquestração + CLI
| Arquivo | Responsabilidade |
|---|---|
| `web/scripts/tre/bairros-seed.ts` + `build-bairros-seed-deps.ts` + `.test.ts` | Fase `seed-bairros` |
| `web/scripts/tre/ingest.ts` + `build-ingest-deps.ts` + `.test.ts` | Fase `ingest` (+ suporta `dryRun`) |
| `web/scripts/tre/revisar-staging.ts` + `build-revisar-deps.ts` + `.test.ts` | Fase `revisar` |
| `web/scripts/tre/geocode-pendentes.ts` + `build-geocode-pendentes-deps.ts` + `.test.ts` | Fase `geocode` |
| `web/scripts/tre/lote.ts` + `build-lote-deps.ts` + `.test.ts` | Fases `publicar`/`despublicar`/`stats` |
| `web/scripts/tre/cli/seed-bairros.ts` | CLI thin wrapper |
| `web/scripts/tre/cli/dry-run.ts` | CLI thin wrapper |
| `web/scripts/tre/cli/ingest.ts` | CLI thin wrapper |
| `web/scripts/tre/cli/revisar.ts` | CLI thin wrapper |
| `web/scripts/tre/cli/geocode.ts` | CLI thin wrapper |
| `web/scripts/tre/cli/publicar.ts` | CLI thin wrapper |
| `web/scripts/tre/cli/despublicar.ts` | CLI thin wrapper |
| `web/scripts/tre/cli/stats.ts` | CLI thin wrapper |

### Fixtures
| Arquivo | Responsabilidade |
|---|---|
| `web/scripts/tre/__fixtures__/tre-sample.csv` | 10 linhas cobrindo os casos de teste do spec |

---

### Task 1: Branch + extensões + enums (migrations 0023–0024)

**Files:**
- Create: `supabase/migrations/0023_extensoes_tre.sql`
- Create: `supabase/migrations/0024_enums_tre.sql`

**Interfaces:**
- Produces: extensões `pg_trgm`, `unaccent`; enums `tipo_local_enum`, `situacao_local_enum`, `status_importacao_enum`, `geo_status_enum`, `status_bairro_local_enum`, `status_reconciliacao_enum`

- [ ] **Step 1: Criar branch**

```bash
git checkout main && git pull && git checkout -b s3-ingestao-tre
```

- [ ] **Step 2: Verificar que extensões NÃO existem**

Via `mcp__supabase__execute_sql` no projeto `axcftjqdjvknrpqzrxls`:
```sql
SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm','unaccent');
```
Esperado: 0 linhas.

- [ ] **Step 3: Criar e aplicar migration 0023**

`supabase/migrations/0023_extensoes_tre.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "extensoes_tre"`).

- [ ] **Step 4: Verificar extensões existem**

```sql
SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname IN ('pg_trgm','unaccent') ORDER BY extname;
```
Esperado: 2 linhas, ambas `extnamespace = extensions`.

- [ ] **Step 5: Verificar que enums NÃO existem**

```sql
SELECT typname FROM pg_type WHERE typname IN (
  'tipo_local_enum','situacao_local_enum','status_importacao_enum',
  'geo_status_enum','status_bairro_local_enum','status_reconciliacao_enum'
);
```
Esperado: 0 linhas.

- [ ] **Step 6: Criar e aplicar migration 0024**

`supabase/migrations/0024_enums_tre.sql`:
```sql
CREATE TYPE public.tipo_local_enum AS ENUM (
  'convencional', 'transito', 'preso_provisorio', 'outro'
);

CREATE TYPE public.situacao_local_enum AS ENUM (
  'ativo', 'bloqueado'
);

CREATE TYPE public.status_importacao_enum AS ENUM (
  'pendente', 'processando', 'pendente_revisao', 'publicado', 'arquivado', 'erro'
);

CREATE TYPE public.geo_status_enum AS ENUM (
  'pendente', 'sucesso', 'falhou', 'manual', 'nao_necessario'
);

CREATE TYPE public.status_bairro_local_enum AS ENUM (
  'pendente', 'confirmado', 'fundido'
);

CREATE TYPE public.status_reconciliacao_enum AS ENUM (
  'fundido', 'mantido_separado'
);
```

Aplicar via `mcp__supabase__apply_migration` (`name: "enums_tre"`).

- [ ] **Step 7: Verificar enums existem**

```sql
SELECT typname FROM pg_type WHERE typname IN (
  'tipo_local_enum','situacao_local_enum','status_importacao_enum',
  'geo_status_enum','status_bairro_local_enum','status_reconciliacao_enum'
) ORDER BY typname;
```
Esperado: 6 linhas.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0023_extensoes_tre.sql supabase/migrations/0024_enums_tre.sql
git commit -m "feat(s3): extensions (pg_trgm, unaccent) + TRE enums (0023-0024)"
```

---

### Task 2: municipio + zona_eleitoral + bairro_oficial (migrations 0025–0027)

**Files:**
- Create: `supabase/migrations/0025_municipio.sql`
- Create: `supabase/migrations/0026_zona_eleitoral.sql`
- Create: `supabase/migrations/0027_bairro_oficial.sql`

**Interfaces:**
- Consumes: nenhum enum desta fatia (dimensões independentes)
- Produces: tabelas `municipio` (com Teresina já semeada), `zona_eleitoral`, `bairro_oficial` (com índice GIN trigram)

- [ ] **Step 1: Verificar que tabelas NÃO existem**

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('municipio','zona_eleitoral','bairro_oficial');
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0025**

`supabase/migrations/0025_municipio.sql`:
```sql
CREATE TABLE public.municipio (
  cod_ibge   integer     PRIMARY KEY,
  nome       text        NOT NULL,
  uf         char(2)     NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.municipio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.municipio FROM anon, public;

-- seed: único município usado nesta fatia (CSV real é de Teresina)
INSERT INTO public.municipio (cod_ibge, nome, uf) VALUES (2211001, 'TERESINA', 'PI');
```

Aplicar via `mcp__supabase__apply_migration` (`name: "municipio"`).

- [ ] **Step 3: Verificar tabela e seed**

```sql
SELECT cod_ibge, nome, uf FROM public.municipio;
```
Esperado: 1 linha `2211001, TERESINA, PI`.

- [ ] **Step 4: Criar e aplicar migration 0026**

`supabase/migrations/0026_zona_eleitoral.sql`:
```sql
CREATE TABLE public.zona_eleitoral (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id  integer     NOT NULL REFERENCES public.municipio(cod_ibge),
  numero        integer     NOT NULL,
  nome          text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zona_eleitoral_unica UNIQUE (municipio_id, numero)
);

CREATE INDEX zona_eleitoral_municipio_idx ON public.zona_eleitoral (municipio_id);

ALTER TABLE public.zona_eleitoral ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zona_eleitoral FROM anon, public;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "zona_eleitoral"`).

- [ ] **Step 5: Verificar tabela + constraint única**

```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'public.zona_eleitoral'::regclass AND contype = 'u';
```
Esperado: 1 linha `zona_eleitoral_unica`.

- [ ] **Step 6: Criar e aplicar migration 0027**

`supabase/migrations/0027_bairro_oficial.sql`:
```sql
CREATE TABLE public.bairro_oficial (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id      integer     NOT NULL REFERENCES public.municipio(cod_ibge),
  nome              text        NOT NULL,
  nome_normalizado  text        NOT NULL,
  regiao            text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bairro_oficial_unico UNIQUE (municipio_id, nome_normalizado)
);

CREATE INDEX bairro_oficial_trgm_idx
  ON public.bairro_oficial USING gin (nome_normalizado extensions.gin_trgm_ops);

ALTER TABLE public.bairro_oficial ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bairro_oficial FROM anon, public;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "bairro_oficial"`).

- [ ] **Step 7: Verificar índice GIN trigram existe**

```sql
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'bairro_oficial' AND indexname = 'bairro_oficial_trgm_idx';
```
Esperado: 1 linha, `indexdef` contendo `USING gin` e `gin_trgm_ops`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0025_municipio.sql supabase/migrations/0026_zona_eleitoral.sql supabase/migrations/0027_bairro_oficial.sql
git commit -m "feat(s3): municipio (seeded), zona_eleitoral, bairro_oficial with trgm index (0025-0027)"
```

---

### Task 3: importacao_tre (migration 0028)

**Files:**
- Create: `supabase/migrations/0028_importacao_tre.sql`

**Interfaces:**
- Consumes: `municipio` (Task 2), `status_importacao_enum` (Task 1)
- Produces: tabela `importacao_tre` com índice único parcial de publicação

- [ ] **Step 1: Verificar que tabela NÃO existe**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'importacao_tre' AND table_schema = 'public';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0028**

`supabase/migrations/0028_importacao_tre.sql`:
```sql
CREATE TABLE public.importacao_tre (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio_id           integer     NOT NULL REFERENCES public.municipio(cod_ibge),
  uf                     char(2)     NOT NULL,
  ano                    integer     NOT NULL,
  status                 public.status_importacao_enum NOT NULL DEFAULT 'pendente',
  arquivo_nome           text,
  arquivo_sha256         text,
  arquivo_tamanho_bytes  bigint,
  importer_version       text        NOT NULL,
  total_linhas           integer,
  total_publicados       integer,
  total_staging          integer,
  total_erros            integer,
  operador               text,
  log                    jsonb       NOT NULL DEFAULT '{}',
  iniciado_em            timestamptz NOT NULL DEFAULT now(),
  publicado_em           timestamptz
);

CREATE UNIQUE INDEX ux_importacao_publicado
  ON public.importacao_tre (municipio_id, ano)
  WHERE status = 'publicado';

CREATE INDEX importacao_tre_municipio_idx ON public.importacao_tre (municipio_id, ano);

ALTER TABLE public.importacao_tre ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.importacao_tre FROM anon, public;
-- deny-all para authenticated/anon (mesmo padrão de `campanha` no S0) — só service_role
```

Aplicar via `mcp__supabase__apply_migration` (`name: "importacao_tre"`).

- [ ] **Step 3: Verificar tabela**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_name = 'importacao_tre' AND table_schema = 'public' ORDER BY ordinal_position;
```
Esperado: 16 colunas, `importer_version` `is_nullable = 'NO'`.

- [ ] **Step 4: Verificar índice único parcial — dois lotes `publicado` no mesmo município+ano falham**

```sql
INSERT INTO public.importacao_tre (municipio_id, uf, ano, status, importer_version)
VALUES (2211001, 'PI', 2026, 'publicado', 's3.0');

INSERT INTO public.importacao_tre (municipio_id, uf, ano, status, importer_version)
VALUES (2211001, 'PI', 2026, 'publicado', 's3.0');
-- esperado: ERROR 23505 unique violation em ux_importacao_publicado
```

- [ ] **Step 5: Verificar que dois lotes `pendente` no mesmo município+ano NÃO falham**

```sql
INSERT INTO public.importacao_tre (municipio_id, uf, ano, status, importer_version)
VALUES (2211001, 'PI', 2026, 'pendente', 's3.0');
-- esperado: sucesso (índice é parcial, só cobre status='publicado')
```

- [ ] **Step 6: Limpar dados de teste**

```sql
DELETE FROM public.importacao_tre WHERE importer_version = 's3.0';
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0028_importacao_tre.sql
git commit -m "feat(s3): importacao_tre lote table with partial unique publish index (0028)"
```

---

### Task 4: local_votacao (migration 0029)

**Files:**
- Create: `supabase/migrations/0029_local_votacao.sql`

**Interfaces:**
- Consumes: `importacao_tre` (Task 3), `zona_eleitoral`, `bairro_oficial` (Task 2), `tipo_local_enum`, `situacao_local_enum`, `geo_status_enum` (Task 1), `extensions.postgis` (S0)
- Produces: tabela `local_votacao` — fato central desta fatia, consumido pelo S4

- [ ] **Step 1: Verificar que tabela NÃO existe**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'local_votacao' AND table_schema = 'public';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0029**

`supabase/migrations/0029_local_votacao.sql`:
```sql
CREATE TABLE public.local_votacao (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id          uuid        NOT NULL REFERENCES public.importacao_tre(id),
  zona_id                uuid        NOT NULL REFERENCES public.zona_eleitoral(id),
  bairro_oficial_id      uuid        NOT NULL REFERENCES public.bairro_oficial(id),
  bairro_nome_original   text        NOT NULL,
  num_local              integer     NOT NULL,
  nome                   text        NOT NULL,
  endereco               text,
  cep                    text,
  geo                    extensions.geometry(Point, 4326),
  geo_status             public.geo_status_enum NOT NULL DEFAULT 'pendente',
  tipo                   public.tipo_local_enum NOT NULL,
  situacao               public.situacao_local_enum NOT NULL,
  qtd_aptos              integer     NOT NULL DEFAULT 0,
  qtd_cancelados         integer,
  qtd_suspensos          integer,
  qtd_vagas_reservadas   integer,
  qtd_base_historica     integer,
  telefone               text,
  data_criacao_tre       timestamptz,
  elegivel_calor         boolean     NOT NULL DEFAULT false,
  avisos                 text[]      NOT NULL DEFAULT '{}',
  row_hash               text        NOT NULL,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT local_votacao_unico UNIQUE (importacao_id, num_local),
  CONSTRAINT local_votacao_aptos_check CHECK (qtd_aptos >= 0),
  CONSTRAINT local_votacao_cancelados_check CHECK (qtd_cancelados >= 0),
  CONSTRAINT local_votacao_suspensos_check CHECK (qtd_suspensos >= 0),
  CONSTRAINT local_votacao_vagas_check CHECK (qtd_vagas_reservadas >= 0),
  CONSTRAINT local_votacao_historica_check CHECK (qtd_base_historica >= 0)
);

CREATE INDEX idx_local_votacao_geo ON public.local_votacao USING gist (geo);
CREATE INDEX idx_local_votacao_bairro_oficial ON public.local_votacao (bairro_oficial_id);
CREATE INDEX idx_local_votacao_row_hash ON public.local_votacao (row_hash);
CREATE INDEX idx_local_votacao_importacao ON public.local_votacao (importacao_id);

ALTER TABLE public.local_votacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_votacao FROM anon, public;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "local_votacao"`).

**Nota:** `CHECK (qtd_cancelados >= 0)` etc. em colunas nullable passam quando o valor é `NULL` (comparação `NULL >= 0` é `UNKNOWN`, não `FALSE` — Postgres só rejeita `FALSE`). Isso é intencional: a constraint só barra valores negativos, não a ausência do dado.

- [ ] **Step 3: Verificar colunas e constraints**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_name = 'local_votacao' AND table_schema = 'public' ORDER BY ordinal_position;
```
Esperado: 24 colunas; `bairro_oficial_id` e `row_hash` com `is_nullable = 'NO'`.

```sql
SELECT conname, contype FROM pg_constraint WHERE conrelid = 'public.local_votacao'::regclass ORDER BY conname;
```
Esperado: inclui `local_votacao_unico` (u) e os 5 CHECKs.

- [ ] **Step 4: Verificar índices**

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'local_votacao' ORDER BY indexname;
```
Esperado: inclui `idx_local_votacao_geo`, `idx_local_votacao_bairro_oficial`, `idx_local_votacao_row_hash`, `idx_local_votacao_importacao`, `local_votacao_pkey`, `local_votacao_unico`.

- [ ] **Step 5: Verificar `bairro_oficial_id NOT NULL` é respeitado**

Usa o lote de teste criado na Task 3 (reaplicar um INSERT de `importacao_tre` de teste, já que o anterior foi limpo):
```sql
INSERT INTO public.importacao_tre (municipio_id, uf, ano, status, importer_version)
VALUES (2211001, 'PI', 2099, 'pendente', 's3.0-test')
RETURNING id;
-- guardar o id retornado como <importacao_teste>

INSERT INTO public.zona_eleitoral (municipio_id, numero) VALUES (2211001, 999)
RETURNING id;
-- guardar como <zona_teste>

INSERT INTO public.local_votacao (
  importacao_id, zona_id, bairro_oficial_id, bairro_nome_original,
  num_local, nome, tipo, situacao, qtd_aptos, row_hash
) VALUES (
  '<importacao_teste>', '<zona_teste>', NULL, 'Teste',
  1, 'Local Teste', 'convencional', 'ativo', 100, 'hash-teste'
);
-- esperado: ERROR null value in column "bairro_oficial_id" violates not-null constraint
```

- [ ] **Step 6: Limpar dados de teste**

```sql
DELETE FROM public.zona_eleitoral WHERE numero = 999 AND municipio_id = 2211001;
DELETE FROM public.importacao_tre WHERE importer_version IN ('s3.0-test');
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0029_local_votacao.sql
git commit -m "feat(s3): local_votacao table with PostGIS geo, geo_status, checks, indexes (0029)"
```

---

### Task 5: secao + local_votacao_staging (migrations 0030–0031)

**Files:**
- Create: `supabase/migrations/0030_secao.sql`
- Create: `supabase/migrations/0031_local_votacao_staging.sql`

**Interfaces:**
- Consumes: `local_votacao` (Task 4), `importacao_tre` (Task 3), `bairro_oficial` (Task 2)
- Produces: tabelas `secao`, `local_votacao_staging`

- [ ] **Step 1: Verificar que tabelas NÃO existem**

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name IN ('secao','local_votacao_staging');
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0030**

`supabase/migrations/0030_secao.sql`:
```sql
CREATE TABLE public.secao (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id  uuid        NOT NULL REFERENCES public.local_votacao(id) ON DELETE CASCADE,
  numero    integer     NOT NULL,
  aptos     integer     NOT NULL DEFAULT 0,
  CONSTRAINT secao_unica UNIQUE (local_id, numero),
  CONSTRAINT secao_numero_check CHECK (numero > 0),
  CONSTRAINT secao_aptos_check CHECK (aptos >= 0)
);

CREATE INDEX secao_local_idx ON public.secao (local_id);

ALTER TABLE public.secao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.secao FROM anon, public;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "secao"`).

- [ ] **Step 3: Criar e aplicar migration 0031**

`supabase/migrations/0031_local_votacao_staging.sql`:
```sql
CREATE TABLE public.local_votacao_staging (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id               uuid        NOT NULL REFERENCES public.importacao_tre(id),
  linha_original              jsonb       NOT NULL,
  row_hash                    text        NOT NULL,
  motivos                     text[]      NOT NULL,
  revisado                    boolean     NOT NULL DEFAULT false,
  resolvido_bairro_oficial_id uuid        REFERENCES public.bairro_oficial(id),
  revisado_em                 timestamptz,
  revisado_por                text,
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staging_motivos_check CHECK (cardinality(motivos) > 0)
);

CREATE INDEX idx_staging_linha_original ON public.local_votacao_staging USING gin (linha_original);
CREATE INDEX idx_staging_importacao_pendente ON public.local_votacao_staging (importacao_id) WHERE revisado = false;

ALTER TABLE public.local_votacao_staging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_votacao_staging FROM anon, public;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "local_votacao_staging"`).

- [ ] **Step 4: Verificar constraint de seção e staging**

```sql
-- numero <= 0 deve falhar (usa local_votacao já limpo — sem FK real, testa só a constraint isoladamente via savepoint impossível no MCP; testar via tabela temporária)
SELECT conname FROM pg_constraint WHERE conrelid = 'public.secao'::regclass ORDER BY conname;
```
Esperado: `secao_aptos_check`, `secao_numero_check`, `secao_unica`.

```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'public.local_votacao_staging'::regclass;
```
Esperado: inclui `staging_motivos_check`.

- [ ] **Step 5: Verificar `motivos` vazio é rejeitado**

Precisa de um `importacao_tre` válido:
```sql
INSERT INTO public.importacao_tre (municipio_id, uf, ano, status, importer_version)
VALUES (2211001, 'PI', 2098, 'pendente', 's3.0-test') RETURNING id;
-- guardar como <importacao_teste>

INSERT INTO public.local_votacao_staging (importacao_id, linha_original, row_hash, motivos)
VALUES ('<importacao_teste>', '{}'::jsonb, 'hash-x', '{}');
-- esperado: ERROR violates check constraint "staging_motivos_check"

INSERT INTO public.local_votacao_staging (importacao_id, linha_original, row_hash, motivos)
VALUES ('<importacao_teste>', '{}'::jsonb, 'hash-x', '{bairro_sem_match}');
-- esperado: sucesso
```

- [ ] **Step 6: Limpar dados de teste**

```sql
DELETE FROM public.local_votacao_staging WHERE importacao_id = '<importacao_teste>';
DELETE FROM public.importacao_tre WHERE importer_version = 's3.0-test';
```

- [ ] **Step 7: Verificar índice GIN em `linha_original`**

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'local_votacao_staging' AND indexname = 'idx_staging_linha_original';
```
Esperado: 1 linha.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0030_secao.sql supabase/migrations/0031_local_votacao_staging.sql
git commit -m "feat(s3): secao table + local_votacao_staging with motivos array and GIN index (0030-0031)"
```

---

### Task 6: Funções de match de bairro (migration 0032)

**Files:**
- Create: `supabase/migrations/0032_funcoes_match_bairro.sql`

**Interfaces:**
- Consumes: `bairro_oficial` (Task 2), `extensions.unaccent`/`extensions.similarity` (Task 1)
- Produces: `normalizar_texto(text) → text`, `match_bairro_oficial(integer, text, numeric DEFAULT 0.4) → uuid`

- [ ] **Step 1: Verificar que funções NÃO existem**

```sql
SELECT proname FROM pg_proc WHERE proname IN ('normalizar_texto','match_bairro_oficial');
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0032**

`supabase/migrations/0032_funcoes_match_bairro.sql`:
```sql
CREATE OR REPLACE FUNCTION public.normalizar_texto(txt text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT lower(trim(extensions.unaccent(coalesce(txt, ''))));
$$;
REVOKE ALL ON FUNCTION public.normalizar_texto(text) FROM public, authenticated, anon;

CREATE OR REPLACE FUNCTION public.match_bairro_oficial(
  p_municipio_id integer,
  p_nome_bruto   text,
  p_limiar       numeric DEFAULT 0.4
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT id FROM public.bairro_oficial
   WHERE municipio_id = p_municipio_id
     AND extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) >= p_limiar
   ORDER BY extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.match_bairro_oficial(integer, text, numeric) FROM public, authenticated, anon;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "funcoes_match_bairro"`).

- [ ] **Step 3: Seed de bairros mínimo para teste (Aeroporto, Centro)**

```sql
INSERT INTO public.bairro_oficial (municipio_id, nome, nome_normalizado, regiao)
VALUES
  (2211001, 'Aeroporto', public.normalizar_texto('Aeroporto'), 'zona_norte'),
  (2211001, 'Centro', public.normalizar_texto('Centro'), 'regiao_central')
ON CONFLICT (municipio_id, nome_normalizado) DO NOTHING;
```

- [ ] **Step 4: Verificar `normalizar_texto`**

```sql
SELECT public.normalizar_texto('  Água Mineral  ');
```
Esperado: `'agua mineral'`.

- [ ] **Step 5: Verificar `match_bairro_oficial` — match exato e por variação**

```sql
SELECT id FROM public.match_bairro_oficial(2211001, 'AEROPORTO');
-- esperado: 1 linha (o id do bairro Aeroporto)

SELECT id FROM public.match_bairro_oficial(2211001, 'aeroporto ');
-- esperado: mesmo id (case + espaço não afetam)

SELECT public.match_bairro_oficial(2211001, 'Zzzzznadaaver');
-- esperado: NULL (sem relação)
```

- [ ] **Step 6: Verificar limiar parametrizável**

```sql
SELECT public.match_bairro_oficial(2211001, 'Aeroport', 0.9);
-- esperado: NULL (score < 0.9 para essa string quase-igual)
SELECT public.match_bairro_oficial(2211001, 'Aeroport', 0.3);
-- esperado: id do Aeroporto (score >= 0.3)
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0032_funcoes_match_bairro.sql
git commit -m "feat(s3): normalizar_texto + match_bairro_oficial with configurable threshold (0032)"
```

---

### Task 7: RLS das tabelas globais (migration 0033)

**Files:**
- Create: `supabase/migrations/0033_tre_rls.sql`

**Interfaces:**
- Consumes: `municipio`, `zona_eleitoral`, `bairro_oficial`, `importacao_tre`, `local_votacao`, `secao` (Tasks 2–5)
- Produces: policies de SELECT — dimensões livres para `authenticated`; `local_votacao`/`secao` só se o lote está `publicado`; `importacao_tre`/`local_votacao_staging` seguem deny-all (sem policy nova)

- [ ] **Step 1: Criar e aplicar migration 0033**

`supabase/migrations/0033_tre_rls.sql`:
```sql
CREATE POLICY "municipio_select" ON public.municipio
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "zona_eleitoral_select" ON public.zona_eleitoral
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bairro_oficial_select" ON public.bairro_oficial
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "local_votacao_select" ON public.local_votacao
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.importacao_tre i
       WHERE i.id = local_votacao.importacao_id AND i.status = 'publicado'
    )
  );

CREATE POLICY "secao_select" ON public.secao
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.local_votacao l
       JOIN public.importacao_tre i ON i.id = l.importacao_id
       WHERE l.id = secao.local_id AND i.status = 'publicado'
    )
  );
```

Aplicar via `mcp__supabase__apply_migration` (`name: "tre_rls"`).

- [ ] **Step 2: Verificar policies criadas**

```sql
SELECT tablename, policyname, cmd FROM pg_policies
 WHERE tablename IN ('municipio','zona_eleitoral','bairro_oficial','local_votacao','secao')
 ORDER BY tablename, policyname;
```
Esperado: 5 policies, uma por tabela, todas `cmd = SELECT`. `importacao_tre` e `local_votacao_staging` continuam sem nenhuma linha (deny-all).

- [ ] **Step 3: Montar cenário de teste — lote não publicado x publicado**

```sql
INSERT INTO public.importacao_tre (municipio_id, uf, ano, status, importer_version)
VALUES (2211001, 'PI', 2097, 'pendente_revisao', 's3.0-test') RETURNING id;
-- guardar como <lote_teste>

INSERT INTO public.zona_eleitoral (municipio_id, numero) VALUES (2211001, 998) RETURNING id;
-- guardar como <zona_teste>

INSERT INTO public.bairro_oficial (municipio_id, nome, nome_normalizado)
VALUES (2211001, 'BairroTeste', 'bairroteste')
ON CONFLICT (municipio_id, nome_normalizado) DO NOTHING;
SELECT id FROM public.bairro_oficial WHERE nome_normalizado = 'bairroteste';
-- guardar como <bairro_teste>

INSERT INTO public.local_votacao (
  importacao_id, zona_id, bairro_oficial_id, bairro_nome_original,
  num_local, nome, tipo, situacao, qtd_aptos, row_hash
) VALUES (
  '<lote_teste>', '<zona_teste>', '<bairro_teste>', 'BairroTeste',
  9001, 'Local RLS Teste', 'convencional', 'ativo', 50, 'hash-rls-teste'
) RETURNING id;
-- guardar como <local_teste>
```

- [ ] **Step 4: Verificar RLS bloqueia lote não publicado**

```sql
SET LOCAL request.jwt.claims = '{"app_metadata":{"campanha_id":"00000000-0000-0000-0000-000000000000","papel":"gestor"}}';
SET LOCAL ROLE authenticated;
SELECT id FROM public.local_votacao WHERE id = '<local_teste>';
-- esperado: 0 linhas (lote está pendente_revisao, não publicado)
RESET ROLE;
```

- [ ] **Step 5: Publicar o lote e verificar RLS libera**

```sql
UPDATE public.importacao_tre SET status = 'publicado' WHERE id = '<lote_teste>';

SET LOCAL request.jwt.claims = '{"app_metadata":{"campanha_id":"00000000-0000-0000-0000-000000000000","papel":"gestor"}}';
SET LOCAL ROLE authenticated;
SELECT id FROM public.local_votacao WHERE id = '<local_teste>';
-- esperado: 1 linha
RESET ROLE;
```

- [ ] **Step 6: Verificar `importacao_tre` continua invisível para `authenticated`**

```sql
SET LOCAL ROLE authenticated;
SELECT id FROM public.importacao_tre WHERE id = '<lote_teste>';
-- esperado: 0 linhas (deny-all, sem policy)
RESET ROLE;
```

- [ ] **Step 7: Limpar dados de teste**

```sql
DELETE FROM public.local_votacao WHERE id = '<local_teste>';
DELETE FROM public.zona_eleitoral WHERE numero = 998 AND municipio_id = 2211001;
DELETE FROM public.bairro_oficial WHERE nome_normalizado = 'bairroteste';
DELETE FROM public.importacao_tre WHERE importer_version = 's3.0-test';
```

- [ ] **Step 8: Rodar `get_advisors(security)` — sem novos alertas**

Via MCP `mcp__supabase__get_advisors` com `{ "type": "security" }`. Comparar com o baseline anterior (fim do S2); registrar resultado no relatório da task.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0033_tre_rls.sql
git commit -m "feat(s3): RLS on TRE reference tables — global read, publish-gated local_votacao/secao (0033)"
```

- [ ] **Step 10 (descoberto durante a execução): corrigir `local_votacao_select`/`secao_select` — o `EXISTS` direto em `importacao_tre` nunca é satisfeito**

Verificação live (INSERT de um lote `publicado` de teste + `SET LOCAL ROLE authenticated` + SELECT) mostrou 0 linhas mesmo com o lote publicado. Causa: `importacao_tre` é deny-all pra `authenticated` (Task 3) — o `EXISTS (SELECT 1 FROM public.importacao_tre ...)` dentro da policy de `local_votacao` roda com o mesmo papel da query externa, então a RLS de `importacao_tre` bloqueia a subquery antes mesmo do `WHERE status = 'publicado'` ser avaliado. A policy nunca liberava nada, publicado ou não.

`supabase/migrations/0034_tre_rls_publish_check_fix.sql`:
```sql
CREATE OR REPLACE FUNCTION public.importacao_esta_publicada(p_importacao_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.importacao_tre
     WHERE id = p_importacao_id AND status = 'publicado'
  );
$$;
REVOKE ALL ON FUNCTION public.importacao_esta_publicada(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.importacao_esta_publicada(uuid) TO authenticated;

DROP POLICY "local_votacao_select" ON public.local_votacao;
CREATE POLICY "local_votacao_select" ON public.local_votacao
  FOR SELECT TO authenticated
  USING (public.importacao_esta_publicada(importacao_id));

DROP POLICY "secao_select" ON public.secao;
CREATE POLICY "secao_select" ON public.secao
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.local_votacao l WHERE l.id = secao.local_id)
  );
```

`importacao_esta_publicada` é `SECURITY DEFINER` — roda com privilégio elevado internamente, então consegue ler `importacao_tre` mesmo com a RLS dessa tabela bloqueando `authenticated`; `GRANT EXECUTE ... TO authenticated` é necessário (diferente das funções de match, que revogam de `authenticated`) porque é `authenticated` quem avalia a policy. `secao_select` passou a delegar pra RLS de `local_votacao` (que já é publish-gated) em vez de duplicar o `EXISTS` — mais simples e sem o mesmo bug.

Reverificado ao vivo: lote `pendente_revisao` → `local_votacao`/`secao` = 0 linhas pra `authenticated`; lote `publicado` → 1/1; `importacao_tre` continua 0 (deny-all intacto). `get_advisors(security)`: um novo WARN esperado — `importacao_esta_publicada` é uma `SECURITY DEFINER` function chamável por `authenticated` via RPC; intencional (só retorna um boolean de status de publicação, sem dado sensível) e necessário pro fix funcionar.

```bash
git add supabase/migrations/0034_tre_rls_publish_check_fix.sql
git commit -m "fix(s3): local_votacao/secao RLS never allowed access — importacao_esta_publicada() bypasses importacao_tre's deny-all (0034)"
```

---

### Task 8: bairro_local — overlay de campanha (migration 0035)

**Files:**
- Create: `supabase/migrations/0035_bairro_local.sql`

**Interfaces:**
- Consumes: `campanha` (S0), `bairro_oficial` (Task 2), `status_bairro_local_enum` (Task 1)
- Produces: tabela `bairro_local` com RLS por `campanha_id`

- [ ] **Step 1: Verificar que tabela NÃO existe**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'bairro_local' AND table_schema = 'public';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0035**

`supabase/migrations/0035_bairro_local.sql`:
```sql
CREATE TABLE public.bairro_local (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id                 uuid        NOT NULL REFERENCES public.campanha(id),
  nome                        text        NOT NULL,
  nome_normalizado            text        NOT NULL,
  bairro_oficial_sugerido_id  uuid        REFERENCES public.bairro_oficial(id),
  status                      public.status_bairro_local_enum NOT NULL DEFAULT 'pendente',
  criado_por                  uuid        REFERENCES auth.users(id),
  criado_em                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bairro_local_unico UNIQUE (campanha_id, nome_normalizado)
);

CREATE INDEX bairro_local_campanha_idx ON public.bairro_local (campanha_id);

ALTER TABLE public.bairro_local ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bairro_local FROM anon, public;

CREATE POLICY "bairro_local_select" ON public.bairro_local
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

CREATE POLICY "bairro_local_insert" ON public.bairro_local
  FOR INSERT TO authenticated
  WITH CHECK (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

CREATE POLICY "bairro_local_update" ON public.bairro_local
  FOR UPDATE TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );
```

Aplicar via `mcp__supabase__apply_migration` (`name: "bairro_local"`).

- [ ] **Step 3: Buscar duas campanhas de teste existentes (seed do S0)**

```sql
SELECT id, nome FROM public.campanha ORDER BY criado_em LIMIT 2;
-- guardar como <campanha_a> e <campanha_b>
```

- [ ] **Step 4: Verificar isolamento entre campanhas**

```sql
SET LOCAL request.jwt.claims = jsonb_build_object('app_metadata', jsonb_build_object('campanha_id', '<campanha_a>', 'papel', 'gestor'))::text;
SET LOCAL ROLE authenticated;
INSERT INTO public.bairro_local (campanha_id, nome, nome_normalizado)
VALUES ('<campanha_a>', 'Bairro da Campanha A', 'bairro da campanha a');
RESET ROLE;

SET LOCAL request.jwt.claims = jsonb_build_object('app_metadata', jsonb_build_object('campanha_id', '<campanha_b>', 'papel', 'gestor'))::text;
SET LOCAL ROLE authenticated;
SELECT id FROM public.bairro_local WHERE nome_normalizado = 'bairro da campanha a';
-- esperado: 0 linhas (campanha B não vê bairro_local de campanha A)
RESET ROLE;
```

- [ ] **Step 5: Limpar dados de teste**

```sql
DELETE FROM public.bairro_local WHERE nome_normalizado = 'bairro da campanha a';
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0035_bairro_local.sql
git commit -m "feat(s3): bairro_local campaign overlay table with tenant RLS (0035)"
```

---

### Task 9: Reconciliação de bairro (migration 0036)

**Files:**
- Create: `supabase/migrations/0036_reconciliacao_bairro.sql`

**Interfaces:**
- Consumes: `bairro_local` (Task 8), `bairro_oficial` (Task 2), `importacao_tre` (Task 3), `status_reconciliacao_enum` (Task 1)
- Produces: tabela `bairro_reconciliacao_alerta`, funções `detectar_reconciliacao_bairro(uuid) → integer`, `resolver_reconciliacao_bairro(uuid, status_reconciliacao_enum, text) → void`

- [ ] **Step 1: Criar e aplicar migration 0036**

`supabase/migrations/0036_reconciliacao_bairro.sql`:
```sql
CREATE TABLE public.bairro_reconciliacao_alerta (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id        uuid        NOT NULL REFERENCES public.campanha(id),
  bairro_local_id    uuid        NOT NULL REFERENCES public.bairro_local(id),
  bairro_oficial_id  uuid        NOT NULL REFERENCES public.bairro_oficial(id),
  similaridade       numeric,
  resolvido          boolean     NOT NULL DEFAULT false,
  resolucao          public.status_reconciliacao_enum,
  resolvido_por      text,
  resolvido_em       timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bairro_reconciliacao_campanha_idx ON public.bairro_reconciliacao_alerta (campanha_id);

ALTER TABLE public.bairro_reconciliacao_alerta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bairro_reconciliacao_alerta FROM anon, public;

CREATE POLICY "bairro_reconciliacao_alerta_select" ON public.bairro_reconciliacao_alerta
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'papel'
    ) = 'gestor'
  );
-- INSERT/UPDATE só via funções SECURITY DEFINER abaixo (sem grant para authenticated)

CREATE OR REPLACE FUNCTION public.detectar_reconciliacao_bairro(p_importacao_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_municipio_id integer;
  v_count        integer := 0;
  rec            record;
BEGIN
  SELECT municipio_id INTO v_municipio_id FROM public.importacao_tre WHERE id = p_importacao_id;
  IF v_municipio_id IS NULL THEN RETURN 0; END IF;

  FOR rec IN
    SELECT bl.id AS bairro_local_id, bl.campanha_id, bo.id AS bairro_oficial_id,
           extensions.similarity(bl.nome_normalizado, bo.nome_normalizado) AS sim
      FROM public.bairro_local bl
      JOIN public.bairro_oficial bo ON bo.municipio_id = v_municipio_id
     WHERE bl.status != 'fundido'
       AND extensions.similarity(bl.nome_normalizado, bo.nome_normalizado) >= 0.4
       AND NOT EXISTS (
             SELECT 1 FROM public.bairro_reconciliacao_alerta a
              WHERE a.bairro_local_id = bl.id
                AND a.bairro_oficial_id = bo.id
                AND a.resolvido = false
           )
  LOOP
    INSERT INTO public.bairro_reconciliacao_alerta (
      campanha_id, bairro_local_id, bairro_oficial_id, similaridade
    ) VALUES (rec.campanha_id, rec.bairro_local_id, rec.bairro_oficial_id, rec.sim);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.detectar_reconciliacao_bairro(uuid) FROM public, authenticated, anon;

CREATE OR REPLACE FUNCTION public.resolver_reconciliacao_bairro(
  p_alerta_id uuid,
  p_resolucao public.status_reconciliacao_enum,
  p_operador  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.bairro_reconciliacao_alerta WHERE id = p_alerta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'alerta não encontrado: %', p_alerta_id; END IF;

  IF p_resolucao = 'fundido' THEN
    UPDATE public.bairro_local SET status = 'fundido' WHERE id = v.bairro_local_id;
  END IF;

  UPDATE public.bairro_reconciliacao_alerta
     SET resolvido = true, resolucao = p_resolucao, resolvido_por = p_operador, resolvido_em = now()
   WHERE id = p_alerta_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolver_reconciliacao_bairro(uuid, public.status_reconciliacao_enum, text) FROM public, authenticated, anon;
```

Aplicar via `mcp__supabase__apply_migration` (`name: "reconciliacao_bairro"`).

- [ ] **Step 2: Verificar tabela e funções existem**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'bairro_reconciliacao_alerta';
SELECT proname FROM pg_proc WHERE proname IN ('detectar_reconciliacao_bairro','resolver_reconciliacao_bairro') ORDER BY proname;
```
Esperado: 1 linha; 2 linhas.

- [ ] **Step 3: Montar cenário — bairro_local parecido com bairro_oficial existente**

```sql
SELECT id FROM public.campanha ORDER BY criado_em LIMIT 1;
-- guardar como <campanha_teste>

INSERT INTO public.bairro_local (campanha_id, nome, nome_normalizado)
VALUES ('<campanha_teste>', 'Aeroport', public.normalizar_texto('Aeroport'))
RETURNING id;
-- guardar como <bairro_local_teste> — 'Aeroport' é similar ao 'Aeroporto' semeado na Task 6

INSERT INTO public.importacao_tre (municipio_id, uf, ano, status, importer_version)
VALUES (2211001, 'PI', 2096, 'publicado', 's3.0-test')
RETURNING id;
-- guardar como <importacao_teste>
```

- [ ] **Step 4: Verificar `detectar_reconciliacao_bairro` gera alerta**

```sql
SELECT public.detectar_reconciliacao_bairro('<importacao_teste>');
-- esperado: >= 1

SELECT bairro_local_id, resolvido FROM public.bairro_reconciliacao_alerta
 WHERE bairro_local_id = '<bairro_local_teste>';
-- esperado: 1 linha, resolvido = false
```

- [ ] **Step 5: Verificar `detectar_reconciliacao_bairro` não duplica alerta já pendente**

```sql
SELECT public.detectar_reconciliacao_bairro('<importacao_teste>');
SELECT count(*) FROM public.bairro_reconciliacao_alerta WHERE bairro_local_id = '<bairro_local_teste>';
-- esperado: ainda 1 (não duplicou)
```

- [ ] **Step 6: Verificar `resolver_reconciliacao_bairro('fundido')`**

```sql
SELECT id FROM public.bairro_reconciliacao_alerta WHERE bairro_local_id = '<bairro_local_teste>';
-- guardar como <alerta_teste>

SELECT public.resolver_reconciliacao_bairro('<alerta_teste>', 'fundido', 'teste-operador');

SELECT status FROM public.bairro_local WHERE id = '<bairro_local_teste>';
-- esperado: 'fundido'

SELECT resolvido, resolucao, resolvido_por FROM public.bairro_reconciliacao_alerta WHERE id = '<alerta_teste>';
-- esperado: true, 'fundido', 'teste-operador'
```

- [ ] **Step 7: Limpar dados de teste**

```sql
DELETE FROM public.bairro_reconciliacao_alerta WHERE bairro_local_id = '<bairro_local_teste>';
DELETE FROM public.bairro_local WHERE id = '<bairro_local_teste>';
DELETE FROM public.importacao_tre WHERE importer_version = 's3.0-test';
```

- [ ] **Step 8: Rodar `get_advisors(security)` — sem novos alertas**

Via MCP. Registrar resultado no relatório da task.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0036_reconciliacao_bairro.sql
git commit -m "feat(s3): bairro reconciliation alert table + detect/resolve functions (0036)"
```

---

### Task 10: FK real `pessoa.secao_id` (migration 0037)

**Files:**
- Create: `supabase/migrations/0037_pessoa_secao_fk.sql`

**Interfaces:**
- Consumes: `secao` (Task 5), `pessoa.secao_id` (coluna solta desde S2, migration 0014)
- Produces: constraint `pessoa_secao_id_fkey`

- [ ] **Step 1: Verificar que a FK NÃO existe**

```sql
SELECT conname FROM pg_constraint WHERE conname = 'pessoa_secao_id_fkey';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0037**

`supabase/migrations/0037_pessoa_secao_fk.sql`:
```sql
ALTER TABLE public.pessoa
  ADD CONSTRAINT pessoa_secao_id_fkey FOREIGN KEY (secao_id) REFERENCES public.secao(id);
```

Aplicar via `mcp__supabase__apply_migration` (`name: "pessoa_secao_fk"`).

- [ ] **Step 3: Verificar FK existe**

```sql
SELECT conname, confrelid::regclass FROM pg_constraint WHERE conname = 'pessoa_secao_id_fkey';
```
Esperado: 1 linha, `confrelid = 'public.secao'`.

- [ ] **Step 4: Verificar FK rejeita `secao_id` inexistente**

```sql
SELECT id FROM public.campanha ORDER BY criado_em LIMIT 1;
-- guardar como <campanha_teste>

INSERT INTO public.pessoa (campanha_id, nome, secao_id)
VALUES ('<campanha_teste>', 'Teste FK Secao', '00000000-0000-0000-0000-000000000000');
-- esperado: ERROR insert or update on table "pessoa" violates foreign key constraint "pessoa_secao_id_fkey"
```

- [ ] **Step 5: Verificar `secao_id = NULL` continua permitido**

```sql
INSERT INTO public.pessoa (campanha_id, nome, secao_id)
VALUES ('<campanha_teste>', 'Teste FK Secao Null', NULL)
RETURNING id;
-- esperado: sucesso
```

- [ ] **Step 6: Limpar dado de teste**

```sql
DELETE FROM public.pessoa WHERE nome = 'Teste FK Secao Null';
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0037_pessoa_secao_fk.sql
git commit -m "feat(s3): pessoa.secao_id gets real FK to secao(id), closing S2 gap (0037)"
```

---

**Fim da camada de banco.** As tasks seguintes constroem a camada de scripts em `web/scripts/tre/` que usa esse schema via `adminClient()`.

---

### Task 11: Setup de dependências + tipos compartilhados + `normalizar.ts`

**Files:**
- Modify: `web/package.json`
- Create: `web/scripts/tre/tipos.ts`
- Create: `web/scripts/tre/normalizar.ts`
- Create: `web/scripts/tre/normalizar.test.ts`

**Interfaces:**
- Produces:
  - Tipos: `LinhaCsvTre`, `TipoLocal`, `SituacaoLocal`, `GeoStatus`, `SecaoParseada`, `LocalPreparado`
  - `normalizarTexto(txt: string): string`
  - `mapTipoLocal(raw: string): TipoLocal`
  - `mapSituacaoLocal(raw: string): SituacaoLocal`
  - `parseSecoes(raw: string): { secoes: SecaoParseada[]; avisos: string[] }`
  - `normalizarCep(raw: string): { cep: string | null; avisoInvalido: boolean }`
  - `hashLinha(linha: Record<string, string>): string`

- [ ] **Step 1: Instalar dependências**

```bash
cd web && npm install csv-parse iconv-lite && npm install -D tsx
```

- [ ] **Step 2: Adicionar scripts ao `package.json`**

Editar `web/package.json`, bloco `"scripts"` — adicionar (mantendo os existentes):
```json
"tre:seed-bairros": "tsx scripts/tre/cli/seed-bairros.ts",
"tre:dry-run": "tsx scripts/tre/cli/dry-run.ts",
"tre:ingest": "tsx scripts/tre/cli/ingest.ts",
"tre:revisar": "tsx scripts/tre/cli/revisar.ts",
"tre:geocode": "tsx scripts/tre/cli/geocode.ts",
"tre:publicar": "tsx scripts/tre/cli/publicar.ts",
"tre:despublicar": "tsx scripts/tre/cli/despublicar.ts",
"tre:stats": "tsx scripts/tre/cli/stats.ts"
```

- [ ] **Step 3: Criar tipos compartilhados**

`web/scripts/tre/tipos.ts`:
```typescript
export interface LinhaCsvTre {
  uf: string;
  localidade: string;
  codLocalidadeIbge: string;
  zona: string;
  tipoLocalVotacao: string;
  situacaoLocalVotacao: string;
  numLocal: string;
  dataCriacao: string;
  localVotacao: string;
  telefone: string;
  endereco: string;
  bairro: string;
  cep: string;
  latitude: string;
  longitude: string;
  secoes: string;
  qtdAptos: string;
  qtdCancelados: string;
  qtdSuspensos: string;
  qtdVagasReservadas: string;
  qtdBaseHistorica: string;
}

export type TipoLocal = 'convencional' | 'transito' | 'preso_provisorio' | 'outro';
export type SituacaoLocal = 'ativo' | 'bloqueado';
export type GeoStatus = 'pendente' | 'sucesso' | 'falhou' | 'manual' | 'nao_necessario';

export interface SecaoParseada {
  numero: number;
  aptos: number;
}

export interface LocalPreparado {
  zonaNumero: number;
  bairroNomeOriginal: string;
  numLocal: number;
  nome: string;
  endereco: string | null;
  cep: string | null;
  tipo: TipoLocal;
  situacao: SituacaoLocal;
  qtdAptos: number;
  qtdCancelados: number | null;
  qtdSuspensos: number | null;
  qtdVagasReservadas: number | null;
  qtdBaseHistorica: number | null;
  telefone: string | null;
  dataCriacaoTre: string | null;
  latitude: number | null;
  longitude: number | null;
  geoStatus: GeoStatus;
  elegivelCalor: boolean;
  avisos: string[];
  rowHash: string;
  secoes: SecaoParseada[];
  linhaOriginal: LinhaCsvTre;
}
```

- [ ] **Step 4: Escrever testes de `normalizar.ts`**

`web/scripts/tre/normalizar.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  normalizarTexto, mapTipoLocal, mapSituacaoLocal, parseSecoes, normalizarCep, hashLinha,
} from './normalizar';

describe('normalizarTexto', () => {
  it('remove acentos, baixa caixa e trima', () => {
    expect(normalizarTexto('  Água Mineral  ')).toBe('agua mineral');
  });
  it('string vazia retorna vazia', () => {
    expect(normalizarTexto('')).toBe('');
  });
});

describe('mapTipoLocal', () => {
  it('CONVENCIONAL mapeia para convencional', () => {
    expect(mapTipoLocal('CONVENCIONAL')).toBe('convencional');
  });
  it('VOTO EM TRÂNSITO mapeia para transito', () => {
    expect(mapTipoLocal('VOTO EM TRÂNSITO')).toBe('transito');
  });
  it('PRESO PROVISÓRIO mapeia para preso_provisorio', () => {
    expect(mapTipoLocal('PRESO PROVISÓRIO')).toBe('preso_provisorio');
  });
  it('valor desconhecido mapeia para outro', () => {
    expect(mapTipoLocal('ESPECIAL')).toBe('outro');
  });
});

describe('mapSituacaoLocal', () => {
  it('ATIVO mapeia para ativo', () => {
    expect(mapSituacaoLocal('ATIVO')).toBe('ativo');
  });
  it('qualquer outro mapeia para bloqueado', () => {
    expect(mapSituacaoLocal('BLOQUEADO')).toBe('bloqueado');
    expect(mapSituacaoLocal('')).toBe('bloqueado');
  });
});

describe('parseSecoes', () => {
  it('parseia múltiplas seções', () => {
    const r = parseSecoes('(s: 185, apt: 253), (s: 186, apt: 258)');
    expect(r.secoes).toEqual([{ numero: 185, aptos: 253 }, { numero: 186, aptos: 258 }]);
    expect(r.avisos).toEqual([]);
  });
  it('string vazia retorna lista vazia sem aviso', () => {
    expect(parseSecoes('')).toEqual({ secoes: [], avisos: [] });
  });
  it('grupo malformado gera aviso e é ignorado', () => {
    const r = parseSecoes('(s: , apt: 10), (s: 20, apt: 5)');
    expect(r.secoes).toEqual([{ numero: 20, aptos: 5 }]);
    expect(r.avisos).toContain('secao_malformada');
  });
  it('seção duplicada mantém a primeira e avisa', () => {
    const r = parseSecoes('(s: 10, apt: 1), (s: 10, apt: 2)');
    expect(r.secoes).toEqual([{ numero: 10, aptos: 1 }]);
    expect(r.avisos).toContain('secao_duplicada');
  });
});

describe('normalizarCep', () => {
  it('remove não-dígitos', () => {
    expect(normalizarCep('64002-510')).toEqual({ cep: '64002510', avisoInvalido: false });
  });
  it('CEP com menos de 8 dígitos gera aviso', () => {
    expect(normalizarCep('6400251')).toEqual({ cep: '6400251', avisoInvalido: true });
  });
  it('vazio retorna null sem aviso', () => {
    expect(normalizarCep('')).toEqual({ cep: null, avisoInvalido: false });
  });
});

describe('hashLinha', () => {
  it('mesma linha (ordem de chaves diferente) produz mesmo hash', () => {
    expect(hashLinha({ a: '1', b: '2' })).toBe(hashLinha({ b: '2', a: '1' }));
  });
  it('linha diferente produz hash diferente', () => {
    expect(hashLinha({ a: '1' })).not.toBe(hashLinha({ a: '2' }));
  });
});
```

- [ ] **Step 5: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/normalizar.test.ts
```
Esperado: falha com "Cannot find module './normalizar'".

- [ ] **Step 6: Implementar `normalizar.ts`**

`web/scripts/tre/normalizar.ts`:
```typescript
import { createHash } from 'node:crypto';
import type { SecaoParseada, TipoLocal, SituacaoLocal } from './tipos';

const MAPA_ACENTOS: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
};

// Espelha public.normalizar_texto (SQL, extensions.unaccent) para uso local
// (dry-run, hashing) — o match oficial sempre roda no Postgres via RPC.
export function normalizarTexto(txt: string): string {
  const semAcento = (txt ?? '')
    .toLowerCase()
    .split('')
    .map((c) => MAPA_ACENTOS[c] ?? c)
    .join('');
  return semAcento.trim().replace(/\s+/g, ' ');
}

export function mapTipoLocal(raw: string): TipoLocal {
  const t = normalizarTexto(raw);
  if (t.includes('transito')) return 'transito';
  if (t.includes('preso') || t.includes('presidio')) return 'preso_provisorio';
  if (t === 'convencional') return 'convencional';
  return 'outro';
}

export function mapSituacaoLocal(raw: string): SituacaoLocal {
  return normalizarTexto(raw) === 'ativo' ? 'ativo' : 'bloqueado';
}

// Tolerante de propósito — o formato do CSV do TRE muda entre ciclos eleitorais.
// Ignora espaços extras, grupos malformados (s:/apt: vazio) e seções duplicadas,
// registrando um aviso em vez de lançar exceção.
export function parseSecoes(raw: string): { secoes: SecaoParseada[]; avisos: string[] } {
  const avisos: string[] = [];
  if (!raw || !raw.trim()) return { secoes: [], avisos };

  const regex = /\(\s*s:\s*(\d*)\s*,\s*apt:\s*(\d*)\s*\)/gi;
  const vistos = new Set<number>();
  const secoes: SecaoParseada[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    const [, numeroStr, aptosStr] = match;
    if (!numeroStr || !aptosStr) {
      avisos.push('secao_malformada');
      continue;
    }
    const numero = parseInt(numeroStr, 10);
    const aptos = parseInt(aptosStr, 10);
    if (vistos.has(numero)) {
      avisos.push('secao_duplicada');
      continue;
    }
    vistos.add(numero);
    secoes.push({ numero, aptos });
  }

  return { secoes, avisos };
}

export function normalizarCep(raw: string): { cep: string | null; avisoInvalido: boolean } {
  const digitos = (raw ?? '').replace(/\D/g, '');
  if (!digitos) return { cep: null, avisoInvalido: false };
  return { cep: digitos, avisoInvalido: digitos.length !== 8 };
}

// SHA-256 da linha crua do CSV (chaves ordenadas) — usado para diff/auditoria
// entre reimportações, não para dedup automático.
export function hashLinha(linha: Record<string, string>): string {
  const chaves = Object.keys(linha).sort();
  const canonico = chaves.map((k) => `${k}=${linha[k] ?? ''}`).join('|');
  return createHash('sha256').update(canonico).digest('hex');
}
```

- [ ] **Step 7: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/normalizar.test.ts
```
Esperado: todos passam.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/scripts/tre/tipos.ts web/scripts/tre/normalizar.ts web/scripts/tre/normalizar.test.ts
git commit -m "feat(s3): TRE deps (csv-parse, iconv-lite, tsx) + shared types + normalizar.ts"
```

---

### Task 12: `parse-csv.ts` + fixture

**Files:**
- Create: `web/scripts/tre/__fixtures__/tre-sample.csv`
- Create: `web/scripts/tre/parse-csv.ts`
- Create: `web/scripts/tre/parse-csv.test.ts`

**Interfaces:**
- Consumes: `LinhaCsvTre` (Task 11)
- Produces: `parseCsvTre(buffer: Buffer): LinhaCsvTre[]`

- [ ] **Step 1: Criar fixture CSV (10 linhas, ASCII puro — sem acento no arquivo versionado)**

`web/scripts/tre/__fixtures__/tre-sample.csv`:
```csv
UF,COD_LOCALIDADE_TSE_ZONA,COD_LOCALIDADE_IBGE_ZONA,LOCALIDADE_ZONA,COD_LOCALIDADE_TSE,COD_LOCALIDADE_IBGE,LOCALIDADE,ZONA,TIPO_LOCAL_VOTACAO,SITUACAO_LOCAL_VOTACAO,NUM_LOCAL,DATA_CRIACAO,LOCAL_VOTACAO,TELEFONE,ENDERECO,COD_BAIRRO,BAIRRO,CEP,LATITUDE,LONGITUDE,QTD_SECOES,SECOES,QTD_APTOS,QTD_CANCELADOS,QTD_SUSPENSOS,QTD_VAGAS_RESERVADAS,QTD_BASE_HISTORICA
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,ATIVO,1,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL UM,,"RUA UM, 100",0019802202000479,AEROPORTO,64002510,-5.067541,-42.813800,2,"(s: 101, apt: 50), (s: 102, apt: 50)",100,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,VOTO EM TRANSITO,ATIVO,2,2014-07-13 00:00:00.000,AEROPORTO DE TERESINA,,"AV DOIS, S/N",0019802202000479,AEROPORTO,64006700,,,1,"(s: 201, apt: 0)",0,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,ATIVO,3,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL TRES,,"RUA TRES, 300",0000000000000000,ZZZNADAVER,64000000,-5.070000,-42.810000,1,"(s: 301, apt: 80)",80,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,BLOQUEADO,4,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL QUATRO,,"RUA QUATRO, 400",0019802202000480,CENTRO,64000100,-5.080000,-42.820000,1,"(s: 401, apt: 60)",60,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,ATIVO,5,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL CINCO,,"RUA CINCO, 500",0019802202000479,AEROPORTO,64002520,-5.069000,-42.815000,3,"(s: , apt: 10), (s: 501, apt: 40), (s: 501, apt: 40)",40,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,ATIVO,6,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL SEIS,,"RUA SEIS, 600",0019802202000480,CENTRO,6400010,-5.081000,-42.821000,1,"(s: 601, apt: 30)",30,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,ATIVO,7,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL SETE,,"RUA SETE, 700",0019802202000479,AEROPORTO,64002530,-5.068000,-42.816000,1,"(s: 701, apt: 20)",999,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,PRESO PROVISORIO,ATIVO,8,2014-07-13 00:00:00.000,UNIDADE PRISIONAL OITO,,"RUA OITO, 800",0019802202000480,CENTRO,64000200,-5.082000,-42.822000,1,"(s: 801, apt: 15)",15,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,ATIVO,9,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL NOVE,,"RUA NOVE, 900",0019802202000479,AEROPORTO,64002540,-5.067000,-42.817000,1,"(s: 901, apt: 0)",0,0,0,0,0
PI,12190,2211001,TERESINA,12190,2211001,TERESINA,1,CONVENCIONAL,ATIVO,10,2014-07-13 00:00:00.000,ESCOLA MUNICIPAL DEZ,,"RUA DEZ, 1000",0019802202000480,CENTRO,64000300,-5.083000,-42.823000,2,"(s: 1001, apt: 70), (s: 1002, apt: 70)",140,0,0,0,0
```

Casos cobertos por linha: (1) convencional válido com geo, soma bate; (2) trânsito sem geo, aptos 0; (3) bairro sem match (`ZZZNADAVER`); (4) situação bloqueado; (5) seção malformada + seção duplicada; (6) CEP com 7 dígitos (inválido); (7) `QTD_APTOS` (999) diverge da soma das seções (20); (8) tipo preso provisório; (9) `qtd_aptos` zero (inelegível); (10) segundo local convencional válido simples.

- [ ] **Step 2: Escrever testes de `parse-csv.ts`**

`web/scripts/tre/parse-csv.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parseCsvTre } from './parse-csv';

const fixturePath = join(__dirname, '__fixtures__/tre-sample.csv');

describe('parseCsvTre', () => {
  it('parseia a fixture e retorna 10 linhas tipadas', () => {
    const linhas = parseCsvTre(readFileSync(fixturePath));
    expect(linhas).toHaveLength(10);
    expect(linhas[0].bairro).toBe('AEROPORTO');
    expect(linhas[0].numLocal).toBe('1');
  });

  it('linha com LATITUDE/LONGITUDE vazios tipa como string vazia, não "NaN"', () => {
    const linhas = parseCsvTre(readFileSync(fixturePath));
    const transito = linhas.find((l) => l.numLocal === '2')!;
    expect(transito.latitude).toBe('');
    expect(transito.longitude).toBe('');
  });

  it('nunca expõe COD_BAIRRO no objeto tipado (ADR 0011)', () => {
    const linhas = parseCsvTre(readFileSync(fixturePath));
    expect(Object.keys(linhas[0])).not.toContain('codBairro');
  });

  it('decodifica latin1 corretamente — acentos não corrompem', () => {
    const header = 'UF,COD_LOCALIDADE_TSE_ZONA,COD_LOCALIDADE_IBGE_ZONA,LOCALIDADE_ZONA,COD_LOCALIDADE_TSE,COD_LOCALIDADE_IBGE,LOCALIDADE,ZONA,TIPO_LOCAL_VOTACAO,SITUACAO_LOCAL_VOTACAO,NUM_LOCAL,DATA_CRIACAO,LOCAL_VOTACAO,TELEFONE,ENDERECO,COD_BAIRRO,BAIRRO,CEP,LATITUDE,LONGITUDE,QTD_SECOES,SECOES,QTD_APTOS,QTD_CANCELADOS,QTD_SUSPENSOS,QTD_VAGAS_RESERVADAS,QTD_BASE_HISTORICA';
    const linha = 'PI,1,1,TERESINA,1,2211001,TERESINA,1,CONVENCIONAL,ATIVO,99,2014-01-01,LOCAL,,"AV CENTENÁRIO, S/N",0,AEROPORTO,64000000,-5.0,-42.8,1,"(s: 1, apt: 1)",1,0,0,0,0';
    const bufferLatin1 = iconv.encode(`${header}\n${linha}\n`, 'latin1');

    const [resultado] = parseCsvTre(bufferLatin1);
    expect(resultado.endereco).toBe('AV CENTENÁRIO, S/N');
  });
});
```

- [ ] **Step 3: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/parse-csv.test.ts
```
Esperado: falha com "Cannot find module './parse-csv'".

- [ ] **Step 4: Implementar `parse-csv.ts`**

`web/scripts/tre/parse-csv.ts`:
```typescript
import { parse } from 'csv-parse/sync';
import iconv from 'iconv-lite';
import type { LinhaCsvTre } from './tipos';

interface LinhaCsvBruta {
  UF?: string; LOCALIDADE?: string; COD_LOCALIDADE_IBGE?: string; ZONA?: string;
  TIPO_LOCAL_VOTACAO?: string; SITUACAO_LOCAL_VOTACAO?: string; NUM_LOCAL?: string;
  DATA_CRIACAO?: string; LOCAL_VOTACAO?: string; TELEFONE?: string; ENDERECO?: string;
  BAIRRO?: string; CEP?: string; LATITUDE?: string; LONGITUDE?: string; SECOES?: string;
  QTD_APTOS?: string; QTD_CANCELADOS?: string; QTD_SUSPENSOS?: string;
  QTD_VAGAS_RESERVADAS?: string; QTD_BASE_HISTORICA?: string;
  [coluna: string]: string | undefined;
}

// O CSV do TRE é Latin-1/CP1252, nunca UTF-8 — decodificar antes de parsear
// (confirmado por inspeção do arquivo real: acentos corrompem se lido como UTF-8).
// COD_BAIRRO é lido pelo csv-parse mas nunca copiado para LinhaCsvTre (ADR 0011).
export function parseCsvTre(buffer: Buffer): LinhaCsvTre[] {
  const texto = iconv.decode(buffer, 'latin1');
  const linhas: LinhaCsvBruta[] = parse(texto, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  return linhas.map((l): LinhaCsvTre => ({
    uf: l.UF ?? '',
    localidade: l.LOCALIDADE ?? '',
    codLocalidadeIbge: l.COD_LOCALIDADE_IBGE ?? '',
    zona: l.ZONA ?? '',
    tipoLocalVotacao: l.TIPO_LOCAL_VOTACAO ?? '',
    situacaoLocalVotacao: l.SITUACAO_LOCAL_VOTACAO ?? '',
    numLocal: l.NUM_LOCAL ?? '',
    dataCriacao: l.DATA_CRIACAO ?? '',
    localVotacao: l.LOCAL_VOTACAO ?? '',
    telefone: l.TELEFONE ?? '',
    endereco: l.ENDERECO ?? '',
    bairro: l.BAIRRO ?? '',
    cep: l.CEP ?? '',
    latitude: l.LATITUDE ?? '',
    longitude: l.LONGITUDE ?? '',
    secoes: l.SECOES ?? '',
    qtdAptos: l.QTD_APTOS ?? '',
    qtdCancelados: l.QTD_CANCELADOS ?? '',
    qtdSuspensos: l.QTD_SUSPENSOS ?? '',
    qtdVagasReservadas: l.QTD_VAGAS_RESERVADAS ?? '',
    qtdBaseHistorica: l.QTD_BASE_HISTORICA ?? '',
  }));
}
```

- [ ] **Step 5: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/parse-csv.test.ts
```
Esperado: todos passam.

- [ ] **Step 6: Commit**

```bash
git add web/scripts/tre/__fixtures__/tre-sample.csv web/scripts/tre/parse-csv.ts web/scripts/tre/parse-csv.test.ts
git commit -m "feat(s3): parse-csv.ts — latin1-safe TRE CSV parser + 10-row fixture"
```

---

### Task 13: `preparar-linha.ts` — mapeamento linha → local preparado

**Files:**
- Create: `web/scripts/tre/preparar-linha.ts`
- Create: `web/scripts/tre/preparar-linha.test.ts`

**Interfaces:**
- Consumes: `mapTipoLocal`, `mapSituacaoLocal`, `parseSecoes`, `normalizarCep`, `hashLinha` (Task 11); `LinhaCsvTre`, `LocalPreparado` (Task 11)
- Produces: `prepararLinha(linha: LinhaCsvTre): LocalPreparado`

- [ ] **Step 1: Escrever testes**

`web/scripts/tre/preparar-linha.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { prepararLinha } from './preparar-linha';
import type { LinhaCsvTre } from './tipos';

function linhaBase(overrides: Partial<LinhaCsvTre> = {}): LinhaCsvTre {
  return {
    uf: 'PI', localidade: 'TERESINA', codLocalidadeIbge: '2211001', zona: '1',
    tipoLocalVotacao: 'CONVENCIONAL', situacaoLocalVotacao: 'ATIVO', numLocal: '1',
    dataCriacao: '2014-01-01', localVotacao: 'ESCOLA TESTE', telefone: '',
    endereco: 'RUA TESTE, 1', bairro: 'AEROPORTO', cep: '64000000',
    latitude: '-5.0', longitude: '-42.8', secoes: '(s: 1, apt: 100)',
    qtdAptos: '100', qtdCancelados: '0', qtdSuspensos: '0',
    qtdVagasReservadas: '0', qtdBaseHistorica: '0',
    ...overrides,
  };
}

describe('prepararLinha', () => {
  it('convencional + ativo + aptos>0 é elegível ao calor', () => {
    expect(prepararLinha(linhaBase()).elegivelCalor).toBe(true);
  });
  it('situação bloqueado não é elegível', () => {
    expect(prepararLinha(linhaBase({ situacaoLocalVotacao: 'BLOQUEADO' })).elegivelCalor).toBe(false);
  });
  it('tipo preso provisório não é elegível', () => {
    expect(prepararLinha(linhaBase({ tipoLocalVotacao: 'PRESO PROVISORIO' })).elegivelCalor).toBe(false);
  });
  it('qtd_aptos zero não é elegível', () => {
    const r = prepararLinha(linhaBase({ qtdAptos: '0', secoes: '(s: 1, apt: 0)' }));
    expect(r.elegivelCalor).toBe(false);
  });
  it('lat/long presentes → geoStatus nao_necessario', () => {
    expect(prepararLinha(linhaBase()).geoStatus).toBe('nao_necessario');
  });
  it('lat/long ausentes → geoStatus pendente', () => {
    const r = prepararLinha(linhaBase({ latitude: '', longitude: '' }));
    expect(r.geoStatus).toBe('pendente');
  });
  it('CEP inválido gera aviso cep_invalido', () => {
    expect(prepararLinha(linhaBase({ cep: '123' })).avisos).toContain('cep_invalido');
  });
  it('qtd_aptos divergente da soma das seções gera aviso', () => {
    const r = prepararLinha(linhaBase({ qtdAptos: '999', secoes: '(s: 1, apt: 20)' }));
    expect(r.avisos).toContain('qtd_aptos_diverge_soma_secoes');
  });
  it('rowHash é estável para a mesma linha', () => {
    const linha = linhaBase();
    expect(prepararLinha(linha).rowHash).toBe(prepararLinha(linha).rowHash);
  });
  it('rowHash muda se a linha muda', () => {
    const a = prepararLinha(linhaBase());
    const b = prepararLinha(linhaBase({ numLocal: '2' }));
    expect(a.rowHash).not.toBe(b.rowHash);
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/preparar-linha.test.ts
```
Esperado: falha com "Cannot find module './preparar-linha'".

- [ ] **Step 3: Implementar `preparar-linha.ts`**

`web/scripts/tre/preparar-linha.ts`:
```typescript
import { mapTipoLocal, mapSituacaoLocal, parseSecoes, normalizarCep, hashLinha } from './normalizar';
import type { LinhaCsvTre, LocalPreparado } from './tipos';

function parseNumero(raw: string): number | null {
  if (!raw || !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Combina normalizar.ts para transformar uma linha crua do CSV numa estrutura
// pronta pra INSERT em local_votacao — sem tocar rede/banco (puro, testável).
export function prepararLinha(linha: LinhaCsvTre): LocalPreparado {
  const tipo = mapTipoLocal(linha.tipoLocalVotacao);
  const situacao = mapSituacaoLocal(linha.situacaoLocalVotacao);
  const { secoes, avisos: avisosSecoes } = parseSecoes(linha.secoes);
  const { cep, avisoInvalido: cepInvalido } = normalizarCep(linha.cep);
  const latitude = parseNumero(linha.latitude);
  const longitude = parseNumero(linha.longitude);
  const qtdAptos = parseNumero(linha.qtdAptos) ?? 0;

  const avisos = [...avisosSecoes];
  if (cepInvalido) avisos.push('cep_invalido');

  const somaSecoes = secoes.reduce((acc, s) => acc + s.aptos, 0);
  if (secoes.length > 0 && somaSecoes !== qtdAptos) {
    avisos.push('qtd_aptos_diverge_soma_secoes');
  }

  const elegivelCalor = tipo === 'convencional' && situacao === 'ativo' && qtdAptos > 0;
  const temGeo = latitude !== null && longitude !== null;

  return {
    zonaNumero: parseNumero(linha.zona) ?? 0,
    bairroNomeOriginal: linha.bairro,
    numLocal: parseNumero(linha.numLocal) ?? 0,
    nome: linha.localVotacao,
    endereco: linha.endereco || null,
    cep,
    tipo,
    situacao,
    qtdAptos,
    qtdCancelados: parseNumero(linha.qtdCancelados),
    qtdSuspensos: parseNumero(linha.qtdSuspensos),
    qtdVagasReservadas: parseNumero(linha.qtdVagasReservadas),
    qtdBaseHistorica: parseNumero(linha.qtdBaseHistorica),
    telefone: linha.telefone || null,
    dataCriacaoTre: linha.dataCriacao || null,
    latitude,
    longitude,
    geoStatus: temGeo ? 'nao_necessario' : 'pendente',
    elegivelCalor,
    avisos,
    rowHash: hashLinha(linha as unknown as Record<string, string>),
    secoes,
    linhaOriginal: linha,
  };
}
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/preparar-linha.test.ts
```
Esperado: todos passam.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/tre/preparar-linha.ts web/scripts/tre/preparar-linha.test.ts
git commit -m "feat(s3): preparar-linha.ts — pure CSV row to LocalPreparado mapping"
```

---

### Task 14: `geocode.ts` — cliente Nominatim injetável

**Files:**
- Create: `web/scripts/tre/geocode.ts`
- Create: `web/scripts/tre/geocode.test.ts`

**Interfaces:**
- Produces:
  - `geocodeEndereco(input: { endereco: string|null; cep: string|null; municipio: string; uf: string }, deps: { fetchImpl: typeof fetch; userAgent: string; timeoutMs?: number }): Promise<{ lat: number; lng: number } | null>`
  - `esperar(ms: number): Promise<void>`

- [ ] **Step 1: Escrever testes**

`web/scripts/tre/geocode.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { geocodeEndereco } from './geocode';

function mockFetch(resposta: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => resposta })) as unknown as typeof fetch;
}

describe('geocodeEndereco', () => {
  it('retorna lat/lng quando a API encontra resultado', async () => {
    const fetchImpl = mockFetch([{ lat: '-5.067541', lon: '-42.8138009' }]);
    const r = await geocodeEndereco(
      { endereco: 'RUA UM, 100', cep: '64000000', municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toEqual({ lat: -5.067541, lng: -42.8138009 });
  });

  it('retorna null quando a API não encontra nada', async () => {
    const fetchImpl = mockFetch([]);
    const r = await geocodeEndereco(
      { endereco: 'ENDERECO INEXISTENTE', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toBeNull();
  });

  it('retorna null quando a resposta HTTP não é ok', async () => {
    const fetchImpl = mockFetch([], false);
    const r = await geocodeEndereco(
      { endereco: 'X', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toBeNull();
  });

  it('retorna null quando o fetch lança exceção (rede fora do ar) — não propaga erro', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = await geocodeEndereco(
      { endereco: 'X', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'teste' },
    );
    expect(r).toBeNull();
  });

  it('envia User-Agent próprio no header', async () => {
    const fetchImpl = mockFetch([{ lat: '1', lon: '2' }]);
    await geocodeEndereco(
      { endereco: 'X', cep: null, municipio: 'TERESINA', uf: 'PI' },
      { fetchImpl, userAgent: 'campanha-app/1.0' },
    );
    const chamada = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((chamada[1].headers as Record<string, string>)['User-Agent']).toBe('campanha-app/1.0');
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/geocode.test.ts
```
Esperado: falha com "Cannot find module './geocode'".

- [ ] **Step 3: Implementar `geocode.ts`**

`web/scripts/tre/geocode.ts`:
```typescript
export interface GeocodeInput {
  endereco: string | null;
  cep: string | null;
  municipio: string;
  uf: string;
}

export interface GeocodeResultado {
  lat: number;
  lng: number;
}

export interface GeocodeDeps {
  fetchImpl: typeof fetch;
  userAgent: string;
  timeoutMs?: number;
}

// Nominatim/OSM — sem custo, sem API key (ADR 0012). Nunca lança: falha de
// rede/timeout/resposta vazia sempre vira `null`, nunca exceção — quem chama
// (geocode-pendentes.ts) trata isso como geo_status='falhou', não aborta o lote.
export async function geocodeEndereco(
  input: GeocodeInput,
  deps: GeocodeDeps,
): Promise<GeocodeResultado | null> {
  const partes = [input.endereco, input.municipio, input.uf, input.cep, 'Brasil'].filter(Boolean);
  const query = partes.join(', ');
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5000);

  try {
    const resp = await deps.fetchImpl(url, {
      headers: { 'User-Agent': deps.userAgent },
      signal: controller.signal,
    });
    if (!resp.ok) return null;

    const dados = (await resp.json()) as Array<{ lat: string; lon: string }>;
    if (!dados.length) return null;

    const lat = Number(dados[0].lat);
    const lng = Number(dados[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Rate-limit da política de uso do Nominatim: 1 req/s.
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/geocode.test.ts
```
Esperado: todos passam.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/tre/geocode.ts web/scripts/tre/geocode.test.ts
git commit -m "feat(s3): geocode.ts — injectable Nominatim client, never throws"
```

---

### Task 15: `bairros-seed.ts` + deps + CLI — fase `seed-bairros`

**Files:**
- Create: `web/scripts/tre/bairros-seed.ts`
- Create: `web/scripts/tre/bairros-seed.test.ts`
- Create: `web/scripts/tre/build-bairros-seed-deps.ts`
- Create: `web/scripts/tre/cli/seed-bairros.ts`

**Interfaces:**
- Consumes: `normalizarTexto` (Task 11); `adminClient` (`web/lib/supabase/server.ts`)
- Produces: `seedBairros(json: BairrosJson, municipioId: number, deps: BairrosSeedDeps): Promise<{ total: number }>`; CLI `tre:seed-bairros --json <path> --municipio <cod_ibge>`

- [ ] **Step 1: Escrever testes**

`web/scripts/tre/bairros-seed.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { seedBairros } from './bairros-seed';

describe('seedBairros', () => {
  it('chama upsertBairro para cada bairro do JSON, com nome_normalizado e regiao corretos', async () => {
    const upsertBairro = vi.fn(async () => {});
    const json = {
      regiao_central: [{ bairro: 'Centro' }, { bairro: 'Cabral' }],
      zona_norte: [{ bairro: 'Aeroporto' }],
    };

    const { total } = await seedBairros(json, 2211001, { upsertBairro });

    expect(total).toBe(3);
    expect(upsertBairro).toHaveBeenCalledTimes(3);
    expect(upsertBairro).toHaveBeenCalledWith({
      municipioId: 2211001, nome: 'Centro', nomeNormalizado: 'centro', regiao: 'regiao_central',
    });
    expect(upsertBairro).toHaveBeenCalledWith({
      municipioId: 2211001, nome: 'Aeroporto', nomeNormalizado: 'aeroporto', regiao: 'zona_norte',
    });
  });

  it('JSON vazio retorna total 0 e não chama upsertBairro', async () => {
    const upsertBairro = vi.fn(async () => {});
    const { total } = await seedBairros({}, 2211001, { upsertBairro });
    expect(total).toBe(0);
    expect(upsertBairro).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/bairros-seed.test.ts
```
Esperado: falha com "Cannot find module './bairros-seed'".

- [ ] **Step 3: Implementar `bairros-seed.ts`**

`web/scripts/tre/bairros-seed.ts`:
```typescript
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
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/bairros-seed.test.ts
```

- [ ] **Step 5: Implementar `build-bairros-seed-deps.ts`**

`web/scripts/tre/build-bairros-seed-deps.ts`:
```typescript
import { adminClient } from '../../lib/supabase/server';
import type { BairrosSeedDeps } from './bairros-seed';

export function buildBairrosSeedDeps(): BairrosSeedDeps {
  const admin = adminClient();
  return {
    async upsertBairro({ municipioId, nome, nomeNormalizado, regiao }) {
      const { error } = await admin
        .from('bairro_oficial')
        .upsert(
          { municipio_id: municipioId, nome, nome_normalizado: nomeNormalizado, regiao },
          { onConflict: 'municipio_id,nome_normalizado' },
        );
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 6: Implementar CLI `cli/seed-bairros.ts`**

`web/scripts/tre/cli/seed-bairros.ts`:
```typescript
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { seedBairros, type BairrosJson } from '../bairros-seed';
import { buildBairrosSeedDeps } from '../build-bairros-seed-deps';

const { values } = parseArgs({
  options: {
    json: { type: 'string' },
    municipio: { type: 'string' },
  },
});

if (!values.json || !values.municipio) {
  console.error('uso: tre:seed-bairros --json <path> --municipio <cod_ibge>');
  process.exit(1);
}

const json = JSON.parse(readFileSync(values.json, 'utf8')) as BairrosJson;
const municipioId = Number(values.municipio);

seedBairros(json, municipioId, buildBairrosSeedDeps())
  .then(({ total }) => {
    console.log(`bairro_oficial: ${total} registros upsertados para município ${municipioId}`);
  })
  .catch((err) => {
    console.error('erro ao semear bairros:', err);
    process.exit(1);
  });
```

- [ ] **Step 7: Rodar contra o JSON real e verificar via `execute_sql`**

```bash
cd web && npm run tre:seed-bairros -- --json "D:\projeto-pol-superpowers\bairros_teresina_final.json" --municipio 2211001
```
Esperado: imprime `bairro_oficial: 403 registros upsertados para município 2211001` (ou o total real do JSON).

Via `mcp__supabase__execute_sql`:
```sql
SELECT count(*) FROM public.bairro_oficial WHERE municipio_id = 2211001;
```
Esperado: >= 400 (inclui os 2 semeados manualmente na Task 6, deduplicados por `ON CONFLICT`... nota: `upsert` do Supabase client não usa `ON CONFLICT DO NOTHING`, então nomes já existentes são sobrescritos com os mesmos valores — sem efeito colateral).

- [ ] **Step 8: Commit**

```bash
git add web/scripts/tre/bairros-seed.ts web/scripts/tre/bairros-seed.test.ts web/scripts/tre/build-bairros-seed-deps.ts web/scripts/tre/cli/seed-bairros.ts
git commit -m "feat(s3): bairros-seed.ts + CLI — tre:seed-bairros loads bairro_oficial from JSON"
```

---

### Task 16: `ingest.ts` + deps + CLI (`ingest` e `dry-run`)

**Files:**
- Create: `web/scripts/tre/ingest.ts`
- Create: `web/scripts/tre/ingest.test.ts`
- Create: `web/scripts/tre/build-ingest-deps.ts`
- Create: `web/scripts/tre/cli/ingest.ts`
- Create: `web/scripts/tre/cli/dry-run.ts`

**Interfaces:**
- Consumes: `prepararLinha` (Task 13); `parseCsvTre` (Task 12); `adminClient` (`web/lib/supabase/server.ts`); RPC `match_bairro_oficial` (Task 6)
- Produces: `ingerirLote(input: IngerirLoteInput, deps: IngestDeps): Promise<IngerirLoteResultado>`; CLIs `tre:ingest` e `tre:dry-run`

- [ ] **Step 1: Escrever testes de `ingerirLote` (deps 100% mockadas)**

`web/scripts/tre/ingest.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { ingerirLote, type IngestDeps } from './ingest';
import type { LinhaCsvTre } from './tipos';

function linha(overrides: Partial<LinhaCsvTre> = {}): LinhaCsvTre {
  return {
    uf: 'PI', localidade: 'TERESINA', codLocalidadeIbge: '2211001', zona: '1',
    tipoLocalVotacao: 'CONVENCIONAL', situacaoLocalVotacao: 'ATIVO', numLocal: '1',
    dataCriacao: '2014-01-01', localVotacao: 'ESCOLA TESTE', telefone: '',
    endereco: 'RUA TESTE, 1', bairro: 'AEROPORTO', cep: '64000000',
    latitude: '-5.0', longitude: '-42.8', secoes: '(s: 1, apt: 100)',
    qtdAptos: '100', qtdCancelados: '0', qtdSuspensos: '0',
    qtdVagasReservadas: '0', qtdBaseHistorica: '0',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    upsertMunicipio: vi.fn(async () => {}),
    upsertZona: vi.fn(async () => 'zona-id'),
    matchBairroOficial: vi.fn(async () => 'bairro-id'),
    criarImportacao: vi.fn(async () => 'importacao-id'),
    atualizarImportacao: vi.fn(async () => {}),
    inserirLocalVotacao: vi.fn(async () => {}),
    inserirStaging: vi.fn(async () => {}),
    ...overrides,
  };
}

const baseInput = {
  municipioId: 2211001, municipioNome: 'TERESINA', uf: 'PI', ano: 2026,
  arquivoNome: 'x.csv', arquivoSha256: 'hash', arquivoTamanhoBytes: 10, operador: 'teste',
};

describe('ingerirLote', () => {
  it('linha com bairro casado vira local_votacao publicado (não staging)', async () => {
    const deps = makeDeps();
    const r = await ingerirLote({ ...baseInput, linhas: [linha()] }, deps);

    expect(r.totalPublicados).toBe(1);
    expect(r.totalStaging).toBe(0);
    expect(r.totalErros).toBe(0);
    expect(deps.inserirLocalVotacao).toHaveBeenCalledTimes(1);
    expect(deps.inserirStaging).not.toHaveBeenCalled();
    expect(deps.atualizarImportacao).toHaveBeenCalledWith(
      'importacao-id',
      expect.objectContaining({ status: 'pendente_revisao', totalPublicados: 1, totalStaging: 0, totalErros: 0 }),
    );
  });

  it('linha sem match de bairro vira staging, nunca local_votacao', async () => {
    const deps = makeDeps({ matchBairroOficial: vi.fn(async () => null) });
    const r = await ingerirLote({ ...baseInput, linhas: [linha({ bairro: 'ZZZNADAVER' })] }, deps);

    expect(r.totalStaging).toBe(1);
    expect(r.totalPublicados).toBe(0);
    expect(deps.inserirStaging).toHaveBeenCalledWith(expect.objectContaining({ motivos: ['bairro_sem_match'] }));
    expect(deps.inserirLocalVotacao).not.toHaveBeenCalled();
  });

  it('linha sem NUM_LOCAL vira staging com erro_parse, sem chamar match', async () => {
    const deps = makeDeps();
    const r = await ingerirLote({ ...baseInput, linhas: [linha({ numLocal: '' })] }, deps);

    expect(r.totalErros).toBe(1);
    expect(deps.inserirStaging).toHaveBeenCalledWith(expect.objectContaining({ motivos: ['erro_parse'] }));
    expect(deps.matchBairroOficial).not.toHaveBeenCalled();
  });

  it('dry-run consulta match_bairro_oficial mas nunca escreve', async () => {
    const deps = makeDeps();
    const r = await ingerirLote({ ...baseInput, linhas: [linha()], dryRun: true }, deps);

    expect(r.totalPublicados).toBe(1);
    expect(r.importacaoId).toBeNull();
    expect(deps.matchBairroOficial).toHaveBeenCalled();
    expect(deps.criarImportacao).not.toHaveBeenCalled();
    expect(deps.upsertMunicipio).not.toHaveBeenCalled();
    expect(deps.upsertZona).not.toHaveBeenCalled();
    expect(deps.inserirLocalVotacao).not.toHaveBeenCalled();
    expect(deps.inserirStaging).not.toHaveBeenCalled();
    expect(deps.atualizarImportacao).not.toHaveBeenCalled();
  });

  it('limiar customizado é repassado para matchBairroOficial', async () => {
    const deps = makeDeps();
    await ingerirLote({ ...baseInput, linhas: [linha()], limiar: 0.7 }, deps);
    expect(deps.matchBairroOficial).toHaveBeenCalledWith(2211001, 'AEROPORTO', 0.7);
  });

  it('lote termina em pendente_revisao, nunca publicado sozinho', async () => {
    const deps = makeDeps();
    await ingerirLote({ ...baseInput, linhas: [linha()] }, deps);
    const chamada = (deps.atualizarImportacao as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[1].status && c[1].status !== 'processando',
    );
    expect(chamada?.[1].status).toBe('pendente_revisao');
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/ingest.test.ts
```
Esperado: falha com "Cannot find module './ingest'".

- [ ] **Step 3: Implementar `ingest.ts`**

`web/scripts/tre/ingest.ts`:
```typescript
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
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/ingest.test.ts
```
Esperado: todos passam.

- [ ] **Step 5: Implementar `build-ingest-deps.ts`**

`web/scripts/tre/build-ingest-deps.ts`:
```typescript
import { adminClient } from '../../lib/supabase/server';
import type { IngestDeps } from './ingest';

// Insere local_votacao e suas seções em duas chamadas sequenciais (não numa
// única transação SQL) — aceitável nesta fatia porque cada linha é
// independente; uma falha entre as duas deixa no máximo um local órfão sem
// seções, corrigível manualmente. Ver spec, seção "Riscos".
export function buildIngestDeps(): IngestDeps {
  const admin = adminClient();

  return {
    async upsertMunicipio({ codIbge, nome, uf }) {
      const { error } = await admin
        .from('municipio')
        .upsert({ cod_ibge: codIbge, nome, uf }, { onConflict: 'cod_ibge' });
      if (error) throw error;
    },

    async upsertZona({ municipioId, numero }) {
      const { data: existente } = await admin
        .from('zona_eleitoral')
        .select('id')
        .eq('municipio_id', municipioId)
        .eq('numero', numero)
        .maybeSingle();
      if (existente) return existente.id as string;

      const { data, error } = await admin
        .from('zona_eleitoral')
        .insert({ municipio_id: municipioId, numero })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async matchBairroOficial(municipioId, nomeBruto, limiar) {
      const { data, error } = await admin.rpc('match_bairro_oficial', {
        p_municipio_id: municipioId,
        p_nome_bruto: nomeBruto,
        p_limiar: limiar,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },

    async criarImportacao(input) {
      const { data, error } = await admin
        .from('importacao_tre')
        .insert({
          municipio_id: input.municipioId,
          uf: input.uf,
          ano: input.ano,
          status: 'pendente',
          arquivo_nome: input.arquivoNome,
          arquivo_sha256: input.arquivoSha256,
          arquivo_tamanho_bytes: input.arquivoTamanhoBytes,
          importer_version: input.importerVersion,
          operador: input.operador,
          total_linhas: input.totalLinhas,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async atualizarImportacao(id, patch) {
      const payload: Record<string, unknown> = {};
      if (patch.status) payload.status = patch.status;
      if (patch.totalPublicados !== undefined) payload.total_publicados = patch.totalPublicados;
      if (patch.totalStaging !== undefined) payload.total_staging = patch.totalStaging;
      if (patch.totalErros !== undefined) payload.total_erros = patch.totalErros;
      if (patch.log !== undefined) payload.log = patch.log;
      const { error } = await admin.from('importacao_tre').update(payload).eq('id', id);
      if (error) throw error;
    },

    async inserirLocalVotacao({ importacaoId, zonaId, bairroOficialId, local }) {
      const temGeo = local.latitude !== null && local.longitude !== null;

      const { data, error } = await admin
        .from('local_votacao')
        .insert({
          importacao_id: importacaoId,
          zona_id: zonaId,
          bairro_oficial_id: bairroOficialId,
          bairro_nome_original: local.bairroNomeOriginal,
          num_local: local.numLocal,
          nome: local.nome,
          endereco: local.endereco,
          cep: local.cep,
          geo_status: local.geoStatus,
          tipo: local.tipo,
          situacao: local.situacao,
          qtd_aptos: local.qtdAptos,
          qtd_cancelados: local.qtdCancelados,
          qtd_suspensos: local.qtdSuspensos,
          qtd_vagas_reservadas: local.qtdVagasReservadas,
          qtd_base_historica: local.qtdBaseHistorica,
          telefone: local.telefone,
          elegivel_calor: local.elegivelCalor,
          avisos: local.avisos,
          row_hash: local.rowHash,
          // EWKT — Postgres/PostGIS aceita texto no input da coluna geometry
          ...(temGeo ? { geo: `SRID=4326;POINT(${local.longitude} ${local.latitude})` } : {}),
        })
        .select('id')
        .single();
      if (error) throw error;

      if (local.secoes.length > 0) {
        const { error: erroSecoes } = await admin.from('secao').insert(
          local.secoes.map((s) => ({ local_id: data.id, numero: s.numero, aptos: s.aptos })),
        );
        if (erroSecoes) throw erroSecoes;
      }
    },

    async inserirStaging({ importacaoId, linhaOriginal, rowHash, motivos }) {
      const { error } = await admin.from('local_votacao_staging').insert({
        importacao_id: importacaoId,
        linha_original: linhaOriginal,
        row_hash: rowHash,
        motivos,
      });
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 6: Implementar CLI `cli/ingest.ts`**

`web/scripts/tre/cli/ingest.ts`:
```typescript
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { parseCsvTre } from '../parse-csv';
import { ingerirLote } from '../ingest';
import { buildIngestDeps } from '../build-ingest-deps';

const { values } = parseArgs({
  options: {
    csv: { type: 'string' },
    municipio: { type: 'string' },
    'municipio-nome': { type: 'string', default: 'TERESINA' },
    uf: { type: 'string', default: 'PI' },
    ano: { type: 'string' },
    operador: { type: 'string', default: process.env.USER ?? process.env.USERNAME ?? 'desconhecido' },
    limiar: { type: 'string' },
  },
});

if (!values.csv || !values.municipio || !values.ano) {
  console.error('uso: tre:ingest --csv <path> --municipio <cod_ibge> --ano <ano> [--limiar 0.4]');
  process.exit(1);
}

const buffer = readFileSync(values.csv);
const arquivoSha256 = createHash('sha256').update(buffer).digest('hex');
const arquivoTamanhoBytes = statSync(values.csv).size;
const linhas = parseCsvTre(buffer);

ingerirLote(
  {
    linhas,
    municipioId: Number(values.municipio),
    municipioNome: values['municipio-nome']!,
    uf: values.uf!,
    ano: Number(values.ano),
    arquivoNome: values.csv,
    arquivoSha256,
    arquivoTamanhoBytes,
    operador: values.operador!,
    limiar: values.limiar ? Number(values.limiar) : undefined,
  },
  buildIngestDeps(),
)
  .then((r) => {
    console.log(
      `importacao ${r.importacaoId}: linhas=${r.totalLinhas} publicados=${r.totalPublicados} ` +
      `staging=${r.totalStaging} erros=${r.totalErros} — status=pendente_revisao (rode tre:revisar/tre:geocode/tre:publicar em seguida)`,
    );
  })
  .catch((err) => {
    console.error('erro na ingestão:', err);
    process.exit(1);
  });
```

- [ ] **Step 7: Implementar CLI `cli/dry-run.ts`**

`web/scripts/tre/cli/dry-run.ts`:
```typescript
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseCsvTre } from '../parse-csv';
import { ingerirLote } from '../ingest';
import { buildIngestDeps } from '../build-ingest-deps';

const { values } = parseArgs({
  options: {
    csv: { type: 'string' },
    municipio: { type: 'string' },
    'municipio-nome': { type: 'string', default: 'TERESINA' },
    uf: { type: 'string', default: 'PI' },
    ano: { type: 'string' },
    limiar: { type: 'string' },
  },
});

if (!values.csv || !values.municipio || !values.ano) {
  console.error('uso: tre:dry-run --csv <path> --municipio <cod_ibge> --ano <ano>');
  process.exit(1);
}

const linhas = parseCsvTre(readFileSync(values.csv));

ingerirLote(
  {
    linhas,
    municipioId: Number(values.municipio),
    municipioNome: values['municipio-nome']!,
    uf: values.uf!,
    ano: Number(values.ano),
    arquivoNome: values.csv,
    arquivoSha256: '',
    arquivoTamanhoBytes: 0,
    operador: 'dry-run',
    limiar: values.limiar ? Number(values.limiar) : undefined,
    dryRun: true,
  },
  buildIngestDeps(),
)
  .then((r) => {
    console.log(`[dry-run] linhas=${r.totalLinhas} importaria=${r.totalPublicados} staging=${r.totalStaging} erros=${r.totalErros}`);
  })
  .catch((err) => {
    console.error('erro no dry-run:', err);
    process.exit(1);
  });
```

- [ ] **Step 8: Rodar `tre:dry-run` contra a fixture e verificar nada foi gravado**

```bash
cd web && npm run tre:dry-run -- --csv scripts/tre/__fixtures__/tre-sample.csv --municipio 2211001 --ano 2026
```
Esperado: `[dry-run] linhas=10 importaria=9 staging=1 erros=0` (só a linha 3, bairro `ZZZNADAVER`, não casa; as outras 9 casam com `AEROPORTO` ou `CENTRO`, nenhuma tem `NUM_LOCAL`/nome ausente). Se o número impresso divergir, use-o como baseline real — o que importa é confirmar abaixo que nada foi persistido.

Via `mcp__supabase__execute_sql`:
```sql
SELECT count(*) FROM public.importacao_tre WHERE ano = 2026 AND municipio_id = 2211001;
```
Esperado: `0` (dry-run não cria lote).

- [ ] **Step 9: Rodar `tre:ingest` contra a fixture de verdade**

```bash
cd web && npm run tre:ingest -- --csv scripts/tre/__fixtures__/tre-sample.csv --municipio 2211001 --ano 2026 --operador teste-task16
```
Esperado: imprime `importacao <uuid>: linhas=10 publicados=<N> staging=<M> erros=<E>` com `N+M+E=10`. Guardar `<uuid>` como `<importacao_fixture>`.

- [ ] **Step 10: Verificar via `execute_sql`**

```sql
SELECT status, total_linhas, total_publicados, total_staging, total_erros, importer_version, arquivo_sha256
  FROM public.importacao_tre WHERE id = '<importacao_fixture>';
-- esperado: status='pendente_revisao'; total_linhas=10; soma dos três totais = 10; importer_version='s3.0'; arquivo_sha256 preenchido

SELECT num_local, tipo, situacao, elegivel_calor, geo_status, avisos
  FROM public.local_votacao WHERE importacao_id = '<importacao_fixture>' ORDER BY num_local;
-- esperado: linha 1 elegivel_calor=true geo_status=nao_necessario;
--           linha 2 (trânsito) elegivel_calor=false geo_status=pendente;
--           linha 4 (bloqueado) elegivel_calor=false;
--           linha 5 avisos contém secao_malformada/secao_duplicada;
--           linha 6 avisos contém cep_invalido;
--           linha 7 avisos contém qtd_aptos_diverge_soma_secoes;
--           linha 8 (preso provisório) elegivel_calor=false;
--           linha 9 (aptos=0) elegivel_calor=false;
--           linha 3 NÃO aparece (foi para staging)

SELECT motivos FROM public.local_votacao_staging WHERE importacao_id = '<importacao_fixture>';
-- esperado: 1 linha, motivos = {bairro_sem_match} (a linha do ZZZNADAVER)
```

- [ ] **Step 11: Limpar dados de teste**

```sql
DELETE FROM public.secao WHERE local_id IN (SELECT id FROM public.local_votacao WHERE importacao_id = '<importacao_fixture>');
DELETE FROM public.local_votacao WHERE importacao_id = '<importacao_fixture>';
DELETE FROM public.local_votacao_staging WHERE importacao_id = '<importacao_fixture>';
DELETE FROM public.importacao_tre WHERE id = '<importacao_fixture>';
```

- [ ] **Step 12: Commit**

```bash
git add web/scripts/tre/ingest.ts web/scripts/tre/ingest.test.ts web/scripts/tre/build-ingest-deps.ts web/scripts/tre/cli/ingest.ts web/scripts/tre/cli/dry-run.ts
git commit -m "feat(s3): ingerirLote orchestrator + tre:ingest/tre:dry-run CLIs — parse+match+insert, no geocode, no publish"
```

---

### Task 17: `revisar-staging.ts` + deps + CLI — fase `revisar`

**Files:**
- Create: `web/scripts/tre/revisar-staging.ts`
- Create: `web/scripts/tre/revisar-staging.test.ts`
- Create: `web/scripts/tre/build-revisar-deps.ts`
- Create: `web/scripts/tre/cli/revisar.ts`

**Interfaces:**
- Consumes: `prepararLinha` (Task 13); `LocalPreparado`, `LinhaCsvTre` (Task 11)
- Produces: `promoverStaging`, `descartarStaging`, `listarStagingPendente`; CLI `tre:revisar [--importacao <id>] [--id <id> --bairro-oficial-id <id> | --id <id> --descartar]`

- [ ] **Step 1: Escrever testes**

`web/scripts/tre/revisar-staging.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { promoverStaging, descartarStaging, listarStagingPendente, type RevisarDeps } from './revisar-staging';
import type { LinhaCsvTre } from './tipos';

function linha(): LinhaCsvTre {
  return {
    uf: 'PI', localidade: 'TERESINA', codLocalidadeIbge: '2211001', zona: '1',
    tipoLocalVotacao: 'CONVENCIONAL', situacaoLocalVotacao: 'ATIVO', numLocal: '3',
    dataCriacao: '2014-01-01', localVotacao: 'ESCOLA TRES', telefone: '',
    endereco: 'RUA TRES, 300', bairro: 'ZZZNADAVER', cep: '64000000',
    latitude: '-5.07', longitude: '-42.81', secoes: '(s: 301, apt: 80)',
    qtdAptos: '80', qtdCancelados: '0', qtdSuspensos: '0',
    qtdVagasReservadas: '0', qtdBaseHistorica: '0',
  };
}

function makeDeps(overrides: Partial<RevisarDeps> = {}): RevisarDeps {
  return {
    listarPendentes: vi.fn(async () => []),
    buscarStaging: vi.fn(async () => ({ importacaoId: 'importacao-1', municipioId: 2211001, linhaOriginal: linha() })),
    upsertZona: vi.fn(async () => 'zona-1'),
    inserirLocalVotacao: vi.fn(async () => {}),
    marcarRevisado: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('promoverStaging', () => {
  it('insere local_votacao com o bairro escolhido e marca revisado', async () => {
    const deps = makeDeps();
    const r = await promoverStaging('staging-1', 'bairro-escolhido', 'gestor-x', deps);

    expect(r.promovido).toBe(true);
    expect(deps.inserirLocalVotacao).toHaveBeenCalledWith(expect.objectContaining({
      importacaoId: 'importacao-1', zonaId: 'zona-1', bairroOficialId: 'bairro-escolhido',
    }));
    expect(deps.marcarRevisado).toHaveBeenCalledWith({
      id: 'staging-1', resolvidoBairroOficialId: 'bairro-escolhido', revisadoPor: 'gestor-x',
    });
  });

  it('lança se o staging não existe', async () => {
    const deps = makeDeps({ buscarStaging: vi.fn(async () => null) });
    await expect(promoverStaging('inexistente', 'bairro-x', 'gestor-x', deps)).rejects.toThrow('staging não encontrado');
  });
});

describe('descartarStaging', () => {
  it('marca revisado sem bairro e sem inserir local_votacao', async () => {
    const deps = makeDeps();
    await descartarStaging('staging-1', 'gestor-x', deps);

    expect(deps.marcarRevisado).toHaveBeenCalledWith({
      id: 'staging-1', resolvidoBairroOficialId: null, revisadoPor: 'gestor-x',
    });
    expect(deps.inserirLocalVotacao).not.toHaveBeenCalled();
  });
});

describe('listarStagingPendente', () => {
  it('delega para deps.listarPendentes', async () => {
    const deps = makeDeps({ listarPendentes: vi.fn(async () => [{ id: 'x' } as never]) });
    const r = await listarStagingPendente('importacao-1', deps);
    expect(r).toHaveLength(1);
    expect(deps.listarPendentes).toHaveBeenCalledWith('importacao-1');
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/revisar-staging.test.ts
```
Esperado: falha com "Cannot find module './revisar-staging'".

- [ ] **Step 3: Implementar `revisar-staging.ts`**

`web/scripts/tre/revisar-staging.ts`:
```typescript
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
    importacaoId: string; zonaId: string; bairroOficialId: string; local: LocalPreparado;
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
// do ingest (prepararLinha) e insere em local_votacao com o bairro_oficial_id
// que o Superadmin escolheu manualmente.
export async function promoverStaging(
  id: string,
  bairroOficialId: string,
  revisadoPor: string,
  deps: RevisarDeps,
): Promise<{ promovido: true }> {
  const registro = await deps.buscarStaging(id);
  if (!registro) throw new Error(`staging não encontrado: ${id}`);

  const preparado = prepararLinha(registro.linhaOriginal);
  const zonaId = await deps.upsertZona({ municipioId: registro.municipioId, numero: preparado.zonaNumero });

  await deps.inserirLocalVotacao({
    importacaoId: registro.importacaoId, zonaId, bairroOficialId, local: preparado,
  });
  await deps.marcarRevisado({ id, resolvidoBairroOficialId: bairroOficialId, revisadoPor });

  return { promovido: true };
}

export async function descartarStaging(
  id: string,
  revisadoPor: string,
  deps: RevisarDeps,
): Promise<void> {
  await deps.marcarRevisado({ id, resolvidoBairroOficialId: null, revisadoPor });
}
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/revisar-staging.test.ts
```

- [ ] **Step 5: Implementar `build-revisar-deps.ts`**

`web/scripts/tre/build-revisar-deps.ts`:
```typescript
import { adminClient } from '../../lib/supabase/server';
import type { RevisarDeps } from './revisar-staging';

export function buildRevisarDeps(): RevisarDeps {
  const admin = adminClient();

  return {
    async listarPendentes(importacaoId) {
      let query = admin
        .from('local_votacao_staging')
        .select('id, importacao_id, linha_original, motivos, criado_em')
        .eq('revisado', false)
        .order('criado_em', { ascending: true });
      if (importacaoId) query = query.eq('importacao_id', importacaoId);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        importacaoId: r.importacao_id,
        linhaOriginal: r.linha_original,
        motivos: r.motivos,
        criadoEm: r.criado_em,
      }));
    },

    async buscarStaging(id) {
      const { data, error } = await admin
        .from('local_votacao_staging')
        .select('importacao_id, linha_original, importacao_tre:importacao_id(municipio_id)')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const municipioId = (data.importacao_tre as unknown as { municipio_id: number }).municipio_id;
      return { importacaoId: data.importacao_id, municipioId, linhaOriginal: data.linha_original };
    },

    async upsertZona({ municipioId, numero }) {
      const { data: existente } = await admin
        .from('zona_eleitoral').select('id').eq('municipio_id', municipioId).eq('numero', numero).maybeSingle();
      if (existente) return existente.id as string;
      const { data, error } = await admin
        .from('zona_eleitoral').insert({ municipio_id: municipioId, numero }).select('id').single();
      if (error) throw error;
      return data.id as string;
    },

    async inserirLocalVotacao({ importacaoId, zonaId, bairroOficialId, local }) {
      const temGeo = local.latitude !== null && local.longitude !== null;
      const { data, error } = await admin.from('local_votacao').insert({
        importacao_id: importacaoId, zona_id: zonaId, bairro_oficial_id: bairroOficialId,
        bairro_nome_original: local.bairroNomeOriginal, num_local: local.numLocal, nome: local.nome,
        endereco: local.endereco, cep: local.cep, geo_status: local.geoStatus, tipo: local.tipo,
        situacao: local.situacao, qtd_aptos: local.qtdAptos, qtd_cancelados: local.qtdCancelados,
        qtd_suspensos: local.qtdSuspensos, qtd_vagas_reservadas: local.qtdVagasReservadas,
        qtd_base_historica: local.qtdBaseHistorica, telefone: local.telefone,
        elegivel_calor: local.elegivelCalor, avisos: local.avisos, row_hash: local.rowHash,
        ...(temGeo ? { geo: `SRID=4326;POINT(${local.longitude} ${local.latitude})` } : {}),
      }).select('id').single();
      if (error) throw error;

      if (local.secoes.length > 0) {
        const { error: erroSecoes } = await admin.from('secao').insert(
          local.secoes.map((s) => ({ local_id: data.id, numero: s.numero, aptos: s.aptos })),
        );
        if (erroSecoes) throw erroSecoes;
      }
    },

    async marcarRevisado({ id, resolvidoBairroOficialId, revisadoPor }) {
      const { error } = await admin.from('local_votacao_staging').update({
        revisado: true,
        resolvido_bairro_oficial_id: resolvidoBairroOficialId,
        revisado_por: revisadoPor,
        revisado_em: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 6: Implementar CLI `cli/revisar.ts`**

`web/scripts/tre/cli/revisar.ts`:
```typescript
import { parseArgs } from 'node:util';
import { listarStagingPendente, promoverStaging, descartarStaging } from '../revisar-staging';
import { buildRevisarDeps } from '../build-revisar-deps';

const { values } = parseArgs({
  options: {
    importacao: { type: 'string' },
    id: { type: 'string' },
    'bairro-oficial-id': { type: 'string' },
    descartar: { type: 'boolean', default: false },
    operador: { type: 'string', default: process.env.USER ?? process.env.USERNAME ?? 'desconhecido' },
  },
});

const deps = buildRevisarDeps();

async function main() {
  if (values.id && values['bairro-oficial-id']) {
    const r = await promoverStaging(values.id, values['bairro-oficial-id']!, values.operador!, deps);
    console.log(`staging ${values.id} promovido: ${r.promovido}`);
    return;
  }
  if (values.id && values.descartar) {
    await descartarStaging(values.id, values.operador!, deps);
    console.log(`staging ${values.id} descartado`);
    return;
  }

  const pendentes = await listarStagingPendente(values.importacao, deps);
  console.log(`${pendentes.length} linha(s) pendente(s) de revisão:`);
  for (const p of pendentes) {
    console.log(`  ${p.id} — motivos=[${p.motivos.join(', ')}] bairro="${p.linhaOriginal.bairro}" local="${p.linhaOriginal.localVotacao}"`);
  }
}

main().catch((err) => {
  console.error('erro na revisão:', err);
  process.exit(1);
});
```

- [ ] **Step 7: Rodar contra o staging real deixado pela Task 16 (reingerir a fixture, já que a Task 16 limpou os dados)**

```bash
cd web && npm run tre:ingest -- --csv scripts/tre/__fixtures__/tre-sample.csv --municipio 2211001 --ano 2027 --operador teste-task17
```
Guardar `<importacao_task17>` do output.

```bash
cd web && npm run tre:revisar -- --importacao <importacao_task17>
```
Esperado: lista 1 linha pendente (bairro `ZZZNADAVER`, `num_local=3`).

```bash
cd web && npm run tre:seed-bairros -- --json "D:\projeto-pol-superpowers\bairros_teresina_final.json" --municipio 2211001
```
(Garante que existe algum bairro_oficial pra promover contra — usar qualquer `id` retornado por uma consulta rápida.)

Via `mcp__supabase__execute_sql`:
```sql
SELECT id FROM public.bairro_oficial WHERE municipio_id = 2211001 LIMIT 1;
-- guardar como <bairro_qualquer>
SELECT id FROM public.local_votacao_staging WHERE importacao_id = '<importacao_task17>' AND revisado = false;
-- guardar como <staging_id>
```

```bash
cd web && npm run tre:revisar -- --id <staging_id> --bairro-oficial-id <bairro_qualquer>
```
Esperado: `staging <staging_id> promovido: true`.

Verificar:
```sql
SELECT num_local, bairro_oficial_id FROM public.local_votacao WHERE importacao_id = '<importacao_task17>' AND num_local = 3;
-- esperado: 1 linha, bairro_oficial_id = <bairro_qualquer>
SELECT revisado, resolvido_bairro_oficial_id FROM public.local_votacao_staging WHERE id = '<staging_id>';
-- esperado: revisado=true
```

- [ ] **Step 8: Limpar dados de teste**

```sql
DELETE FROM public.secao WHERE local_id IN (SELECT id FROM public.local_votacao WHERE importacao_id = '<importacao_task17>');
DELETE FROM public.local_votacao WHERE importacao_id = '<importacao_task17>';
DELETE FROM public.local_votacao_staging WHERE importacao_id = '<importacao_task17>';
DELETE FROM public.importacao_tre WHERE id = '<importacao_task17>';
```

- [ ] **Step 9: Commit**

```bash
git add web/scripts/tre/revisar-staging.ts web/scripts/tre/revisar-staging.test.ts web/scripts/tre/build-revisar-deps.ts web/scripts/tre/cli/revisar.ts
git commit -m "feat(s3): revisar-staging.ts + tre:revisar CLI — promote/discard staging rows"
```

---

### Task 18: `geocode-pendentes.ts` + deps + CLI — fase `geocode`

**Files:**
- Create: `web/scripts/tre/geocode-pendentes.ts`
- Create: `web/scripts/tre/geocode-pendentes.test.ts`
- Create: `web/scripts/tre/build-geocode-pendentes-deps.ts`
- Create: `web/scripts/tre/cli/geocode.ts`

**Interfaces:**
- Consumes: `geocodeEndereco`, `esperar` (Task 14)
- Produces: `geocodarPendentes(input: { importacaoId: string; incluirFalhados?: boolean }, deps): Promise<{ total: number; sucesso: number; falha: number }>`; CLI `tre:geocode --importacao <id> [--retry]`

- [ ] **Step 1: Escrever testes**

`web/scripts/tre/geocode-pendentes.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { geocodarPendentes, type GeocodePendentesDeps } from './geocode-pendentes';

function mockFetchSequence(respostas: unknown[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = respostas[i++];
    return { ok: true, json: async () => r };
  }) as unknown as typeof fetch;
}

function makeDeps(overrides: Partial<GeocodePendentesDeps> = {}): GeocodePendentesDeps {
  return {
    listarPendentes: vi.fn(async () => [
      { id: 'local-1', endereco: 'RUA A', cep: '64000000', municipioNome: 'TERESINA', uf: 'PI' },
      { id: 'local-2', endereco: 'RUA B', cep: '64000001', municipioNome: 'TERESINA', uf: 'PI' },
    ]),
    marcarSucesso: vi.fn(async () => {}),
    marcarFalha: vi.fn(async () => {}),
    geocode: { fetchImpl: mockFetchSequence([[{ lat: '-5.0', lon: '-42.8' }], []]), userAgent: 'teste' },
    esperarMs: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('geocodarPendentes', () => {
  it('marca sucesso quando geocode encontra e falha quando não encontra', async () => {
    const deps = makeDeps();
    const r = await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);

    expect(r.total).toBe(2);
    expect(r.sucesso).toBe(1);
    expect(r.falha).toBe(1);
    expect(deps.marcarSucesso).toHaveBeenCalledWith('local-1', -5.0, -42.8);
    expect(deps.marcarFalha).toHaveBeenCalledWith('local-2');
  });

  it('espera entre chamadas mas não depois da última', async () => {
    const deps = makeDeps();
    await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);
    expect(deps.esperarMs).toHaveBeenCalledTimes(1);
  });

  it('por padrão não inclui geo_status=falhou anterior', async () => {
    const deps = makeDeps();
    await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);
    expect(deps.listarPendentes).toHaveBeenCalledWith('importacao-1', false);
  });

  it('--retry inclui falhados anteriores', async () => {
    const deps = makeDeps();
    await geocodarPendentes({ importacaoId: 'importacao-1', incluirFalhados: true }, deps);
    expect(deps.listarPendentes).toHaveBeenCalledWith('importacao-1', true);
  });

  it('lista vazia não chama geocode nem espera', async () => {
    const deps = makeDeps({ listarPendentes: vi.fn(async () => []) });
    const r = await geocodarPendentes({ importacaoId: 'importacao-1' }, deps);
    expect(r).toEqual({ total: 0, sucesso: 0, falha: 0 });
    expect(deps.esperarMs).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/geocode-pendentes.test.ts
```
Esperado: falha com "Cannot find module './geocode-pendentes'".

- [ ] **Step 3: Implementar `geocode-pendentes.ts`**

`web/scripts/tre/geocode-pendentes.ts`:
```typescript
import { geocodeEndereco, type GeocodeDeps } from './geocode';

export interface LocalPendenteGeo {
  id: string;
  endereco: string | null;
  cep: string | null;
  municipioNome: string;
  uf: string;
}

export interface GeocodePendentesDeps {
  listarPendentes(importacaoId: string, incluirFalhados: boolean): Promise<LocalPendenteGeo[]>;
  marcarSucesso(id: string, lat: number, lng: number): Promise<void>;
  marcarFalha(id: string): Promise<void>;
  geocode: GeocodeDeps;
  esperarMs: (ms: number) => Promise<void>;
}

export interface GeocodarPendentesInput {
  importacaoId: string;
  incluirFalhados?: boolean;
}

export interface GeocodarPendentesResultado {
  total: number;
  sucesso: number;
  falha: number;
}

// 1 req/s — política de uso do Nominatim (ADR 0012).
const INTERVALO_MS = 1000;

// Fase "geocode" do pipeline (spec S3, decisão 3): a ÚNICA fase que fala com
// a rede. Reexecutável livremente — só processa geo_status='pendente' por
// padrão; `--retry` também reprocessa 'falhou'.
export async function geocodarPendentes(
  input: GeocodarPendentesInput,
  deps: GeocodePendentesDeps,
): Promise<GeocodarPendentesResultado> {
  const pendentes = await deps.listarPendentes(input.importacaoId, input.incluirFalhados ?? false);

  let sucesso = 0;
  let falha = 0;

  for (let i = 0; i < pendentes.length; i++) {
    const local = pendentes[i];
    const resultado = await geocodeEndereco(
      { endereco: local.endereco, cep: local.cep, municipio: local.municipioNome, uf: local.uf },
      deps.geocode,
    );

    if (resultado) {
      await deps.marcarSucesso(local.id, resultado.lat, resultado.lng);
      sucesso++;
    } else {
      await deps.marcarFalha(local.id);
      falha++;
    }

    if (i < pendentes.length - 1) await deps.esperarMs(INTERVALO_MS);
  }

  return { total: pendentes.length, sucesso, falha };
}
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/geocode-pendentes.test.ts
```

- [ ] **Step 5: Implementar `build-geocode-pendentes-deps.ts`**

`web/scripts/tre/build-geocode-pendentes-deps.ts`:
```typescript
import { adminClient } from '../../lib/supabase/server';
import { esperar } from './geocode';
import type { GeocodePendentesDeps } from './geocode-pendentes';

export function buildGeocodePendentesDeps(): GeocodePendentesDeps {
  const admin = adminClient();

  return {
    async listarPendentes(importacaoId, incluirFalhados) {
      const statusAlvo = incluirFalhados ? ['pendente', 'falhou'] : ['pendente'];
      const { data, error } = await admin
        .from('local_votacao')
        .select('id, endereco, cep, importacao_tre:importacao_id(municipio:municipio_id(nome, uf))')
        .eq('importacao_id', importacaoId)
        .in('geo_status', statusAlvo);
      if (error) throw error;

      return (data ?? []).map((r) => {
        const municipio = (r.importacao_tre as unknown as { municipio: { nome: string; uf: string } }).municipio;
        return { id: r.id, endereco: r.endereco, cep: r.cep, municipioNome: municipio.nome, uf: municipio.uf };
      });
    },

    async marcarSucesso(id, lat, lng) {
      const { error } = await admin
        .from('local_votacao')
        .update({ geo: `SRID=4326;POINT(${lng} ${lat})`, geo_status: 'sucesso' })
        .eq('id', id);
      if (error) throw error;
    },

    async marcarFalha(id) {
      const { error } = await admin.from('local_votacao').update({ geo_status: 'falhou' }).eq('id', id);
      if (error) throw error;
    },

    geocode: { fetchImpl: fetch, userAgent: 'campanha-app-tre-ingest/1.0' },
    esperarMs: esperar,
  };
}
```

- [ ] **Step 6: Implementar CLI `cli/geocode.ts`**

`web/scripts/tre/cli/geocode.ts`:
```typescript
import { parseArgs } from 'node:util';
import { geocodarPendentes } from '../geocode-pendentes';
import { buildGeocodePendentesDeps } from '../build-geocode-pendentes-deps';

const { values } = parseArgs({
  options: {
    importacao: { type: 'string' },
    retry: { type: 'boolean', default: false },
  },
});

if (!values.importacao) {
  console.error('uso: tre:geocode --importacao <id> [--retry]');
  process.exit(1);
}

geocodarPendentes(
  { importacaoId: values.importacao, incluirFalhados: values.retry },
  buildGeocodePendentesDeps(),
)
  .then((r) => {
    console.log(`geocode: total=${r.total} sucesso=${r.sucesso} falha=${r.falha}`);
  })
  .catch((err) => {
    console.error('erro no geocode:', err);
    process.exit(1);
  });
```

- [ ] **Step 7: Commit**

```bash
git add web/scripts/tre/geocode-pendentes.ts web/scripts/tre/geocode-pendentes.test.ts web/scripts/tre/build-geocode-pendentes-deps.ts web/scripts/tre/cli/geocode.ts
git commit -m "feat(s3): geocode-pendentes.ts + tre:geocode CLI — separate reexecutable geocode phase"
```

---

### Task 19: `lote.ts` + deps + CLIs — fases `publicar`/`despublicar`/`stats`

**Files:**
- Create: `web/scripts/tre/lote.ts`
- Create: `web/scripts/tre/lote.test.ts`
- Create: `web/scripts/tre/build-lote-deps.ts`
- Create: `web/scripts/tre/cli/publicar.ts`
- Create: `web/scripts/tre/cli/despublicar.ts`
- Create: `web/scripts/tre/cli/stats.ts`

**Interfaces:**
- Consumes: RPC `detectar_reconciliacao_bairro` (Task 9)
- Produces: `publicarLote`, `despublicarLote`, `listarLotes`; CLIs `tre:publicar --importacao <id>`, `tre:despublicar --importacao <id>`, `tre:stats`

- [ ] **Step 1: Escrever testes**

`web/scripts/tre/lote.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { publicarLote, despublicarLote, listarLotes, type LoteDeps } from './lote';

function makeDeps(overrides: Partial<LoteDeps> = {}): LoteDeps {
  return {
    buscarLote: vi.fn(async () => ({ status: 'pendente_revisao', municipioId: 2211001, ano: 2026 })),
    atualizarStatus: vi.fn(async () => {}),
    detectarReconciliacao: vi.fn(async () => 0),
    listarLotes: vi.fn(async () => []),
    ...overrides,
  };
}

describe('publicarLote', () => {
  it('publica lote em pendente_revisao e roda detecção de reconciliação', async () => {
    const deps = makeDeps({ detectarReconciliacao: vi.fn(async () => 2) });
    const r = await publicarLote('lote-1', deps);

    expect(r.alertasReconciliacao).toBe(2);
    expect(deps.detectarReconciliacao).toHaveBeenCalledWith('lote-1');
    expect(deps.atualizarStatus).toHaveBeenCalledWith('lote-1', 'publicado', expect.any(String));
  });

  it('lança se o lote não está em pendente_revisao', async () => {
    const deps = makeDeps({
      buscarLote: vi.fn(async () => ({ status: 'publicado', municipioId: 2211001, ano: 2026 })),
    });
    await expect(publicarLote('lote-1', deps)).rejects.toThrow('só pode publicar');
    expect(deps.atualizarStatus).not.toHaveBeenCalled();
  });

  it('lança se o lote não existe', async () => {
    const deps = makeDeps({ buscarLote: vi.fn(async () => null) });
    await expect(publicarLote('inexistente', deps)).rejects.toThrow('lote não encontrado');
  });
});

describe('despublicarLote', () => {
  it('arquiva lote publicado', async () => {
    const deps = makeDeps({
      buscarLote: vi.fn(async () => ({ status: 'publicado', municipioId: 2211001, ano: 2026 })),
    });
    await despublicarLote('lote-1', deps);
    expect(deps.atualizarStatus).toHaveBeenCalledWith('lote-1', 'arquivado');
  });

  it('lança se o lote não está publicado', async () => {
    const deps = makeDeps({
      buscarLote: vi.fn(async () => ({ status: 'pendente_revisao', municipioId: 2211001, ano: 2026 })),
    });
    await expect(despublicarLote('lote-1', deps)).rejects.toThrow('só pode despublicar');
  });
});

describe('listarLotes', () => {
  it('delega para deps.listarLotes', async () => {
    const deps = makeDeps({ listarLotes: vi.fn(async () => [{ id: 'x' } as never]) });
    const r = await listarLotes(deps);
    expect(r).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run scripts/tre/lote.test.ts
```
Esperado: falha com "Cannot find module './lote'".

- [ ] **Step 3: Implementar `lote.ts`**

`web/scripts/tre/lote.ts`:
```typescript
export interface LoteResumo {
  status: string;
  municipioId: number;
  ano: number;
}

export interface LoteListagem {
  id: string;
  municipioId: number;
  ano: number;
  status: string;
  totalPublicados: number | null;
  totalStaging: number | null;
  totalErros: number | null;
  publicadoEm: string | null;
}

export interface LoteDeps {
  buscarLote(importacaoId: string): Promise<LoteResumo | null>;
  atualizarStatus(importacaoId: string, status: string, publicadoEm?: string): Promise<void>;
  detectarReconciliacao(importacaoId: string): Promise<number>;
  listarLotes(): Promise<LoteListagem[]>;
}

// Fase "publicar" (spec S3, decisão 2 e 15): torna o lote visível pra
// campanhas (RLS liga em status='publicado') e dispara a checagem de
// reconciliação (ADR 0017). Não exige staging zerado nem geocode completo —
// publicar é sobre liberar o que já foi curado, não terminar 100% da revisão.
export async function publicarLote(importacaoId: string, deps: LoteDeps): Promise<{ alertasReconciliacao: number }> {
  const lote = await deps.buscarLote(importacaoId);
  if (!lote) throw new Error(`lote não encontrado: ${importacaoId}`);
  if (lote.status !== 'pendente_revisao') {
    throw new Error(`lote está em '${lote.status}', só pode publicar a partir de 'pendente_revisao'`);
  }

  const alertasReconciliacao = await deps.detectarReconciliacao(importacaoId);
  await deps.atualizarStatus(importacaoId, 'publicado', new Date().toISOString());

  return { alertasReconciliacao };
}

// Libera o índice único parcial (município+ano) pra um novo lote ser publicado.
export async function despublicarLote(importacaoId: string, deps: LoteDeps): Promise<void> {
  const lote = await deps.buscarLote(importacaoId);
  if (!lote) throw new Error(`lote não encontrado: ${importacaoId}`);
  if (lote.status !== 'publicado') {
    throw new Error(`lote está em '${lote.status}', só pode despublicar a partir de 'publicado'`);
  }
  await deps.atualizarStatus(importacaoId, 'arquivado');
}

export async function listarLotes(deps: LoteDeps): Promise<LoteListagem[]> {
  return deps.listarLotes();
}
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run scripts/tre/lote.test.ts
```

- [ ] **Step 5: Implementar `build-lote-deps.ts`**

`web/scripts/tre/build-lote-deps.ts`:
```typescript
import { adminClient } from '../../lib/supabase/server';
import type { LoteDeps } from './lote';

export function buildLoteDeps(): LoteDeps {
  const admin = adminClient();

  return {
    async buscarLote(importacaoId) {
      const { data, error } = await admin
        .from('importacao_tre')
        .select('status, municipio_id, ano')
        .eq('id', importacaoId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { status: data.status, municipioId: data.municipio_id, ano: data.ano };
    },

    async atualizarStatus(importacaoId, status, publicadoEm) {
      const payload: Record<string, unknown> = { status };
      if (publicadoEm) payload.publicado_em = publicadoEm;
      const { error } = await admin.from('importacao_tre').update(payload).eq('id', importacaoId);
      if (error) throw error;
    },

    async detectarReconciliacao(importacaoId) {
      const { data, error } = await admin.rpc('detectar_reconciliacao_bairro', { p_importacao_id: importacaoId });
      if (error) throw error;
      return (data as number) ?? 0;
    },

    async listarLotes() {
      const { data, error } = await admin
        .from('importacao_tre')
        .select('id, municipio_id, ano, status, total_publicados, total_staging, total_erros, publicado_em')
        .order('iniciado_em', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        municipioId: r.municipio_id,
        ano: r.ano,
        status: r.status,
        totalPublicados: r.total_publicados,
        totalStaging: r.total_staging,
        totalErros: r.total_erros,
        publicadoEm: r.publicado_em,
      }));
    },
  };
}
```

- [ ] **Step 6: Implementar as 3 CLIs**

`web/scripts/tre/cli/publicar.ts`:
```typescript
import { parseArgs } from 'node:util';
import { publicarLote } from '../lote';
import { buildLoteDeps } from '../build-lote-deps';

const { values } = parseArgs({ options: { importacao: { type: 'string' } } });
if (!values.importacao) {
  console.error('uso: tre:publicar --importacao <id>');
  process.exit(1);
}

publicarLote(values.importacao, buildLoteDeps())
  .then((r) => console.log(`lote ${values.importacao} publicado. alertas de reconciliação gerados: ${r.alertasReconciliacao}`))
  .catch((err) => {
    console.error('erro ao publicar:', err);
    process.exit(1);
  });
```

`web/scripts/tre/cli/despublicar.ts`:
```typescript
import { parseArgs } from 'node:util';
import { despublicarLote } from '../lote';
import { buildLoteDeps } from '../build-lote-deps';

const { values } = parseArgs({ options: { importacao: { type: 'string' } } });
if (!values.importacao) {
  console.error('uso: tre:despublicar --importacao <id>');
  process.exit(1);
}

despublicarLote(values.importacao, buildLoteDeps())
  .then(() => console.log(`lote ${values.importacao} arquivado`))
  .catch((err) => {
    console.error('erro ao despublicar:', err);
    process.exit(1);
  });
```

`web/scripts/tre/cli/stats.ts`:
```typescript
import { listarLotes } from '../lote';
import { buildLoteDeps } from '../build-lote-deps';

listarLotes(buildLoteDeps())
  .then((lotes) => {
    if (lotes.length === 0) {
      console.log('nenhum lote importado ainda.');
      return;
    }
    for (const l of lotes) {
      console.log(
        `${l.id} — municipio=${l.municipioId} ano=${l.ano} status=${l.status} ` +
        `publicados=${l.totalPublicados ?? '-'} staging=${l.totalStaging ?? '-'} erros=${l.totalErros ?? '-'} ` +
        `publicado_em=${l.publicadoEm ?? '-'}`,
      );
    }
  })
  .catch((err) => {
    console.error('erro ao listar lotes:', err);
    process.exit(1);
  });
```

- [ ] **Step 7: Verificação ponta-a-ponta do ciclo publicar/despublicar**

```bash
cd web && npm run tre:ingest -- --csv scripts/tre/__fixtures__/tre-sample.csv --municipio 2211001 --ano 2029 --operador teste-task19
```
Guardar `<importacao_task19>`.

```bash
cd web && npm run tre:publicar -- --importacao <importacao_task19>
```
Esperado: `lote <id> publicado. alertas de reconciliação gerados: 0`.

Via `execute_sql`:
```sql
SELECT status FROM public.importacao_tre WHERE id = '<importacao_task19>';
-- esperado: 'publicado'
```

```bash
cd web && npm run tre:stats
```
Esperado: lista o lote `2029` com `status=publicado`.

```bash
cd web && npm run tre:despublicar -- --importacao <importacao_task19>
```
Esperado: `lote <id> arquivado`.

```sql
SELECT status FROM public.importacao_tre WHERE id = '<importacao_task19>';
-- esperado: 'arquivado'
```

- [ ] **Step 8: Limpar dados de teste**

```sql
DELETE FROM public.secao WHERE local_id IN (SELECT id FROM public.local_votacao WHERE importacao_id = '<importacao_task19>');
DELETE FROM public.local_votacao WHERE importacao_id = '<importacao_task19>';
DELETE FROM public.local_votacao_staging WHERE importacao_id = '<importacao_task19>';
DELETE FROM public.importacao_tre WHERE id = '<importacao_task19>';
```

- [ ] **Step 9: Commit**

```bash
git add web/scripts/tre/lote.ts web/scripts/tre/lote.test.ts web/scripts/tre/build-lote-deps.ts web/scripts/tre/cli/publicar.ts web/scripts/tre/cli/despublicar.ts web/scripts/tre/cli/stats.ts
git commit -m "feat(s3): lote.ts + tre:publicar/tre:despublicar/tre:stats CLIs"
```

---

### Task 20: Run real com o CSV de produção + README + verificação final

**Files:**
- Create: `web/scripts/tre/README.md`

**Interfaces:**
- Consumes: pipeline completo (Tasks 11–19)
- Produces: dado real de Teresina 2026 ingerido (`status='pendente_revisao'`, aguardando revisão humana do Superadmin — **não publicado automaticamente**, ver decisão 2 do spec); documentação operacional do pipeline

- [ ] **Step 1: Confirmar `bairro_oficial` semeado com o JSON real completo**

```bash
cd web && npm run tre:seed-bairros -- --json "D:\projeto-pol-superpowers\bairros_teresina_final.json" --municipio 2211001
```
Idempotente (upsert) — seguro rodar de novo mesmo já tendo rodado na Task 15.

Via `execute_sql`:
```sql
SELECT count(*) FROM public.bairro_oficial WHERE municipio_id = 2211001;
```
Esperado: contagem que bate com o total de entradas do JSON (`bairros_teresina_final.json` tem 403 linhas de arquivo, menos as chaves de região — confirmar o número exato impresso pelo comando acima).

- [ ] **Step 2: `tre:dry-run` no CSV real completo (3556 linhas) — sanity check sem gravar**

```bash
cd web && npm run tre:dry-run -- --csv "D:\projeto-pol-superpowers\4a-ad1b-420e-9d99-aa785ee2386b.csv" --municipio 2211001 --ano 2026
```
Esperado: `[dry-run] linhas=3556 importaria=<N> staging=<M> erros=<E>` com `N+M+E=3556`. Registrar os números no relatório da task — servem de baseline para o Step 3.

Via `execute_sql`:
```sql
SELECT count(*) FROM public.importacao_tre WHERE municipio_id = 2211001 AND ano = 2026;
```
Esperado: `0` (dry-run confirmado que não grava).

- [ ] **Step 3: `tre:ingest` real — cria o lote de produção**

```bash
cd web && npm run tre:ingest -- --csv "D:\projeto-pol-superpowers\4a-ad1b-420e-9d99-aa785ee2386b.csv" --municipio 2211001 --ano 2026 --operador "$(whoami)"
```
Esperado: contadores finais iguais aos do dry-run (`Step 2`); imprime `importacao <uuid>: ...`. Guardar `<importacao_producao>`.

- [ ] **Step 4: Verificar dado real via `execute_sql`**

```sql
SELECT status, total_linhas, total_publicados, total_staging, total_erros, arquivo_sha256
  FROM public.importacao_tre WHERE id = '<importacao_producao>';
-- esperado: status='pendente_revisao'; total_linhas=3556; soma dos 3 totais = 3556

-- spot-check: local do exemplo real do spec (AEROPORTO DE TERESINA, sem geo)
SELECT nome, tipo, situacao, geo_status, elegivel_calor
  FROM public.local_votacao
 WHERE importacao_id = '<importacao_producao>' AND nome ILIKE 'AEROPORTO DE TERESINA%';
-- esperado: tipo='transito', geo_status='pendente' (sem lat/long no CSV), elegivel_calor=false

-- distribuição de geo_status
SELECT geo_status, count(*) FROM public.local_votacao
 WHERE importacao_id = '<importacao_producao>' GROUP BY geo_status;

-- quantas linhas de staging por motivo
SELECT unnest(motivos) AS motivo, count(*) FROM public.local_votacao_staging
 WHERE importacao_id = '<importacao_producao>' GROUP BY motivo ORDER BY count(*) DESC;
```

**Nota importante:** o lote fica em `pendente_revisao` — geocode (`tre:geocode`) e publicação (`tre:publicar`) do dado real são decisões operacionais do Superadmin (revisar staging, decidir se roda geocode nos locais sem lat/long, só então publicar), não passos automáticos desta task. Isso está alinhado com a ADR 0011 ("revisão antes de publicar") e com a decisão 2 do spec.

- [ ] **Step 5: `get_advisors(security)` final — sem alertas novos desde a Task 9**

Via MCP `mcp__supabase__get_advisors` com `{ "type": "security" }`.

- [ ] **Step 6: Escrever README operacional**

`web/scripts/tre/README.md`:
```markdown
# Ingestão TRE — pipeline em fases

Pipeline curado de importação do cadastro oficial do TRE (locais de votação,
seções, aptos) — Superadmin only, roda via CLI server-side (nunca no browser).
Env necessário: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (ver
`web/lib/supabase/server.ts#adminClient`).

## Fases (nesta ordem)

1. `npm run tre:seed-bairros -- --json <bairros.json> --municipio <cod_ibge>`
   Carrega/atualiza `bairro_oficial` a partir do JSON oficial de bairros.
   Idempotente — seguro rodar de novo.

2. `npm run tre:dry-run -- --csv <arquivo.csv> --municipio <cod_ibge> --ano <ano>`
   Parseia + casa bairro **sem gravar nada**. Mostra quantas linhas
   virariam `local_votacao`, quantas ficariam em staging e quantas dariam
   erro de parse. Rode sempre antes do `tre:ingest` real.

3. `npm run tre:ingest -- --csv <arquivo.csv> --municipio <cod_ibge> --ano <ano> [--limiar 0.4] [--operador nome]`
   Cria o lote (`importacao_tre`), parseia, casa bairro, insere
   `local_votacao`/`secao` (bairro casado) ou `local_votacao_staging`
   (sem match / erro de parse). **Não geocodifica, não publica.** Termina em
   `status='pendente_revisao'`.

4. `npm run tre:revisar [-- --importacao <id>]`
   Lista staging pendente. Para resolver uma linha:
   `npm run tre:revisar -- --id <staging_id> --bairro-oficial-id <id>` (promove)
   ou `npm run tre:revisar -- --id <staging_id> --descartar` (descarta).

5. `npm run tre:geocode -- --importacao <id> [--retry]`
   Geocodifica (Nominatim/OSM, 1 req/s) os locais com `geo_status='pendente'`
   do lote. `--retry` também reprocessa quem falhou antes. Reexecutável
   livremente — nunca roda dentro do `ingest`.

6. `npm run tre:publicar -- --importacao <id>`
   Torna o lote visível pras campanhas (RLS liga em `status='publicado'`) e
   dispara a checagem de reconciliação de bairro (ADR 0017). Exige o lote em
   `pendente_revisao`. Falha se já existe outro lote `publicado` do mesmo
   município+ano — rode `tre:despublicar` no antigo primeiro.

7. `npm run tre:despublicar -- --importacao <id>`
   Arquiva um lote publicado (`'publicado' → 'arquivado'`), liberando o
   município+ano pra um novo `tre:publicar`.

`npm run tre:stats` lista todos os lotes e seus contadores a qualquer momento.

## Decisões que valem lembrar

- CSV do TRE é **Latin-1/CP1252**, nunca UTF-8 — decodificado automaticamente,
  não precisa converter o arquivo antes.
- `COD_BAIRRO` do CSV é sempre ignorado (lixo — ADR 0011); o casamento de
  bairro é só por nome normalizado (`pg_trgm` + `unaccent`, limiar padrão 0.4).
- Local sem bairro casado nunca aparece em `local_votacao` — só em
  `local_votacao_staging`, até revisão manual.
- `elegivel_calor` (mapa de calor do S4) não depende de `geo`/`geo_status`.
- Mapas de calor, mapa de apoiadores por CEP e "voto por local" **não fazem
  parte desta fatia** — ver seção "Notas para S4 e além" do spec
  (`docs/superpowers/specs/2026-06-30-s3-ingestao-tre-design.md`).
```

- [ ] **Step 7: Commit**

```bash
git add web/scripts/tre/README.md
git commit -m "docs(s3): TRE pipeline README + real ingest of Teresina 2026 (pendente_revisao)"
```

- [ ] **Step 8: Atualizar memória do projeto**

Registrar em memória (`projeto-campanha-s0-feito.md` ou memória equivalente): S3 (Ingestão TRE) completo na branch `s3-ingestao-tre` — schema global (`municipio`/`zona_eleitoral`/`bairro_oficial`/`importacao_tre`/`local_votacao`/`secao`/`local_votacao_staging`) + overlay `bairro_local` + reconciliação (ADR 0017) + pipeline CLI em fases (`seed-bairros→dry-run→ingest→revisar→geocode→publicar→despublicar`); dado real de Teresina 2026 ingerido e aguardando revisão do Superadmin antes de publicar. Próximo: S4 — Mapa de calor (depende de S2+S3, ADR 0005/0006/0012).

---

## Verificação final (cross-referência com o spec)

Os 24 itens de "Testes (critério de pronto)" do spec
(`docs/superpowers/specs/2026-06-30-s3-ingestao-tre-design.md`) já foram
cobertos incrementalmente dentro das tasks acima — não há uma task única de
"E2E" separada nesta fatia porque cada task de schema/script já embute sua
própria verificação via `execute_sql` ou Vitest. Checklist de conferência:

- [ ] Itens 1–6 (funções puras) — Tasks 11, 13
- [ ] Item 7 (parse CSV + fixture) — Task 12
- [ ] Itens 8–9 (`match_bairro_oficial`, `elegivel_calor`) — Task 6, Task 16 (Step 10)
- [ ] Item 10 (bairro sem match → staging, `bairro_oficial_id NOT NULL`) — Task 4 (Step 5), Task 16 (Step 10)
- [ ] Item 11 (índice único parcial) — Task 3 (Steps 4–5)
- [ ] Item 12 (RLS) — Task 7
- [ ] Item 13 (`bairro_local` isolamento) — Task 8 (Step 4)
- [ ] Itens 14–15 (reconciliação) — Task 9
- [ ] Item 16 (FK `pessoa.secao_id`) — Task 10
- [ ] Item 17 (constraints) — Tasks 4, 5
- [ ] Item 18 (`get_advisors`) — Tasks 7, 9, 20
- [ ] Itens 19–24 (integração dos scripts) — Tasks 16, 17, 18, 19, 20

