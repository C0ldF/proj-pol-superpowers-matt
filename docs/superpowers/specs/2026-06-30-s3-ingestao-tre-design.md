# S3 — Ingestão TRE (Superadmin)

Data: 2026-06-30 (revisado após review do usuário)
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Paralela ao S2 (já
merjado), depende só do S0 (extensão PostGIS habilitada, `extensions.postgis`).
ADRs cobertos: 0002, 0011, 0017, 0019.

## Objetivo

Construir o pipeline curado que importa o cadastro oficial do TRE (locais de
votação, seções, aptos) para tabelas globais relacionais, casando cada local
com um bairro oficial, geocodificando o que faltar, e calculando elegibilidade
de calor — dado de referência que o S4 (mapa de calor) vai consumir. Ao término
do S3 o Superadmin consegue rodar o pipeline por fases sobre o CSV real de um
município (`dry-run` → `ingest` → `revisar` → `geocode` → `publicar`), e
`pessoa.secao_id` (coluna solta desde o S2) ganha FK real.

## Decisões desta fatia

1. **Execução via script Node server-side, sem painel web.** S1 nunca criou
   login/painel de Superadmin (deferido); a ingestão roda por CLI (`tsx`)
   usando `adminClient()` (`service_role`, já existe em
   `web/lib/supabase/server.ts`).
2. **Pipeline em fases explícitas e reexecutáveis, não uma operação
   monolítica.** Revisão do usuário identificou que a v1 misturava parse,
   match, geocode (dependência externa) e publicação num único comando — o que
   contradiz a própria ADR 0011 ("revisão antes de publicar"). Fases:

   ```
   seed-bairros → dry-run → ingest → revisar (staging) → geocode → publicar → (despublicar, se preciso reimportar)
   ```

   Cada fase é um comando CLI independente (ver "Camada de scripts"). Só
   `publicar` torna o lote visível para campanhas (RLS); `ingest` sozinho
   nunca publica.
3. **Geocode é fase própria, fora do `ingest`.** `ingest` grava
   `local_votacao` com `geo = NULL` e `geo_status` conforme o caso (ver
   decisão 5); só `tre:geocode` chama a API externa. Isso torna `ingest`
   determinístico e rápido (sem I/O de rede), não trava o lote inteiro se o
   Nominatim estiver fora do ar, e permite reexecutar geocode quantas vezes
   precisar sem re-parsear o CSV.
4. **Encoding do CSV é Latin-1/CP1252, não UTF-8.** Confirmado por inspeção do
   arquivo real (`4a-ad1b-420e-9d99-aa785ee2386b.csv`): acentos corrompem
   quando lido como UTF-8 (`TR�NSITO`, `CENTEN�RIO`). `parse-csv.ts` decodifica
   explicitamente como `latin1` via `iconv-lite`.
5. **`geo_status` enum substitui o antigo booleano `geo_aproximado`** —
   `pendente | sucesso | falhou | manual | nao_necessario`. `nao_necessario`
   = o CSV já trazia lat/long; `pendente` = falta e aguarda `tre:geocode`;
   `sucesso`/`falhou` = resultado da tentativa; `manual` = Superadmin corrigiu
   à mão via `tre:revisar` ou SQL direto. Mais rico que um boolean e cobre o
   estado "ainda não tentamos".
6. **Parser respeita aspas** (`csv-parse`, nunca `split(',')`) — o campo
   `SECOES` carrega vírgulas dentro de aspas: `"(s: 469, apt: 0), (s: 546, apt:
   0)"`.
7. **Fuzzy match de bairro roda no Postgres** (`pg_trgm` + `unaccent`), não em
   JS — reaproveitado tanto no match TRE↔`bairro_oficial` quanto na detecção de
   reconciliação (ADR 0017), e mais barato que Levenshtein em JS para 3556+
   linhas. Limiar configurável via parâmetro da função (decisão 12), não
   hardcoded.
