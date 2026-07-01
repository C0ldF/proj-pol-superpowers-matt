# S3 — Ingestão TRE (Superadmin)

Data: 2026-06-30
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Paralela ao S2 (já
merjado), depende só do S0 (extensão PostGIS habilitada, `extensions.postgis`).
ADRs cobertos: 0002, 0011, 0017, 0019.

## Objetivo

Construir o pipeline curado que importa o cadastro oficial do TRE (locais de
votação, seções, aptos) para tabelas globais relacionais, casando cada local
com um bairro oficial, geocodificando o que faltar, e calculando elegibilidade
de calor — dado de referência que o S4 (mapa de calor) vai consumir. Ao término
do S3 o Superadmin consegue rodar `tre:ingest` sobre o CSV real de um
município, revisar o que ficou pendente em `tre:revisar`, e `pessoa.secao_id`
(coluna solta desde o S2) ganha FK real.

## Decisões desta fatia

1. **Execução via script Node server-side, sem painel web.** S1 nunca criou
   login/painel de Superadmin (deferido); em vez de criar essa dependência
   agora, a ingestão roda por CLI (`tsx`) usando `adminClient()`
   (`service_role`, já existe em `web/lib/supabase/server.ts`). Comandos:
   `tre:seed-bairros`, `tre:ingest --csv <path> --municipio <cod_ibge> --ano
   <ano>`, `tre:revisar`.
2. **Encoding do CSV é Latin-1/CP1252, não UTF-8.** Confirmado por inspeção do
   arquivo real (`4a-ad1b-420e-9d99-aa785ee2386b.csv`): acentos corrompem
   quando lido como UTF-8 (`TR�NSITO`, `CENTEN�RIO`). `parse-csv.ts` decodifica
   explicitamente como `latin1` via `iconv-lite`.
3. **Parser respeita aspas** (`csv-parse`, nunca `split(',')`) — o campo
   `SECOES` carrega vírgulas dentro de aspas: `"(s: 469, apt: 0), (s: 546, apt:
   0)"`.
4. **Fuzzy match de bairro roda no Postgres** (`pg_trgm` + `unaccent`), não em
   JS — reaproveitado tanto no match TRE↔`bairro_oficial` quanto na detecção de
   reconciliação (ADR 0017), e mais barato que Levenshtein em JS para 3556+
   linhas.
5. **Curadoria "tudo ou staging" no casamento de bairro.** Local cujo `BAIRRO`
   do CSV não casa (`similarity < 0.4`) contra `bairro_oficial` **não entra em
   `local_votacao`** — fica só em `local_votacao_staging` até o Superadmin
   resolver manualmente (`tre:revisar`), que promove a linha.
6. **Geocode real via Nominatim/OSM quando lat/long faltam.** Sem custo, sem
   API key, alinhado à escolha OSM da ADR 0012. Rate-limit 1 req/s, timeout +
   fallback para `NULL`, `User-Agent` próprio. Sucesso → `geo_aproximado =
   true`; falha → `geo = NULL`, local ainda pode entrar em `local_votacao` (se
   o bairro casou) mas fica fora do mapa até correção manual.
7. **`elegivel_calor` independe de `geo`.** Calculada só por
   TIPO/SITUACAO/aptos (regra 1 da ADR 0011) no INSERT — um local pode ser
   elegível e ainda assim invisível no mapa até ganhar geo.
8. **Versionamento por (município, ano) com índice único parcial.** Só um lote
   pode estar `publicado` por município+ano por vez
   (`UNIQUE (municipio_id, ano) WHERE status = 'publicado'`). Reimportar
   (correção) exige primeiro arquivar/despublicar o lote antigo manualmente —
   sem fluxo automático de substituição nesta fatia.
9. **`municipio`, `zona_eleitoral`, `bairro_oficial` são dimensões estáveis**
   (upsert idempotente por chave natural, não versionadas por importação).
   `local_votacao`/`secao` são fato, versionado via `importacao_id`.
10. **`COD_BAIRRO` do CSV nunca é lido nem armazenado**, nem em staging (ADR
    0011 — lixo inconsistente). Vínculo de bairro é só por nome normalizado.
11. **Mecânica de reconciliação (ADR 0017) construída nesta fatia**, mesmo sem
    dado real pra disparar ainda (é o primeiro import oficial — nenhuma
    campanha tem `bairro_local` própria ainda). `detectar_reconciliacao_bairro`
    roda no publish de qualquer lote futuro; a função de resolução
    (`resolver_reconciliacao_bairro`) existe pronta, sem UI (painel Superadmin
    não existe ainda).
12. **Campos extras do CSV real** (`QTD_CANCELADOS`, `QTD_SUSPENSOS`,
    `QTD_VAGAS_RESERVADAS`, `QTD_BASE_HISTORICA`, `TELEFONE`, `DATA_CRIACAO`)
    são armazenados em `local_votacao` para auditoria, fora das regras de
    negócio desta fatia.
13. **`pessoa.secao_id` ganha FK real** para `secao(id)` na última migration —
    coluna existe solta desde a 0014 (S2), comentário no schema já apontava
    pro S3.

## Não-objetivos

- Painel Superadmin web / login Superadmin → depende de auth que o S1 deferiu;
  roadmap posterior.
- UI de resolução de staging e de reconciliação de bairro → cobertas por CLI
  nesta fatia; tela fica para quando o painel Superadmin existir.
- **Re-apontamento de apoiadores ao fundir bairro (ADR 0017).**
  `resolver_reconciliacao_bairro('fundido')` marca `bairro_local.status =
  'fundido'` mas **não move nenhuma Pessoa** — a tabela `pessoa` (S2) não tem
  coluna de bairro (`bairro_local_id`/`bairro_oficial_id`), só `secao_id`. Essa
  lacuna é do S2, não desta fatia; fica registrada aqui para quando Pessoa
  ganhar endereço estruturado.
- Mapas de calor (Força/Potencial/Penetração), MapLibre/OSM, agregação por
  Abrangência → **S4** (ADR 0005/0006/0012), consome os dados desta fatia
  (`local_votacao.geo`, `secao.aptos`, `elegivel_calor`). Cobre o pedido de
  "mapa por zona de votação / qtde eleitor por local".
- Mapa de concentração de apoiadores por CEP residencial → nenhuma ADR cobre
  hoje geocodificação residencial nem uma camada de heat point de apoiador;
  Pessoa (S2) também não tem endereço/CEP estruturado ainda. Fica como nota de
  roadmap para o S4 (camada extra) ou fatia própria — decisão fica pra quando
  o S4 for especificado.
- "Voto por local" (resultado eleitoral por local de votação) → dado
  inexistente em qualquer ADR ou no CSV atual (é cadastro de local, não
  boletim de urna). Exige nova fonte (TSE resultados) e provavelmente ADR
  nova; fora de escopo até essa decisão ser tomada.
- Substituição/arquivamento automático de lote publicado → manual nesta fatia.

## Dado de entrada

### CSV do TRE (real, `4a-ad1b-420e-9d99-aa785ee2386b.csv`, 3556 linhas)

Colunas reais (header inspecionado, difere um pouco do resumo original):
`UF, COD_LOCALIDADE_TSE_ZONA, COD_LOCALIDADE_IBGE_ZONA, LOCALIDADE_ZONA,
COD_LOCALIDADE_TSE, COD_LOCALIDADE_IBGE, LOCALIDADE, ZONA,
TIPO_LOCAL_VOTACAO, SITUACAO_LOCAL_VOTACAO, NUM_LOCAL, DATA_CRIACAO,
LOCAL_VOTACAO, TELEFONE, ENDERECO, COD_BAIRRO, BAIRRO, CEP, LATITUDE,
LONGITUDE, QTD_SECOES, SECOES, QTD_APTOS, QTD_CANCELADOS, QTD_SUSPENSOS,
QTD_VAGAS_RESERVADAS, QTD_BASE_HISTORICA`

Exemplos reais (decodificados):

```
PI,...,TERESINA,1,VOTO EM TRÂNSITO,ATIVO,2500,...,AEROPORTO DE TERESINA,,
"AV CENTENÁRIO, S/N",...,AEROPORTO,"64006700",,,2,
"(s: 469, apt: 0), (s: 546, apt: 0)",0,0,0,0,0

PI,...,TERESINA,1,CONVENCIONAL,ATIVO,2011,...,
"CCL - CENTRO CULTURAL DE LINGUAS PADRE RAIMUNDO JOSÉ","RUA PRIMEIRO DE
MAIO, 2371",...,AEROPORTO,"64002510",-5.067541,-42.8138009,7,
"(s: 185, apt: 253), (s: 186, apt: 258), ...",1795,419,8,0,0
```