8. **Curadoria "tudo ou staging" no casamento de bairro.** Local cujo `BAIRRO`
   do CSV não casa contra `bairro_oficial` **não entra em `local_votacao`** —
   fica só em `local_votacao_staging` até o Superadmin resolver manualmente
   (`tre:revisar`), que promove a linha. Consequência de modelagem: como um
   local sem bairro casado nunca chega a `local_votacao`,
   `local_votacao.bairro_oficial_id` é **`NOT NULL`** (era nullable "por
   integridade" numa versão anterior deste spec — inconsistente com a própria
   regra; corrigido).
9. **`elegivel_calor` independe de `geo`/`geo_status`.** Calculada só por
   TIPO/SITUACAO/aptos (regra 1 da ADR 0011) no INSERT — um local pode ser
   elegível e ainda assim invisível no mapa até ganhar geo.
10. **Versionamento por (município, ano) com índice único parcial +
    `arquivado`.** Só um lote pode estar `publicado` por município+ano por vez
    (`UNIQUE (municipio_id, ano) WHERE status = 'publicado'`). Reimportar
    exige `tre:despublicar` do lote antigo primeiro (`publicado` →
    `arquivado`, comando explícito, não automático).
11. **`municipio`, `zona_eleitoral`, `bairro_oficial` são dimensões estáveis**
    (upsert idempotente por chave natural, não versionadas por importação).
    `local_votacao`/`secao` são fato, versionado via `importacao_id`.
12. **Limiar de fuzzy match configurável.** `match_bairro_oficial(municipio_id,
    nome_bruto, limiar numeric DEFAULT 0.4)` — parâmetro com default, não
    constante hardcoded no SQL; CLI aceita `--limiar` pra ajustar sem migration.
13. **`COD_BAIRRO` do CSV nunca é lido nem armazenado**, nem em staging (ADR
    0011 — lixo inconsistente). Vínculo de bairro é só por nome normalizado.
14. **Auditabilidade do lote e da linha.** `importacao_tre` guarda
    `arquivo_sha256` + `arquivo_tamanho_bytes` (prova qual arquivo gerou o
    lote) e `importer_version` (versão da lógica do parser — o CSV do TRE muda
    de formato entre ciclos eleitorais). `local_votacao`/`local_votacao_staging`
    guardam `row_hash` (SHA-256 da linha original) — habilita detectar linhas
    idênticas entre reimportações/anos sem reprocessar tudo. `log` em
    `importacao_tre` segue um formato fixo (ver seção Auditoria), não um
    jsonb solto sem contrato.
15. **Mecânica de reconciliação (ADR 0017) construída nesta fatia**, mesmo sem
    dado real pra disparar ainda (é o primeiro import oficial — nenhuma
    campanha tem `bairro_local` própria ainda). `detectar_reconciliacao_bairro`
    roda dentro de `tre:publicar`; a função de resolução
    (`resolver_reconciliacao_bairro`) existe pronta, sem UI (painel Superadmin
    não existe ainda).
16. **Campos extras do CSV real** (`QTD_CANCELADOS`, `QTD_SUSPENSOS`,
    `QTD_VAGAS_RESERVADAS`, `QTD_BASE_HISTORICA`, `TELEFONE`, `DATA_CRIACAO`)
    são armazenados em `local_votacao` para auditoria, fora das regras de
    negócio desta fatia.
17. **`pessoa.secao_id` ganha FK real** para `secao(id)` na última migration —
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
- Settings/limiar em tabela dedicada → um único parâmetro não justifica uma
  tabela; fica como default de função + flag de CLI (decisão 12).

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
- **`status_importacao_enum`**: `pendente | processando | pendente_revisao |
  publicado | arquivado | erro`
- **`geo_status_enum`**: `pendente | sucesso | falhou | manual |
  nao_necessario`
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
Índice `GIN (nome_normalizado extensions.gin_trgm_ops)` — é o que
`match_bairro_oficial` de fato usa (`similarity()` em `ORDER BY`); o índice
único btree acima não ajuda essa consulta.

### Tabela `importacao_tre` (lote)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `municipio_id` | integer not null FK → `municipio(cod_ibge)` | |
| `uf` | char(2) not null | |
| `ano` | integer not null | |
| `status` | `status_importacao_enum` not null default `'pendente'` | |
| `arquivo_nome` | text | nome do CSV original |
| `arquivo_sha256` | text | hash do arquivo inteiro — prova qual CSV gerou o lote |
| `arquivo_tamanho_bytes` | bigint | |
| `importer_version` | text not null | versão da lógica do parser (ex.: `'s3.0'`) |
| `total_linhas` | integer | |
| `total_publicados` | integer | linhas que viraram `local_votacao` |
| `total_staging` | integer | linhas que ficaram em `local_votacao_staging` |
| `total_erros` | integer | linhas com erro de parse (nem staging) |
| `operador` | text | identificador de quem rodou o script (não é `auth.users` — Superadmin não loga) |
| `log` | jsonb | ver formato fixo na seção Auditoria |
| `iniciado_em` | timestamptz not null default now() | |
| `publicado_em` | timestamptz | null até `tre:publicar` |

`UNIQUE INDEX ux_importacao_publicado ON importacao_tre (municipio_id, ano)
WHERE status = 'publicado'` — só um lote vigente por município+ano.

### Tabela `local_votacao`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `importacao_id` | uuid not null FK → `importacao_tre(id)` | |
| `zona_id` | uuid not null FK → `zona_eleitoral(id)` | |
| `bairro_oficial_id` | uuid **not null** FK → `bairro_oficial(id)` | nunca nulo — sem match não entra aqui (decisão 8) |
| `bairro_nome_original` | text not null | `BAIRRO` bruto do CSV, auditoria |
| `num_local` | integer not null | `NUM_LOCAL` |
| `nome` | text not null | `LOCAL_VOTACAO` |
| `endereco` | text | `ENDERECO` |
| `cep` | text | só dígitos |
| `geo` | `extensions.geometry(Point, 4326)` | nullable |
| `geo_status` | `geo_status_enum` not null default `'pendente'` | ver decisão 5 |
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
| `avisos` | text[] not null default `'{}'` | flags não-bloqueantes (ex.: `'cep_invalido'`, `'qtd_aptos_diverge_soma_secoes'`) |
| `row_hash` | text not null | SHA-256 da linha original do CSV |
| `criado_em` | timestamptz not null default now() | |

**Constraints:** `UNIQUE (importacao_id, num_local)`;
`CHECK (qtd_aptos >= 0)`; `CHECK (qtd_cancelados >= 0)`;
`CHECK (qtd_suspensos >= 0)`; `CHECK (qtd_vagas_reservadas >= 0)`;
`CHECK (qtd_base_historica >= 0)`.
Não há `CHECK (geometrytype(geo) = 'POINT')` — redundante: o tipo
`geometry(Point, 4326)` já restringe a coluna a `Point` no nível do typmod,
rejeitando qualquer outro tipo geométrico no INSERT (mais forte que um CHECK).

**Índices:** GIST em `geo` (`idx_local_votacao_geo`); btree em
`bairro_oficial_id` (`idx_local_votacao_bairro_oficial` — S4 agrega por
bairro); btree em `row_hash`.

### Tabela `secao`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `local_id` | uuid not null FK → `local_votacao(id) ON DELETE CASCADE` | |
| `numero` | integer not null | `s:` do parse de `SECOES` |
| `aptos` | integer not null default 0 | `apt:` do parse de `SECOES` |

**Constraints:** `UNIQUE (local_id, numero)`; `CHECK (numero > 0)`;
`CHECK (aptos >= 0)`.