Confirma: `LATITUDE`/`LONGITUDE` vazios em local de trânsito (caso real de geo
ausente); `SECOES` tem formato `"(s: N, apt: M), ..."`; `COD_BAIRRO` é lixo
(`"0019802202000479"`, não é um código real de bairro).

### `bairros_teresina_final.json` (403 linhas)

Agrupado por região (`regiao_central`, `zona_norte`, ...), cada entrada
`{ "bairro": "Nome" }`. Vira `bairro_oficial.regiao` + `bairro_oficial.nome`.

## Schema

### Novos enums (migration 0024)

- **`tipo_local_enum`**: `convencional | transito | preso_provisorio | outro`
- **`situacao_local_enum`**: `ativo | bloqueado`
- **`status_importacao_enum`**: `pendente | processando | publicado | erro`
- **`status_bairro_local_enum`**: `pendente | confirmado | fundido`
- **`status_reconciliacao_enum`**: `fundido | mantido_separado`

### Extensões (migration 0023)

`pg_trgm`, `unaccent` — `with schema extensions` (mesmo padrão de
`extensions.postgis` do S0).

### Tabela `municipio`

| coluna | tipo | nota |
|---|---|---|
| `cod_ibge` | integer PK | ex.: `2211001` (Teresina) |
| `nome` | text not null | |
| `uf` | char(2) not null | |
| `criado_em` | timestamptz not null default now() | |

### Tabela `zona_eleitoral`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `municipio_id` | integer not null FK → `municipio(cod_ibge)` | |
| `numero` | integer not null | |
| `nome` | text | CSV não traz nome de zona; fica nullable |
| `criado_em` | timestamptz not null default now() | |

`UNIQUE (municipio_id, numero)`.

### Tabela `bairro_oficial`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `municipio_id` | integer not null FK → `municipio(cod_ibge)` | |
| `nome` | text not null | do JSON `bairros_teresina_final.json` |
| `nome_normalizado` | text not null | `normalizar_texto(nome)` |
| `regiao` | text | chave do JSON (`regiao_central`, `zona_norte`, ...) |
| `criado_em` | timestamptz not null default now() | |

`UNIQUE (municipio_id, nome_normalizado)`.

### Tabela `importacao_tre` (lote)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `municipio_id` | integer not null FK → `municipio(cod_ibge)` | |
| `uf` | char(2) not null | |
| `ano` | integer not null | |
| `status` | `status_importacao_enum` not null default `'pendente'` | |
| `arquivo_nome` | text | nome do CSV original |
| `total_linhas` | integer | |
| `total_publicados` | integer | linhas que viraram `local_votacao` |
| `total_staging` | integer | linhas que ficaram em `local_votacao_staging` |
| `total_erros` | integer | linhas com erro de parse (nem staging) |
| `operador` | text | identificador de quem rodou o script (não é `auth.users` — Superadmin não loga) |
| `log` | jsonb | resumo de erros/avisos |
| `iniciado_em` | timestamptz not null default now() | |
| `publicado_em` | timestamptz | null até publicar |

`UNIQUE INDEX ux_importacao_publicado ON importacao_tre (municipio_id, ano)
WHERE status = 'publicado'` — só um lote vigente por município+ano.

### Tabela `local_votacao`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `importacao_id` | uuid not null FK → `importacao_tre(id)` | |
| `zona_id` | uuid not null FK → `zona_eleitoral(id)` | |
| `bairro_oficial_id` | uuid FK → `bairro_oficial(id)` | nullable só por integridade; nesta fatia só entra aqui se casou (decisão 5) |
| `bairro_nome_original` | text not null | `BAIRRO` bruto do CSV, auditoria |
| `num_local` | integer not null | `NUM_LOCAL` |
| `nome` | text not null | `LOCAL_VOTACAO` |
| `endereco` | text | `ENDERECO` |
| `cep` | text | só dígitos |
| `geo` | `extensions.geometry(Point, 4326)` | nullable |
| `geo_aproximado` | boolean not null default false | true se veio de geocode, não do CSV |
| `tipo` | `tipo_local_enum` not null | mapeado de `TIPO_LOCAL_VOTACAO` |
| `situacao` | `situacao_local_enum` not null | mapeado de `SITUACAO_LOCAL_VOTACAO` |
| `qtd_aptos` | integer not null default 0 | `QTD_APTOS` |
| `qtd_cancelados` | integer | `QTD_CANCELADOS` |
| `qtd_suspensos` | integer | `QTD_SUSPENSOS` |
| `qtd_vagas_reservadas` | integer | `QTD_VAGAS_RESERVADAS` |
| `qtd_base_historica` | integer | `QTD_BASE_HISTORICA` |
| `telefone` | text | `TELEFONE` |
| `data_criacao_tre` | timestamptz | `DATA_CRIACAO` |
| `elegivel_calor` | boolean not null default false | regra 1, calculada no insert |
| `criado_em` | timestamptz not null default now() | |