### Tabela `local_votacao_staging`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `importacao_id` | uuid not null FK → `importacao_tre(id)` | |
| `linha_original` | jsonb not null | linha crua do CSV (parseada), pra reprocessar |
| `row_hash` | text not null | SHA-256 da linha original |
| `motivos` | text[] not null | ex.: `{'bairro_sem_match'}`, pode ter mais de um (`{'bairro_sem_match','erro_parse'}`) |
| `revisado` | boolean not null default false | |
| `resolvido_bairro_oficial_id` | uuid FK → `bairro_oficial(id)` | preenchido na revisão |
| `revisado_em` | timestamptz | |
| `revisado_por` | text | |
| `criado_em` | timestamptz not null default now() | |

**Constraints:** `CHECK (cardinality(motivos) > 0)`.
**Índices:** `GIN (linha_original)` — audit/busca ad-hoc dentro do JSON.

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
| 0024 | `enums_tre` | 6 enums desta fatia (inclui `geo_status_enum`) |
| 0025 | `municipio` | tabela |
| 0026 | `zona_eleitoral` | tabela + índice único |
| 0027 | `bairro_oficial` | tabela + índice único + GIN trigram |
| 0028 | `importacao_tre` | tabela + índice único parcial |
| 0029 | `local_votacao` | tabela + constraints + GIST + índices |
| 0030 | `secao` | tabela + índice único + constraints |
| 0031 | `local_votacao_staging` | tabela + GIN |
| 0032 | `funcoes_match_bairro` | `normalizar_texto`, `match_bairro_oficial` (limiar parametrizável) |
| 0033 | `tre_rls` | RLS em 0025–0031 |
| 0034 | `tre_rls_publish_check_fix` | **Erratum, descoberto na execução:** o `EXISTS` direto em `importacao_tre` dentro de `local_votacao_select`/`secao_select` nunca é satisfeito, porque `importacao_tre` é deny-all pra `authenticated` e a subquery roda com o mesmo papel — a RLS bloqueia a subquery antes do `status='publicado'` ser avaliado. Fix: função `importacao_esta_publicada(uuid)` `SECURITY DEFINER` (bypassa a RLS de `importacao_tre` internamente) + `GRANT EXECUTE` pra `authenticated`; `secao_select` passa a delegar pra RLS de `local_votacao` em vez de duplicar o check. |
| 0035 | `bairro_local` | tabela + RLS |
| 0036 | `reconciliacao_bairro` | `bairro_reconciliacao_alerta` + `detectar_reconciliacao_bairro` + `resolver_reconciliacao_bairro` + RLS |
| 0037 | `pessoa_secao_fk` | `ALTER TABLE pessoa ADD CONSTRAINT ... FOREIGN KEY (secao_id) REFERENCES secao(id)` |

`get_advisors(type=security)` após 0034 e após 0036 — pontos de verificação
intermediária.

## Funções

Todas `SECURITY DEFINER`, `search_path = ''`, `REVOKE EXECUTE FROM public,
authenticated, anon` (padrão do S2) — identificadores fully-qualified
(`public.tabela`, `extensions.funcao`).

| Função | Descrição |
|---|---|
| `normalizar_texto(txt text)` | `lower(extensions.unaccent(trim(txt)))` |
| `match_bairro_oficial(municipio_id integer, nome_bruto text, limiar numeric DEFAULT 0.4)` | `ORDER BY extensions.similarity(...) DESC LIMIT 1`, retorna `NULL` se melhor score `< limiar` |
| `detectar_reconciliacao_bairro(importacao_id uuid)` | Para cada `bairro_oficial` do lote sendo publicado, confronta via trigram com `bairro_local` (`status != 'fundido'`) de **todas** as campanhas; insere `bairro_reconciliacao_alerta` quando não houver alerta igual ainda pendente |
| `resolver_reconciliacao_bairro(alerta_id uuid, resolucao status_reconciliacao_enum, operador text)` | `'fundido'` → `bairro_local.status = 'fundido'` (sem mover Pessoa — ver não-objetivos); `'mantido_separado'` → só marca `resolvido = true` |

### `match_bairro_oficial` (esboço SQL)

```sql
CREATE OR REPLACE FUNCTION public.match_bairro_oficial(
  p_municipio_id integer, p_nome_bruto text, p_limiar numeric DEFAULT 0.4
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT id FROM public.bairro_oficial
   WHERE municipio_id = p_municipio_id
     AND extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) >= p_limiar
   ORDER BY extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) DESC
   LIMIT 1;
$$;
```

## Regras de negócio

- `TIPO_LOCAL_VOTACAO`: contém "TRANSITO"/"TRÂNSITO" → `transito`; contém
  "PRESO" ou "PRESIDIO"/"PRESÍDIO" → `preso_provisorio`; igual a
  "CONVENCIONAL" → `convencional`; qualquer outro → `outro`. Comparação após
  `normalizarTexto` (espelho JS de `normalizar_texto`).
- `SITUACAO_LOCAL_VOTACAO`: igual a "ATIVO" (normalizado) → `ativo`; qualquer
  outro → `bloqueado`.
- `elegivel_calor = (tipo = 'convencional' AND situacao = 'ativo' AND
  qtd_aptos > 0)` — independe de `geo`/`geo_status` (decisão 9).
- **Parse de `SECOES` — tolerante, porque o CSV do TRE muda de formato entre
  ciclos:** regex `/\(s:\s*(\d+),\s*apt:\s*(\d+)\)/g`; ignora espaços extras
  dentro dos parênteses; tolera vírgulas múltiplas/trailing entre grupos;
  parênteses malformados ou `apt:`/`s:` vazio → não geram exceção, só um
  warning em `avisos` (`'secao_malformada'`) e são pulados; seção duplicada
  (mesmo `numero` duas vezes na mesma linha) → mantém a primeira ocorrência,
  registra `'secao_duplicada'` em `avisos`.
- `CEP`: só dígitos (`String(cep).replace(/\D/g, '')`); se não tiver
  exatamente 8 dígitos após limpeza → grava mesmo assim (não bloqueia) mas
  adiciona `'cep_invalido'` a `avisos`.
- Consistência: se `qtd_aptos` (coluna do CSV) diverge da soma de
  `secao.aptos` parseadas → adiciona `'qtd_aptos_diverge_soma_secoes'` a
  `avisos` (não bloqueia; é sinal de CSV inconsistente, fica pro Superadmin
  avaliar).
- Geo ausente (`LATITUDE`/`LONGITUDE` vazios) no `ingest`: grava `geo = NULL`,
  `geo_status = 'pendente'`. Geo presente no CSV: `geo_status =
  'nao_necessario'`. `tre:geocode` (fase separada) processa quem está
  `'pendente'`: sucesso → `geo` preenchido + `geo_status = 'sucesso'`; falha →
  `geo_status = 'falhou'` (fica fora do mapa até correção manual, que grava
  `geo_status = 'manual'`).

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
| `normalizar.ts` | Funções puras: `mapTipoLocal`, `mapSituacaoLocal`, `parseSecoes` (tolerante), `normalizarCep`, `normalizarTexto` (espelha `normalizar_texto` do banco), `hashLinha` (SHA-256) |
| `parse-csv.ts` | Lê CSV como `latin1` (`iconv-lite`), parseia com `csv-parse` (`columns: true`), tipa cada linha |
| `geocode.ts` | Cliente Nominatim: 1 req/s, timeout, `User-Agent` próprio, retorna `{lat,lng} \| null` — só chamado pela fase `geocode` |
| `bairros-seed.ts` | Lê `bairros_teresina_final.json`, upsert em `bairro_oficial` por município |
| `ingest.ts` | Fase `ingest`: parse + match + insere `local_votacao`/`secao`/`staging`; **não geocodifica, não publica** |
| `revisar-staging.ts` | Fase `revisar`: lista `local_votacao_staging` não revisado; `--id --bairro-oficial-id` (promove) ou `--id --descartar` |
| `geocode-pendentes.ts` | Fase `geocode`: processa `local_votacao` com `geo_status = 'pendente'` de um `--importacao <id>` |
| `publicar.ts` | Fase `publicar`: `status → 'publicado'`, roda `detectar_reconciliacao_bairro`; falha se já há outro lote publicado no mesmo município+ano |
| `despublicar.ts` | `status 'publicado' → 'arquivado'` |
| `stats.ts` | Lista lotes (`importacao_tre`) e contadores — leitura pura |