`UNIQUE (importacao_id, num_local)`. Índice GIST em `geo`
(`idx_local_votacao_geo`).

### Tabela `secao`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `local_id` | uuid not null FK → `local_votacao(id) ON DELETE CASCADE` | |
| `numero` | integer not null | `s:` do parse de `SECOES` |
| `aptos` | integer not null default 0 | `apt:` do parse de `SECOES` |

`UNIQUE (local_id, numero)`.

### Tabela `local_votacao_staging`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `importacao_id` | uuid not null FK → `importacao_tre(id)` | |
| `linha_original` | jsonb not null | linha crua do CSV (parseada), pra reprocessar |
| `motivo` | text not null | `'bairro_sem_match'` \| `'erro_parse'` |
| `revisado` | boolean not null default false | |
| `resolvido_bairro_oficial_id` | uuid FK → `bairro_oficial(id)` | preenchido na revisão |
| `revisado_em` | timestamptz | |
| `revisado_por` | text | |
| `criado_em` | timestamptz not null default now() | |

### Tabela `bairro_local` (overlay de campanha)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `campanha_id` | uuid not null FK → `campanha(id)` | isolamento RLS |
| `nome` | text not null | |
| `nome_normalizado` | text not null | |
| `bairro_oficial_sugerido_id` | uuid FK → `bairro_oficial(id)` | sugestão de fuzzy match na criação |
| `status` | `status_bairro_local_enum` not null default `'pendente'` | |
| `criado_por` | uuid FK → `auth.users(id)` | |
| `criado_em` | timestamptz not null default now() | |

`UNIQUE (campanha_id, nome_normalizado)`.

### Tabela `bairro_reconciliacao_alerta`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `campanha_id` | uuid not null FK → `campanha(id)` | |
| `bairro_local_id` | uuid not null FK → `bairro_local(id)` | |
| `bairro_oficial_id` | uuid not null FK → `bairro_oficial(id)` | |
| `similaridade` | numeric | score do trigram no momento da detecção |
| `resolvido` | boolean not null default false | |
| `resolucao` | `status_reconciliacao_enum` | null até resolver |
| `resolvido_por` | text | |
| `resolvido_em` | timestamptz | |
| `criado_em` | timestamptz not null default now() | |

## Sequência de migrations (projeto `axcftjqdjvknrpqzrxls`)

| # | Nome | Conteúdo |
|---|---|---|
| 0023 | `extensoes_tre` | `pg_trgm`, `unaccent` |
| 0024 | `enums_tre` | 5 enums desta fatia |
| 0025 | `municipio` | tabela |
| 0026 | `zona_eleitoral` | tabela + índice único |
| 0027 | `bairro_oficial` | tabela + índice único |
| 0028 | `importacao_tre` | tabela + índice único parcial |
| 0029 | `local_votacao` | tabela + índice único + GIST |
| 0030 | `secao` | tabela + índice único |
| 0031 | `local_votacao_staging` | tabela |
| 0032 | `funcoes_match_bairro` | `normalizar_texto`, `match_bairro_oficial` |
| 0033 | `tre_rls` | RLS em 0025–0031 |
| 0034 | `bairro_local` | tabela + RLS |
| 0035 | `reconciliacao_bairro` | `bairro_reconciliacao_alerta` + `detectar_reconciliacao_bairro` + `resolver_reconciliacao_bairro` + RLS |
| 0036 | `pessoa_secao_fk` | `ALTER TABLE pessoa ADD CONSTRAINT ... FOREIGN KEY (secao_id) REFERENCES secao(id)` |

`get_advisors(type=security)` após 0033 e após 0035 — pontos de verificação
intermediária.

## Funções