CLI (`package.json` scripts): `tre:seed-bairros`, `tre:dry-run`, `tre:ingest`,
`tre:revisar`, `tre:geocode`, `tre:publicar`, `tre:despublicar`, `tre:stats`.

Fixture de teste: `web/scripts/tre/__fixtures__/tre-sample.csv` (~10 linhas
cobrindo: convencional com geo, trânsito sem geo, bairro sem match, seção
múltipla malformada, situação bloqueado, CEP inválido, `qtd_aptos` divergente
da soma das seções).

### Pipeline (fases)

1. **`tre:seed-bairros`** — upsert `bairro_oficial` a partir do JSON.
2. **`tre:dry-run --csv <path> --municipio <cod_ibge> --ano <ano>`** — roda
   parse + match **sem gravar nada**; imprime `{ importaria, staging, erros
   }`. Reusa a mesma lógica de `ingest.ts` num modo leitura (mesma função,
   flag `--dry-run`, não `INSERT`).
3. **`tre:ingest --csv <path> --municipio <cod_ibge> --ano <ano>`** — cria
   `importacao_tre` (`status='pendente'` → `'processando'`), calcula
   `arquivo_sha256`/`arquivo_tamanho_bytes`, upsert `municipio`/`zona_eleitoral`,
   RPC `match_bairro_oficial` por linha: sem match → `local_votacao_staging`
   (`motivos ⊇ {'bairro_sem_match'}`); com match → INSERT `local_votacao`
   (`geo_status` conforme presença de lat/long) + `secao[]`. Erro de parse →
   `local_votacao_staging` (`motivos ⊇ {'erro_parse'}`). Ao final:
   `status = 'pendente_revisao'`, `log` preenchido (ver Auditoria).
4. **`tre:revisar`** — lista staging pendente; promove (INSERT em
   `local_votacao` com o `bairro_oficial_id` escolhido, `geo_status` seguindo
   a mesma regra do `ingest`) ou descarta.
5. **`tre:geocode --importacao <id>`** — para cada `local_votacao` com
   `geo_status='pendente'` do lote: chama Nominatim (1 req/s); sucesso →
   `geo`+`geo_status='sucesso'`; falha → `geo_status='falhou'`. Reexecutável
   livremente (só processa quem ainda está `'pendente'` ou, com `--retry`,
   também `'falhou'`).
6. **`tre:publicar --importacao <id>`** — exige lote em `'pendente_revisao'`;
   roda `detectar_reconciliacao_bairro`; `status='publicado'`,
   `publicado_em=now()`. Falha se já existe outro lote `'publicado'` pro
   mesmo município+ano (índice único parcial) — instrui rodar
   `tre:despublicar` no antigo antes. **Não exige** staging zerado nem geocode
   100% completo — publicar é sobre tornar os locais já curados visíveis, não
   sobre terminar 100% do trabalho de revisão.
7. **`tre:despublicar --importacao <id>`** — `'publicado' → 'arquivado'`.

## Auditoria — formato fixo de `importacao_tre.log`

```ts
type ImportLog = {
  warnings: string[];
  errors: string[];
  duration_ms: number;
  geocode_calls: number;
  geocode_failures: number;
  staging: number;
  imported: number;
};
```

Cada fase (`ingest`, `geocode`, `publicar`) faz merge no mesmo objeto (não
sobrescreve) — assim o `log` acumula o histórico do lote inteiro, não só da
última fase rodada.

## Riscos e defesas em profundidade

| Risco | Defesa |
|---|---|
| Encoding errado corrompe nomes/endereços | `latin1` fixo no parser + teste com fixture contendo acento |
| Fuzzy match falso-positivo funde bairros errados | Limiar 0.4 conservador (configurável) + staging pra revisão manual, nunca auto-publica sem match |
| Import duplicado cria dois lotes "vigentes" | Índice único parcial `WHERE status = 'publicado'` |
| Geocode externo lento/instável afeta a ingestão | Não afeta — `geocode` é fase separada, nunca roda dentro de `ingest`; falha de geocode só marca `geo_status='falhou'` numa linha isolada |
| `COD_BAIRRO` vazar pro schema | Nunca lido do CSV parseado (campo nem mapeado em `parse-csv.ts`) |
| Campanha lê dado de lote não revisado/não publicado | RLS de `local_votacao`/`secao` exige `status = 'publicado'`; `staging`/`importacao_tre` sem SELECT pra `authenticated` |
| Reconciliação funde bairro mas apoiador fica "solto" | Documentado como não-objetivo explícito — Pessoa não tem FK de bairro ainda (gap do S2) |
| CSV do TRE muda de formato num ciclo futuro e quebra o parser silenciosamente | `importer_version` + `row_hash` habilitam diff entre importações; parser de `SECOES` tolerante com warnings em vez de exceção dura |
| Publicar lote com CSV errado (arquivo trocado) | `arquivo_sha256` prova exatamente qual arquivo gerou o lote, auditável depois |

## Testes (critério de pronto)

### Funções puras (Vitest, sem banco)

1. `mapTipoLocal`: "CONVENCIONAL"→`convencional`; "VOTO EM TRÂNSITO"→`transito`;
   "PRESO PROVISÓRIO"→`preso_provisorio`; valor desconhecido→`outro`
2. `mapSituacaoLocal`: "ATIVO"→`ativo`; qualquer outro→`bloqueado`
3. `parseSecoes`: `"(s: 185, apt: 253), (s: 186, apt: 258)"` →
   `[{numero:185,aptos:253},{numero:186,aptos:258}]`; string vazia → `[]`;
   grupo malformado (`"(s: , apt: 10)"`) → ignorado + warning; seção duplicada
   → mantém primeira + warning
4. `normalizarCep`: `"64002-510"` e `"64002510"` → `"64002510"`; CEP com 7
   dígitos → aviso `cep_invalido`
5. `normalizarTexto`: `"Água Mineral"` → `"agua mineral"` (espelha SQL)
6. `hashLinha`: mesma linha → mesmo hash; linha com 1 campo diferente → hash
   diferente

### Parse de CSV (fixture)

7. Fixture de 10 linhas parseada como `latin1` preserva acentos; linha com
   `LATITUDE`/`LONGITUDE` vazios tipa como `null`, não `NaN`/string vazia

### Banco (via `execute_sql`, como S2)

8. `match_bairro_oficial`: nome exato → match; nome com acento/caixa diferente
   → match (trigram+unaccent); nome sem relação → `NULL`; `limiar` mais alto
   reduz matches (testa parametrização)
9. `elegivel_calor`: convencional+ativo+aptos>0 → true; qualquer variação
   falsa → false; verdadeiro mesmo com `geo_status='pendente'`
10. Bairro sem match: linha cai em `local_votacao_staging`, não aparece em
    `local_votacao`; `bairro_oficial_id` é `NOT NULL` em `local_votacao`
    (constraint recusa INSERT sem bairro)
11. Índice único parcial: dois `importacao_tre` mesmo
    município+ano+`status='publicado'` → segundo falha; um `publicado` +
    outros `pendente_revisao/erro/arquivado` → ok
12. RLS: `authenticated` lê `local_votacao`/`secao` de lote `publicado`, não lê
    de lote `pendente_revisao`; `authenticated` não lê `importacao_tre` nem
    `local_votacao_staging`; leitura de `municipio`/`zona_eleitoral`/`bairro_oficial`
    livre pra `authenticated`
13. `bairro_local`: campanha A não vê `bairro_local` da campanha B (RLS)
14. `detectar_reconciliacao_bairro`: `bairro_local` similar a `bairro_oficial`
    publicado gera alerta; sem similaridade suficiente, não gera