Todas `SECURITY DEFINER`, `search_path = ''`, `REVOKE EXECUTE FROM public,
authenticated, anon` (padrão do S2) — identificadores fully-qualified
(`public.tabela`, `extensions.funcao`).

| Função | Descrição |
|---|---|
| `normalizar_texto(txt text)` | `lower(extensions.unaccent(trim(txt)))` |
| `match_bairro_oficial(municipio_id integer, nome_bruto text)` | `ORDER BY extensions.similarity(nome_normalizado, normalizar_texto(nome_bruto)) DESC LIMIT 1`, retorna `NULL` se melhor score `< 0.4` |
| `detectar_reconciliacao_bairro(importacao_id uuid)` | Para cada `bairro_oficial` recém-publicado no lote, confronta via trigram com `bairro_local` (`status != 'fundido'`) de **todas** as campanhas; insere `bairro_reconciliacao_alerta` quando não houver alerta igual ainda pendente |
| `resolver_reconciliacao_bairro(alerta_id uuid, resolucao status_reconciliacao_enum, operador text)` | `'fundido'` → `bairro_local.status = 'fundido'` (sem mover Pessoa — ver não-objetivos); `'mantido_separado'` → só marca `resolvido = true` |

### `match_bairro_oficial` (esboço SQL)

```sql
CREATE OR REPLACE FUNCTION public.match_bairro_oficial(
  p_municipio_id integer, p_nome_bruto text
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT id FROM public.bairro_oficial
   WHERE municipio_id = p_municipio_id
     AND extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) >= 0.4
   ORDER BY extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) DESC
   LIMIT 1;
$$;
```

## Regras de negócio (mapeamento CSV → enum)

- `TIPO_LOCAL_VOTACAO`: contém "TRANSITO"/"TRÂNSITO" → `transito`; contém
  "PRESO" ou "PRESIDIO"/"PRESÍDIO" → `preso_provisorio`; igual a
  "CONVENCIONAL" → `convencional`; qualquer outro → `outro`. Comparação após
  `normalizar_texto`.
- `SITUACAO_LOCAL_VOTACAO`: igual a "ATIVO" (normalizado) → `ativo`; qualquer
  outro → `bloqueado`.
- `elegivel_calor = (tipo = 'convencional' AND situacao = 'ativo' AND
  qtd_aptos > 0)` — independe de `geo` (decisão 7).
- `SECOES`: parse via regex `/\(s:\s*(\d+),\s*apt:\s*(\d+)\)/g` → lista
  `{numero, aptos}[]`.
- `CEP`: só dígitos, `String(cep).replace(/\D/g, '')`.
- Geo ausente (`LATITUDE`/`LONGITUDE` vazios): tenta
  `geocodeEndereco(endereco, cep, municipio, uf)` via Nominatim; sucesso →
  `geo` + `geo_aproximado = true`; falha → `geo = NULL`.

## RLS

`REVOKE ALL ON municipio, zona_eleitoral, bairro_oficial, importacao_tre,
local_votacao, secao, local_votacao_staging, bairro_local,
bairro_reconciliacao_alerta FROM anon, public`.

### Dimensões globais de referência (`municipio`, `zona_eleitoral`, `bairro_oficial`)

```sql
CREATE POLICY "<tabela>_select" ON public.<tabela>
  FOR SELECT TO authenticated USING (true);
-- sem INSERT/UPDATE/DELETE para authenticated/anon — só service_role
```

### `local_votacao` / `secao`

Só visível se o lote está publicado:

```sql
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

### `importacao_tre` / `local_votacao_staging`

Sem policy de SELECT para `authenticated`/`anon` — deny-all (mesmo padrão de
`campanha` no S0); só `service_role` lê/escreve.

### `bairro_local`

```sql
CREATE POLICY "bairro_local_select" ON public.bairro_local
  FOR SELECT TO authenticated
  USING (campanha_id = (jwt->'app_metadata'->>'campanha_id')::uuid);

CREATE POLICY "bairro_local_insert" ON public.bairro_local
  FOR INSERT TO authenticated
  WITH CHECK (campanha_id = (jwt->'app_metadata'->>'campanha_id')::uuid);

CREATE POLICY "bairro_local_update" ON public.bairro_local
  FOR UPDATE TO authenticated
  USING (campanha_id = (jwt->'app_metadata'->>'campanha_id')::uuid);