15. `resolver_reconciliacao_bairro('fundido')`: marca `bairro_local.status =
    'fundido'` e `alerta.resolvido = true`; não toca em `pessoa`
16. FK `pessoa.secao_id`: INSERT com `secao_id` inexistente → violação de FK;
    com `secao_id` válido → ok
17. Constraints: `qtd_aptos < 0` → rejeitado; `secao.numero <= 0` → rejeitado;
    `local_votacao_staging` com `motivos = '{}'` → rejeitado
18. `get_advisors(security)`: sem alerta novo após 0034 e após 0036 (um WARN esperado e intencional aparece após 0034: `importacao_esta_publicada` é `SECURITY DEFINER` chamável por `authenticated` via RPC — necessário pro fix de RLS funcionar, sem exposição de dado sensível)

### Integração dos scripts (contra fixture, banco real de teste)

19. `tre:dry-run` não grava nada no banco (conta linhas antes/depois de rodar
    e compara)
20. `tre:ingest` sobre a fixture completa: contadores finais de
    `importacao_tre` batem (`total_linhas = total_publicados + total_staging +
    total_erros`); lote termina em `status='pendente_revisao'` (não publica
    sozinho); linha de trânsito sem geo grava `geo_status='pendente'`
21. `tre:revisar --id X --bairro-oficial-id Y`: promove staging → aparece em
    `local_votacao` com o bairro escolhido; `revisado = true`
22. `tre:geocode` só processa `geo_status='pendente'`; roda de novo sem
    `--retry` não reprocessa quem já é `'falhou'`
23. `tre:publicar`: lote vira `'publicado'`; tentar publicar um 2º lote do
    mesmo município+ano falha até `tre:despublicar` o primeiro
24. `tre:despublicar`: `'publicado'→'arquivado'` libera o índice único parcial
    pra um novo `tre:publicar` de outro lote

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

## Erratum (pós-execução, Tasks 21-27 do plano)

Duas correções descobertas só ao rodar o CSV real (3555 linhas, 224
municípios do Piauí), não a fixture de 10 linhas:

1. **`local_votacao_unico` faltava `zona_id`** (decisão 8 original estava
   incompleta) — `NUM_LOCAL` do TRE só é único dentro da zona, não no
   município. Corrigido (migration 0038); colisões reais mesmo-zona (1176 na
   base real) viram staging com `motivos:['num_local_duplicado_mesma_zona']`
   em vez de travar a constraint.
2. **O CSV é estadual, não municipal, e o match de bairro contra
   `bairro_oficial` nunca deveria ter sido exigido pro CSV de locais de
   votação.** Decisão original (seção "Regras de negócio obrigatórias" do
   pedido do usuário, e ADR 0011) previa fuzzy match de bairro pro CSV — o
   usuário esclareceu depois, ao ver o pipeline vazar dado de Parnaíba pra
   dentro de Teresina via match de nome de bairro genérico ("Centro"), que
   isso nunca foi a intenção: o CSV serve só pra alimentar
   `local_votacao`/`secao` (mapa de calor), sem depender de casar bairro.
   `bairro_oficial_id` em `local_votacao` virou opcional (migration 0039,
   sempre `NULL` vindo do CSV); `match_bairro_oficial` continua existindo,
   mas só serve à criação de `bairro_local` e à reconciliação (ADR 0017,
   Tasks 8-9) — um recurso separado do CSV de locais de votação. Adicionado
   também: filtro obrigatório por `COD_LOCALIDADE_IBGE` == município pedido
   (linhas de outras cidades são descartadas, nunca inseridas).

Lição para as próximas fatias: uma alegação de "concluído" baseada só em os
totais internos baterem entre si (`total_linhas = publicados+staging+erros`)
não é suficiente — vale checar se a *magnitude* faz sentido pro domínio (334
linhas de um município real vs. 3555 do arquivo bruto era o sinal que
faltava checar da primeira vez).