```

Sem restrição por papel/sub-árvore — visível e editável por todo o grupo da
campanha (ADR 0002).

### `bairro_reconciliacao_alerta`

```sql
CREATE POLICY "bairro_reconciliacao_alerta_select" ON public.bairro_reconciliacao_alerta
  FOR SELECT TO authenticated
  USING (
    campanha_id = (jwt->'app_metadata'->>'campanha_id')::uuid
    AND (jwt->'app_metadata'->>'papel') = 'gestor'
  );
-- INSERT/UPDATE só via funções SECURITY DEFINER
```

## Camada de scripts (`web/scripts/tre/`)

Novas deps: `csv-parse`, `iconv-lite` (produção); `tsx` (dev, runner CLI).

| Arquivo | Responsabilidade |
|---|---|
| `normalizar.ts` | Funções puras: `mapTipoLocal`, `mapSituacaoLocal`, `parseSecoes`, `normalizarCep`, `normalizarTexto` (espelha `normalizar_texto` do banco, usado em testes/dry-run) |
| `parse-csv.ts` | Lê CSV como `latin1` (`iconv-lite`), parseia com `csv-parse` (`columns: true`), tipa cada linha |
| `geocode.ts` | Cliente Nominatim: 1 req/s, timeout, `User-Agent` próprio, retorna `{lat,lng} \| null` |
| `bairros-seed.ts` | Lê `bairros_teresina_final.json`, upsert em `bairro_oficial` por município |
| `ingest.ts` | Orquestrador CLI (ver pipeline abaixo) |
| `revisar-staging.ts` | CLI: lista `local_votacao_staging` não revisado; recebe `--id --bairro-oficial-id` (promove) ou `--id --descartar` |

Fixture de teste: `web/scripts/tre/__fixtures__/tre-sample.csv` (~10 linhas
cobrindo: convencional com geo, trânsito sem geo, bairro sem match, seção
múltipla, situação bloqueado).

### Pipeline de `ingest.ts`

1. Cria `importacao_tre` (`status = 'pendente'`), lê CSV (`parse-csv.ts`).
2. `status = 'processando'`. Upsert `municipio` (do primeiro `COD_LOCALIDADE_IBGE`/`LOCALIDADE`/`UF`).
3. Para cada linha: upsert `zona_eleitoral` (município+`ZONA`); RPC
   `match_bairro_oficial`; se **sem match** → insere em
   `local_votacao_staging` (`motivo = 'bairro_sem_match'`), próxima linha; se
   **com match** → monta `local_votacao` (mapeia tipo/situação, calcula
   `elegivel_calor`, geocodifica se faltar lat/long) + `secao[]` (parse de
   `SECOES`), insere em transação.
4. Erro de parse na linha (campo obrigatório ausente/malformado) → insere em
   `local_votacao_staging` (`motivo = 'erro_parse'`), incrementa
   `total_erros`, segue.
5. Ao final: RPC `detectar_reconciliacao_bairro(importacao_id)`; atualiza
   contadores; `status = 'publicado'`, `publicado_em = now()` (índice único
   parcial garante que não há outro lote publicado pro mesmo município+ano —
   se houver, o script falha com instrução de despublicar o antigo antes).

## Riscos e defesas em profundidade

| Risco | Defesa |
|---|---|
| Encoding errado corrompe nomes/endereços | `latin1` fixo no parser + teste com fixture contendo acento |
| Fuzzy match falso-positivo funde bairros errados | Limiar 0.4 conservador + staging pra revisão manual, nunca auto-publica sem match |
| Import duplicado cria dois lotes "vigentes" | Índice único parcial `WHERE status = 'publicado'` |
| Geocode externo lento/instável trava o lote inteiro | Falha de geocode não bloqueia a linha — só deixa `geo = NULL`; rate-limit isolado do resto do parse |
| `COD_BAIRRO` vazar pro schema | Nunca lido do CSV parseado (campo nem mapeado em `parse-csv.ts`) |
| Campanha lê dado de lote não revisado | RLS de `local_votacao`/`secao` exige `status = 'publicado'`; `staging`/`importacao_tre` sem SELECT pra `authenticated` |
| Reconciliação funde bairro mas apoiador fica "solto" | Documentado como não-objetivo explícito — Pessoa não tem FK de bairro ainda (gap do S2) |

## Testes (critério de pronto)

### Funções puras (Vitest, sem banco)

1. `mapTipoLocal`: "CONVENCIONAL"→`convencional`; "VOTO EM TRÂNSITO"→`transito`;
   "PRESO PROVISÓRIO"→`preso_provisorio`; valor desconhecido→`outro`
2. `mapSituacaoLocal`: "ATIVO"→`ativo`; qualquer outro→`bloqueado`
3. `parseSecoes`: `"(s: 185, apt: 253), (s: 186, apt: 258)"` → `[{numero:185,aptos:253},{numero:186,aptos:258}]`; string vazia → `[]`
4. `normalizarCep`: `"64002-510"` e `"64002510"` → `"64002510"`
5. `normalizarTexto`: `"Água Mineral"` → `"agua mineral"` (espelha SQL)

### Parse de CSV (fixture)

6. Fixture de 10 linhas parseada como `latin1` preserva acentos; linha com
   `LATITUDE`/`LONGITUDE` vazios tipa como `null`, não `NaN`/string vazia

### Banco (via `execute_sql`, como S2)

7. `match_bairro_oficial`: nome exato → match; nome com acento/caixa diferente
   → match (trigram+unaccent); nome sem relação → `NULL`
8. `elegivel_calor`: convencional+ativo+aptos>0 → true; qualquer variação
   falsa → false; verdadeiro mesmo com `geo IS NULL`
9. Bairro sem match: linha cai em `local_votacao_staging`, não aparece em
   `local_votacao`
10. Índice único parcial: dois INSERTs `importacao_tre` mesmo
    município+ano+`status='publicado'` → segundo falha; um `publicado` +
    outros `pendente/erro` → ok
11. RLS: `authenticated` lê `local_votacao`/`secao` de lote `publicado`, não lê
    de lote `pendente`; `authenticated` não lê `importacao_tre` nem
    `local_votacao_staging`; leitura de `municipio`/`zona_eleitoral`/`bairro_oficial`
    livre pra `authenticated`
12. `bairro_local`: campanha A não vê `bairro_local` da campanha B (RLS)
13. `detectar_reconciliacao_bairro`: `bairro_local` similar a `bairro_oficial`
    publicado gera alerta; sem similaridade suficiente, não gera
14. `resolver_reconciliacao_bairro('fundido')`: marca `bairro_local.status =
    'fundido'` e `alerta.resolvido = true`; não toca em `pessoa`
15. FK `pessoa.secao_id`: INSERT com `secao_id` inexistente → violação de FK;
    com `secao_id` válido → ok
16. `get_advisors(security)`: sem alerta novo após 0033 e após 0035

### Integração do script (contra fixture, banco real de teste)

17. `tre:ingest` sobre a fixture completa: contadores finais de
    `importacao_tre` batem (`total_linhas = total_publicados + total_staging +
    total_erros`); linha de trânsito sem geo publica com `elegivel_calor =
    false` (situação/tipo não elegível) e `geo = NULL` ou geocodada
18. `tre:revisar --id X --bairro-oficial-id Y`: promove staging → aparece em
    `local_votacao` com o bairro escolhido; `revisado = true`

## Notas para S4 e além (mapas)

Confirma o roteamento do pedido original do usuário, sem expandir o escopo
desta fatia:

- **Mapa "qtde eleitor por local/zona"** → S4, já no roadmap (ADR 0006:
  Força/Potencial/Penetração ancorados na `secao`, usando `local_votacao.geo`
  + `secao.aptos` + `elegivel_calor` — todos produzidos aqui). Renderização
  MapLibre+OSM (ADR 0012).
- **Mapa de concentração de apoiadores por CEP residencial** → precisa de (a)
  Pessoa ganhar endereço/CEP estruturado (não existe hoje — S2 só tem
  `secao_id`), e (b) geocodificação residencial (ViaCEP → fallback, ADR 0012
  já prevê isso pro dado de contato, não pro calor). Sugestão: tratar como uma
  4ª camada opcional do S4, ou como fatia própria (S4.5) se o volume de
  trabalho justificar — decidir no brainstorming do S4.
- **"Voto por local" (resultado eleitoral)** → não é dado do TRE cadastral
  (este CSV não tem boletim de urna). Se for pra valer, precisa de fonte nova
  (ex.: dados abertos do TSE de resultado por seção/local) e uma ADR própria
  antes de qualquer schema — recomendo tratar como pergunta em aberto pro
  usuário decidir se entra no roadmap, e não assumir automaticamente.
