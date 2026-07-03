# S4 — Mapa de calor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the mapa de calor eleitoral — Força/Potencial/Penetração agregados por bairro ou zona eleitoral, com visibilidade por sub-árvore, renderizado numa página real (MapLibre GL + OSM).

**Architecture:** Três funções `SECURITY DEFINER` no Postgres (`potencial_por_area`, `forca_por_area` internas + `mapa_calor_agregado` pública) → rota `GET /api/mapa-calor` (Next.js, sessão via `ssrClient`) → página `/mapa-calor` (server component com checagem de sessão + client component MapLibre).

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript, Supabase (Postgres 17 + PostGIS), `maplibre-gl`, Vitest (+ `jsdom`/`@testing-library/react` novos nesta fatia), `execute_sql`/`apply_migration` via MCP Supabase.

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/` (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência: `docs/superpowers/specs/2026-07-03-s4-mapa-calor-design.md` — toda task abaixo implementa uma seção dela; consulte pra contexto de decisão, não só pro código (já embutido nas tasks).
- Projeto Supabase: `axcftjqdjvknrpqzrxls`. Migrations via `mcp__supabase__apply_migration` — uma por task; cópia idêntica salva em `supabase/migrations/`. Migration atual mais recente é `0039`; esta fatia usa `0040`-`0043`.
- Testes de função SQL (Tasks 2-4) seguem o padrão já usado no S2/S3: verificação via `execute_sql` direto no projeto live, com fixtures próprios criados e limpos dentro da própria task — **não** viram arquivo `.test.ts` (este projeto não tem harness de teste de banco em JS; a evidência de teste é a query e o resultado, documentados no relatório da task).
- Testes de código Next.js (Tasks 5-7) rodam com `cd web && npx vitest run <caminho>`.
- Toda função `SECURITY DEFINER` desta fatia: `search_path = ''`, identificadores fully-qualified (`public.tabela`, `extensions.funcao`) — padrão do S2/S3. `potencial_por_area`/`forca_por_area`: `REVOKE ALL FROM public, authenticated, anon`. `mapa_calor_agregado`: `REVOKE ALL FROM public, anon` + `GRANT EXECUTE TO authenticated` (única exceção nesta fatia — ela lê `auth.uid()` internamente, nunca recebe identidade como parâmetro, por isso é segura expor).
- Município de referência pro dado real: Teresina, `cod_ibge = 2211001`. Lote real já publicado (assumir `pendente_revisao` até a Task 8 rodar `tre:publicar`): `81d77111-c382-4849-9616-774d4fdff7f5`, 334 linhas.
- `adminClient()`/`ssrClient()` = `web/lib/supabase/server.ts` / `web/lib/supabase/ssr.ts` — rota Next.js desta fatia usa `ssrClient` (sessão do usuário), nunca `adminClient`.
- Commits frequentes; mensagens estilo do repo (`feat(s4): ...`, `test(s4): ...`).
- Progresso rastreado pela skill `subagent-driven-development` em `.superpowers/sdd/progress-s4.md`.
- Sem página de login no app ainda — a página `/mapa-calor` (Task 6) mostra uma mensagem simples quando não autenticado, **sem redirecionar** (decisão tomada na sessão de planejamento; não constrói página de login nesta fatia).

---

## Contexto de schema (não repetir em cada task)

Tabelas/colunas usadas por este plano, já existentes desde o S2/S3 — conferidas
direto nas migrations antes de escrever este plano:

- `public.local_votacao(id, zona_id uuid NOT NULL, bairro_nome_original text NOT NULL, geo geometry(Point,4326), elegivel_calor boolean NOT NULL, bairro_oficial_id uuid NULL)`
- `public.secao(id, local_id uuid NOT NULL, numero integer, aptos integer NOT NULL)`
- `public.zona_eleitoral(id, municipio_id integer NOT NULL, numero integer NOT NULL)`
- `public.pessoa(id, campanha_id uuid NOT NULL, secao_id uuid NULL, deleted_at timestamptz NULL)`
- `public.vinculo(id, campanha_id uuid NOT NULL, pessoa_id uuid NOT NULL, responsavel_id uuid NULL, papel public.papel_vinculo NOT NULL)` — `papel_vinculo` = `'gestor' | 'coordenador' | 'colaborador' | 'lideranca' | 'apoiador'`
- `public.usuario_campanha(user_id uuid PRIMARY KEY, campanha_id uuid NOT NULL, papel public.papel_login NOT NULL, pessoa_id uuid)` — `papel_login` = `'gestor' | 'coordenador' | 'lideranca' | 'colaborador'` (sem `apoiador`)
- `public.campanha(id, subdominio text UNIQUE, nome, cargo, abrangencia, municipio_id bigint, uf char(2), status, data_eleicao date NOT NULL)` — `abrangencia='municipal'` exige `municipio_id` setado e `uf` NULL
- `public.pessoa_em_subarvore_do_actor(actor_uid uuid, target_pessoa_id uuid) RETURNS boolean` — já existe desde o S2 (`0016_funcoes_autoridade.sql`)
- `public.normalizar_texto(text) RETURNS text` — já existe desde o S3

---

### Task 1: Enum de granularidade + índice em `local_votacao.zona_id`

**Files:**
- Create: `supabase/migrations/0040_granularidade_calor_enum.sql`

**Interfaces:**
- Produces: tipo `public.granularidade_calor_enum` (`'zona' | 'bairro'`), usado pelas 3 funções das Tasks 2-4. Índice `local_votacao_zona_idx`, sem interface de código (só performance).

- [ ] **Step 1: Escrever a migration**

```sql
-- 0040_granularidade_calor_enum.sql
CREATE TYPE public.granularidade_calor_enum AS ENUM ('zona', 'bairro');

-- Nenhum índice hoje tem zona_id como coluna líder em local_votacao (só
-- aparece como 2ª coluna da unique importacao_id+zona_id+num_local, inútil
-- pra GROUP BY zona_id isolado) — necessário pro padrão de query do S4.
CREATE INDEX local_votacao_zona_idx ON public.local_votacao (zona_id);
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `granularidade_calor_enum`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Verificar via `execute_sql`**

```sql
SELECT enum_range(NULL::public.granularidade_calor_enum);
-- esperado: {zona,bairro}

SELECT indexname FROM pg_indexes
 WHERE tablename = 'local_votacao' AND indexname = 'local_votacao_zona_idx';
-- esperado: 1 linha
```

- [ ] **Step 4: Salvar cópia e commitar**

```bash
git add supabase/migrations/0040_granularidade_calor_enum.sql
git commit -m "feat(s4): granularidade_calor_enum + índice zona_id em local_votacao"
```

---

### Task 2: `potencial_por_area` — agregação de aptos por zona/bairro

**Files:**
- Create: `supabase/migrations/0041_potencial_por_area.sql`

**Interfaces:**
- Consumes: `public.granularidade_calor_enum` (Task 1); `local_votacao`, `secao`, `zona_eleitoral` (schema existente).
- Produces: `public.potencial_por_area(p_granularidade public.granularidade_calor_enum) RETURNS TABLE (area_id text, area_nome text, potencial integer, ponto_geojson jsonb)`. Task 4 chama esta função.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0041_potencial_por_area.sql
CREATE OR REPLACE FUNCTION public.potencial_por_area(
  p_granularidade public.granularidade_calor_enum
) RETURNS TABLE (
  area_id text,
  area_nome text,
  potencial integer,
  ponto_geojson jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    CASE WHEN p_granularidade = 'zona' THEN lv.zona_id::text
         ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
    CASE WHEN p_granularidade = 'zona' THEN min(ze.numero)::text
         ELSE initcap(min(lv.bairro_nome_original)) END AS area_nome,
    sum(s.aptos)::integer AS potencial,
    -- ST_GeometricMedian: ponto que minimiza distância total até os locais
    -- reais da área — mais robusto que centroide (não cai fora da área com
    -- locais espalhados) e que casco convexo (não pousa longe de qualquer
    -- local real num agrupamento assimétrico).
    extensions.ST_AsGeoJSON(
      extensions.ST_GeometricMedian(extensions.ST_Collect(lv.geo))
    )::jsonb AS ponto_geojson
  FROM public.local_votacao lv
  JOIN public.secao s ON s.local_id = lv.id
  JOIN public.zona_eleitoral ze ON ze.id = lv.zona_id
  WHERE lv.elegivel_calor = true
  GROUP BY 1;
$$;
REVOKE ALL ON FUNCTION public.potencial_por_area(public.granularidade_calor_enum) FROM public, authenticated, anon;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `potencial_por_area`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Verificar contra dado real (Teresina, lote `81d77111-c382-4849-9616-774d4fdff7f5`) via `execute_sql`**

```sql
-- Confirma que a função roda e retorna linhas plausíveis pro dado real
SELECT count(*) AS num_areas, sum(potencial) AS soma_potencial
  FROM public.potencial_por_area('zona');
-- esperado: num_areas = número de zonas distintas com >=1 local elegivel_calor
-- em Teresina; soma_potencial = soma de secao.aptos de todos os locais
-- elegivel_calor=true do lote

SELECT count(*) AS num_areas, sum(potencial) AS soma_potencial
  FROM public.potencial_por_area('bairro');
-- esperado: mesma soma_potencial de zona (é o mesmo universo de locais,
-- só agrupado diferente); num_areas pode ser MAIOR ou MENOR que zona
-- (depende de quantos bairros distintos existem vs quantas zonas)

-- Confirma que local_votacao.elegivel_calor=false realmente não entra
SELECT sum(s.aptos) FROM public.local_votacao lv JOIN public.secao s ON s.local_id = lv.id
 WHERE lv.elegivel_calor = false;
-- some esse valor ao soma_potencial acima e confirme que bate com a soma
-- total de aptos de TODOS os locais do lote (elegivel_calor true + false)

-- Confirma ponto_geojson é sempre um Point (nunca Polygon) e nunca NULL
-- quando a área tem pelo menos 1 local com geo preenchido
SELECT area_id, ponto_geojson ->> 'type' AS tipo
  FROM public.potencial_por_area('zona') LIMIT 5;
-- esperado: tipo = 'Point' em todas as linhas (ou NULL se nenhum local da
-- área tem geo ainda — aceitável, lote pode não ter passado por geocode)

-- Confirma area_nome estabilizado (initcap) pra bairro
SELECT area_nome FROM public.potencial_por_area('bairro')
 WHERE area_nome ~ '[A-Z]{2,}';
-- esperado: 0 linhas (nenhum nome deveria ter 2+ maiúsculas seguidas —
-- prova que initcap normalizou, não sobrou nenhum "CENTRO" em caixa alta)
```

- [ ] **Step 4: `get_advisors(type=security)`**

Confirmar zero alertas novos (função `REVOKE`d de `authenticated`, mesma categoria das funções internas do S2/S3).

- [ ] **Step 5: Salvar cópia e commitar**

```bash
git add supabase/migrations/0041_potencial_por_area.sql
git commit -m "feat(s4): potencial_por_area — soma de aptos por zona/bairro elegivel_calor"
```

---

### Task 3: `forca_por_area` — contagem de pessoas por área, com visibilidade por sub-árvore

**Files:**
- Create: `supabase/migrations/0042_forca_por_area.sql`
- Create (temporário, scratchpad, não commitado): script Node de fixture — ver Step 3

**Interfaces:**
- Consumes: `public.granularidade_calor_enum` (Task 1); `pessoa_em_subarvore_do_actor` (existente, S2); `pessoa`, `secao`, `local_votacao`, `usuario_campanha` (schema existente).
- Produces: `public.forca_por_area(p_granularidade public.granularidade_calor_enum, p_actor_uid uuid) RETURNS TABLE (area_id text, forca integer)`. Task 4 chama esta função com `auth.uid()`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0042_forca_por_area.sql
CREATE OR REPLACE FUNCTION public.forca_por_area(
  p_granularidade public.granularidade_calor_enum,
  p_actor_uid uuid
) RETURNS TABLE (
  area_id text,
  forca integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel public.papel_login;
BEGIN
  SELECT campanha_id, papel INTO v_campanha_id, v_papel
    FROM public.usuario_campanha WHERE user_id = p_actor_uid;
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    CASE WHEN p_granularidade = 'zona' THEN lv.zona_id::text
         ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
    count(p.id)::integer AS forca
  FROM public.pessoa p
  JOIN public.secao s ON s.id = p.secao_id
  JOIN public.local_votacao lv ON lv.id = s.local_id
  WHERE p.campanha_id = v_campanha_id
    AND p.deleted_at IS NULL
    AND (
      v_papel IN ('gestor', 'coordenador')
      OR public.pessoa_em_subarvore_do_actor(p_actor_uid, p.id)
    )
  GROUP BY 1;
END;
$$;
REVOKE ALL ON FUNCTION public.forca_por_area(public.granularidade_calor_enum, uuid) FROM public, authenticated, anon;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `forca_por_area`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture de teste (2 usuários reais em auth.users, 1 campanha temporária, sub-árvore de 2 níveis)**

`forca_por_area` filtra por sub-árvore via `pessoa_em_subarvore_do_actor`, que exige um `user_id` real em `auth.users` (FK de `usuario_campanha.user_id`) — não dá pra testar só com `execute_sql` puro (criar usuário de auth exige o Admin SDK, não INSERT direto). Escreva e rode este script uma vez (não precisa commitar, é fixture de teste, apague depois do Step 5):

```javascript
// scratchpad: fixture-forca-por-area.mjs
// Rodar com: node fixture-forca-por-area.mjs
// Requer as mesmas env vars do resto do projeto (NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SECRET_KEY) — carregue do web/.env.local antes de rodar, ex.:
// (Windows) $env:NEXT_PUBLIC_SUPABASE_URL=...; node fixture-forca-por-area.mjs
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: gestorUser } = await admin.auth.admin.createUser({
  email: 's4-fixture-gestor@teste.local', password: 'SenhaForte!S4a', email_confirm: true,
});
const { data: liderancaUser } = await admin.auth.admin.createUser({
  email: 's4-fixture-lideranca@teste.local', password: 'SenhaForte!S4b', email_confirm: true,
});
console.log('gestor_user_id=', gestorUser.user.id);
console.log('lideranca_user_id=', liderancaUser.user.id);

const { data: camp } = await admin.from('campanha').insert({
  subdominio: 's4-fixture', nome: 'S4 Fixture', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
console.log('campanha_id=', camp.id);

// 2 zonas reais de Teresina distintas, com >=1 secao cada, do lote real
const { data: zonas } = await admin
  .from('secao').select('id, local_votacao!inner(zona_id)').limit(2000);
const zonaIds = [...new Set(zonas.map((s) => s.local_votacao.zona_id))];
const [zonaA, zonaB] = zonaIds; // duas zonas distintas quaisquer do lote real
const secaoA = zonas.find((s) => s.local_votacao.zona_id === zonaA).id;
const secaoB = zonas.find((s) => s.local_votacao.zona_id === zonaB).id;
console.log('zona_a=', zonaA, 'secao_a=', secaoA);
console.log('zona_b=', zonaB, 'secao_b=', secaoB);

const { data: pessoaGestor } = await admin.from('pessoa').insert({
  campanha_id: camp.id, nome: 'Gestor Fixture', base_legal: 'legitimointeresse',
}).select('id').single();
const { data: pessoaLideranca } = await admin.from('pessoa').insert({
  campanha_id: camp.id, nome: 'Lideranca Fixture', secao_id: secaoA,
  base_legal: 'legitimointeresse',
}).select('id').single();
const { data: pessoaApoiadorA } = await admin.from('pessoa').insert({
  campanha_id: camp.id, nome: 'Apoiador Sub-arvore Lideranca', secao_id: secaoA,
  base_legal: 'legitimointeresse',
}).select('id').single();
const { data: pessoaApoiadorB } = await admin.from('pessoa').insert({
  campanha_id: camp.id, nome: 'Apoiador Fora Sub-arvore', secao_id: secaoB,
  base_legal: 'legitimointeresse',
}).select('id').single();

await admin.from('usuario_campanha').insert([
  { user_id: gestorUser.user.id, campanha_id: camp.id, papel: 'gestor', pessoa_id: pessoaGestor.id, cpf_hmac: 'fixture-gestor' },
  { user_id: liderancaUser.user.id, campanha_id: camp.id, papel: 'lideranca', pessoa_id: pessoaLideranca.id, cpf_hmac: 'fixture-lideranca' },
]);

await admin.from('vinculo').insert([
  { campanha_id: camp.id, pessoa_id: pessoaLideranca.id, responsavel_id: pessoaGestor.id, papel: 'lideranca' },
  { campanha_id: camp.id, pessoa_id: pessoaApoiadorA.id, responsavel_id: pessoaLideranca.id, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: pessoaApoiadorB.id, responsavel_id: pessoaGestor.id, papel: 'apoiador' },
]);

console.log('fixture pronta. campanha_id acima — use nas queries de verificação.');
```

- [ ] **Step 4: Verificar visibilidade por sub-árvore via `execute_sql`**

Substitua `<gestor_user_id>`/`<lideranca_user_id>`/`<zona_a>`/`<zona_b>` pelos valores impressos no Step 3.

**Importante sobre `pessoa_em_subarvore_do_actor`:** o caso-base da recursão é
`v.responsavel_id = <pessoa_id do próprio actor>` — ou seja, ela retorna os
DESCENDENTES do actor, nunca o actor mesmo (um vínculo auto-referenciado é
bloqueado pela constraint `vinculo_sem_autoloop`). A própria Liderança
**não** conta na Força que ela mesma vê — só quem está abaixo dela.

```sql
-- Gestor vê a Força inteira da campanha (short-circuit: papel IN
-- ('gestor','coordenador') dispensa a checagem de sub-árvore). 3 pessoas
-- com secao_id preenchido no total: Lideranca (secao_a), ApoiadorA
-- (secao_a), ApoiadorB (secao_b). Gestor não tem secao_id — não aparece em
-- nenhuma área (mesmo sendo quem está chamando).
SELECT * FROM public.forca_por_area('zona', '<gestor_user_id>') ORDER BY area_id;
-- esperado: 2 linhas — zona_a forca=2 (Lideranca + ApoiadorA), zona_b forca=1 (ApoiadorB)

-- Liderança só conta quem está NA SUB-ÁRVORE DELA — ApoiadorA (responsavel_id
-- = pessoaLideranca.id). Ela mesma NÃO conta (não é "descendente de si
-- mesma"). ApoiadorB (fora da sub-árvore, direto sob o Gestor) também não conta.
SELECT * FROM public.forca_por_area('zona', '<lideranca_user_id>') ORDER BY area_id;
-- esperado: 1 linha só — zona_a forca=1 (só ApoiadorA); zona_b não aparece
-- (0 linhas ali, não forca=0 explícito — forca_por_area sozinha simplesmente
-- omite área sem match no WHERE; é o LEFT JOIN de mapa_calor_agregado na
-- Task 4 que preenche isso como 0 explícito no resultado final)

-- pessoa.deleted_at IS NOT NULL não conta (soft-delete)
UPDATE public.pessoa SET deleted_at = now() WHERE id = (
  SELECT id FROM public.pessoa WHERE campanha_id = '<campanha_id>' AND nome = 'Apoiador Sub-arvore Lideranca'
);
SELECT * FROM public.forca_por_area('zona', '<lideranca_user_id>');
-- esperado: 0 linhas — o único pessoa que a Liderança podia ver (ApoiadorA)
-- acabou de ser soft-deletado; zona_a não aparece mais, nenhuma outra área
-- tinha match pra ela

-- usuário sem usuario_campanha retorna vazio, não erro
SELECT * FROM public.forca_por_area('zona', gen_random_uuid());
-- esperado: 0 linhas, sem exceção
```

- [ ] **Step 5: Limpar a fixture**

```sql
-- via execute_sql, usando o <campanha_id> da fixture
DELETE FROM public.vinculo WHERE campanha_id = '<campanha_id>';
DELETE FROM public.pessoa WHERE campanha_id = '<campanha_id>';
DELETE FROM public.usuario_campanha WHERE campanha_id = '<campanha_id>';
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

```javascript
// e via Admin SDK (mesmo script/console usado no Step 3)
await admin.auth.admin.deleteUser('<gestor_user_id>');
await admin.auth.admin.deleteUser('<lideranca_user_id>');
```

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos.

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0042_forca_por_area.sql
git commit -m "feat(s4): forca_por_area — contagem de pessoas por área com visibilidade por sub-árvore"
```

Não commitar o script de fixture (é scratch de verificação, não faz parte do produto).

---

### Task 4: `mapa_calor_agregado` — função pública, combina Potencial+Força+Penetração

**Files:**
- Create: `supabase/migrations/0043_mapa_calor_agregado.sql`

**Interfaces:**
- Consumes: `public.potencial_por_area` (Task 2), `public.forca_por_area` (Task 3), `public.granularidade_calor_enum` (Task 1).
- Produces: `public.mapa_calor_agregado(granularidade public.granularidade_calor_enum) RETURNS TABLE (area_id text, area_nome text, forca integer, potencial integer, penetracao numeric, ponto_geojson jsonb)` — única função `GRANT`ada pra `authenticated`. Task 5 (rota Next.js) chama via `supabase.rpc('mapa_calor_agregado', { granularidade })`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0043_mapa_calor_agregado.sql
CREATE OR REPLACE FUNCTION public.mapa_calor_agregado(
  granularidade public.granularidade_calor_enum
) RETURNS TABLE (
  area_id text,
  area_nome text,
  forca integer,
  potencial integer,
  penetracao numeric,
  ponto_geojson jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Só GRANT'ada pra authenticated (que sempre carrega um JWT válido), então
  -- auth.uid() NULL não deveria acontecer na prática — mas retorna vazio em
  -- vez de assumir, mesmo padrão de defesa do "sem campanha_id" acima.
  IF auth.uid() IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    pa.area_id, pa.area_nome,
    coalesce(fa.forca, 0),
    pa.potencial,
    CASE WHEN pa.potencial > 0
         THEN round(coalesce(fa.forca, 0)::numeric / pa.potencial, 4)
         ELSE NULL END,
    pa.ponto_geojson
  FROM public.potencial_por_area(granularidade) pa
  LEFT JOIN public.forca_por_area(granularidade, auth.uid()) fa ON fa.area_id = pa.area_id
  ORDER BY pa.area_nome;
END;
$$;
REVOKE ALL ON FUNCTION public.mapa_calor_agregado(public.granularidade_calor_enum) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mapa_calor_agregado(public.granularidade_calor_enum) TO authenticated;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `mapa_calor_agregado`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Verificar assinatura pública (prova estrutural anti-spoofing) via `execute_sql`**

```sql
SELECT pg_get_function_identity_arguments('public.mapa_calor_agregado(public.granularidade_calor_enum)'::regprocedure);
-- esperado: "granularidade granularidade_calor_enum" — UM parâmetro só,
-- sem uuid nenhum. Isso é a prova de que não dá pra chamar a RPC passando
-- a identidade de outra pessoa: a função só aceita granularidade, e lê
-- auth.uid() internamente, não de um argumento.

SELECT grantee, privilege_type FROM information_schema.role_routine_grants
 WHERE routine_name = 'mapa_calor_agregado';
-- esperado: 1 linha, grantee='authenticated', privilege_type='EXECUTE'
```

- [ ] **Step 4: Verificar penetração/join/ordenação via `execute_sql`, reusando a fixture do Task 3 recriada (repita o Step 3 do Task 3, sem repetir os Steps 4-5 — ou seja, crie de novo, teste aqui, e só então limpe)**

```sql
-- Gestor: todas as áreas de potencial>0 aparecem, mesmo sem nenhuma pessoa
-- ligada (forca=0 explícito, não some a linha) — prova que o LEFT JOIN
-- funciona corretamente mesmo pra área sem Força nenhuma
SELECT area_id, forca, potencial, penetracao
  FROM public.mapa_calor_agregado('zona')
 ORDER BY area_id
 LIMIT 20;
-- esperado: nenhuma linha com forca NULL (sempre 0 no mínimo); penetracao
-- NULL só quando potencial=0; penetracao com no máximo 4 casas decimais

-- Ordenação determinística
SELECT area_nome FROM public.mapa_calor_agregado('zona');
-- esperado: lista já vem em ordem alfabética/numérica de area_nome

-- Isolamento entre campanhas: crie uma SEGUNDA campanha de fixture (mesmo
-- municipio_id=2211001) reusando as mesmas zona_a/zona_b (dado do TRE é
-- global, não por campanha) com pessoas PRÓPRIAS ligadas às mesmas seções;
-- confirme que a Força de uma campanha nunca soma na Força da outra:
SELECT forca FROM public.mapa_calor_agregado('zona') -- chamado como gestor da campanha 1
 WHERE area_id = '<zona_a>';
-- depois logue como gestor da campanha 2 (outro p_actor_uid) e confirme
-- que o número de forca em zona_a é o da campanha 2, não a soma das duas
```

- [ ] **Step 5: Limpar toda fixture (Task 3 + Task 4)**

Repetir Step 5 do Task 3 pra cada campanha de fixture criada (incluindo a segunda campanha de isolamento do Step 4).

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos além do WARN esperado (`mapa_calor_agregado` executável por `authenticated`).

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0043_mapa_calor_agregado.sql
git commit -m "feat(s4): mapa_calor_agregado — função pública, lê auth.uid() internamente"
```

---

### Task 5: `GET /api/mapa-calor`

**Files:**
- Create: `web/app/api/mapa-calor/route.ts`
- Create: `web/app/api/mapa-calor/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`), RPC `mapa_calor_agregado` (Task 4).
- Produces: `GET` handler retornando `NextResponse` com array de `{area_id, area_nome, forca, potencial, penetracao, ponto_geojson}` (200), `{erro}` (401/400/500). Task 7 (client component) faz `fetch('/api/mapa-calor?granularidade=...')` contra esta rota.

- [ ] **Step 1: Escrever o teste (mock de `ssrClient`, mesmo padrão de `web/app/api/notificacoes/route.test.ts`)**

```typescript
// web/app/api/mapa-calor/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const mockAreas = [
  { area_id: 'zona-1', area_nome: '1', forca: 10, potencial: 100, penetracao: 0.1, ponto_geojson: { type: 'Point', coordinates: [-42.8, -5.09] } },
];

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = mockAreas, rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

import { GET } from './route';
import { ssrClient } from '../../../lib/supabase/ssr';

describe('GET /api/mapa-calor', () => {
  it('retorna array de áreas com granularidade default (zona)', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockAreas);
    expect(supabase.rpc).toHaveBeenCalledWith('mapa_calor_agregado', { granularidade: 'zona' });
  });

  it('repassa granularidade=bairro da query string', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    await GET(new Request('http://localhost/api/mapa-calor?granularidade=bairro') as never);
    expect(supabase.rpc).toHaveBeenCalledWith('mapa_calor_agregado', { granularidade: 'bairro' });
  });

  it('400 pra granularidade inválida', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor?granularidade=municipio') as never);
    expect(res.status).toBe(400);
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor') as never);
    expect(res.status).toBe(401);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET(new Request('http://localhost/api/mapa-calor') as never);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (arquivo `route.ts` não existe ainda)**

Run: `cd web && npx vitest run app/api/mapa-calor/route.test.ts`
Expected: FAIL — `Cannot find module './route'` (ou equivalente)

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/mapa-calor/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';

const GRANULARIDADES = ['zona', 'bairro'] as const;
type Granularidade = (typeof GRANULARIDADES)[number];

function granularidadeValida(v: string | null): v is Granularidade {
  return v !== null && (GRANULARIDADES as readonly string[]).includes(v);
}

export async function GET(req: NextRequest) {
  const granularidadeParam = new URL(req.url).searchParams.get('granularidade') ?? 'zona';
  if (!granularidadeValida(granularidadeParam)) {
    return NextResponse.json({ erro: 'granularidade inválida' }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase.rpc('mapa_calor_agregado', {
    granularidade: granularidadeParam,
  });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/mapa-calor/route.test.ts`
Expected: PASS — 5/5

- [ ] **Step 5: Commit**

```bash
git add web/app/api/mapa-calor/route.ts web/app/api/mapa-calor/route.test.ts
git commit -m "feat(s4): GET /api/mapa-calor — expõe mapa_calor_agregado via RPC"
```

---

### Task 6: Página `/mapa-calor` — checagem de sessão

**Files:**
- Create: `web/app/mapa-calor/page.tsx`
- Create: `web/app/mapa-calor/page.test.tsx`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`); `MapaCalorClient` (Task 7 — este task cria um placeholder mínimo que a Task 7 substitui pelo componente real; ver Step 3).
- Produces: página server component em `/mapa-calor`, sem novo dep de teste (usa `renderToStaticMarkup` puro, sem jsdom).

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/mapa-calor/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('./MapaCalorClient', () => ({
  MapaCalorClient: () => 'mapa-calor-client-mock',
}));

import { ssrClient } from '../../lib/supabase/ssr';
import Page from './page';

describe('/mapa-calor page', () => {
  it('mostra mensagem quando não autenticado, sem renderizar o mapa', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('não autenticado');
    expect(html).not.toContain('mapa-calor-client-mock');
  });

  it('renderiza o mapa quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('mapa-calor-client-mock');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/mapa-calor/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 3: Implementar a página + placeholder de `MapaCalorClient` (substituído de verdade na Task 7)**

```tsx
// web/app/mapa-calor/page.tsx
import { cookies } from 'next/headers';
import { ssrClient } from '../../lib/supabase/ssr';
import { MapaCalorClient } from './MapaCalorClient';

export default async function MapaCalorPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <p>Você precisa estar autenticado para ver o mapa de calor.</p>;
  }

  return <MapaCalorClient />;
}
```

```tsx
// web/app/mapa-calor/MapaCalorClient.tsx (placeholder — Task 7 substitui pelo componente MapLibre real)
'use client';
export function MapaCalorClient() {
  return <div>mapa em construção</div>;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/mapa-calor/page.test.tsx`
Expected: PASS — 2/2

- [ ] **Step 5: Commit**

```bash
git add web/app/mapa-calor/page.tsx web/app/mapa-calor/page.test.tsx web/app/mapa-calor/MapaCalorClient.tsx
git commit -m "feat(s4): página /mapa-calor — checagem de sessão server-side"
```

---

### Task 7: `MapaCalorClient` — MapLibre GL, seletor de camada e granularidade

**Files:**
- Modify: `web/app/mapa-calor/MapaCalorClient.tsx` (substitui o placeholder da Task 6)
- Create: `web/app/mapa-calor/MapaCalorClient.test.tsx`
- Modify: `web/package.json` (novas deps: `maplibre-gl`; devDeps: `jsdom`, `@testing-library/react`)

**Interfaces:**
- Consumes: `GET /api/mapa-calor?granularidade=` (Task 5) via `fetch`.
- Produces: componente `MapaCalorClient` (default export nomeado, mesma assinatura do placeholder da Task 6 — nenhuma mudança de interface pro `page.tsx`).

- [ ] **Step 1: Instalar dependências**

```bash
cd web && npm install maplibre-gl && npm install --save-dev jsdom @testing-library/react
```

- [ ] **Step 2: Escrever o teste (ambiente jsdom só neste arquivo, via pragma — não muda os outros testes)**

```tsx
// web/app/mapa-calor/MapaCalorClient.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

class MockMap {
  on() {}
  remove() {}
}
class MockMarker {
  setLngLat() { return this; }
  setPopup() { return this; }
  addTo() { return this; }
  remove() {}
}
class MockPopup {
  setHTML() { return this; }
}
vi.mock('maplibre-gl', () => ({
  default: { Map: MockMap, Marker: MockMarker, Popup: MockPopup },
}));

const mockAreas = [
  { area_id: 'zona-1', area_nome: '1', forca: 10, potencial: 100, penetracao: 0.1, ponto_geojson: { type: 'Point', coordinates: [-42.8, -5.09] } },
];

import { MapaCalorClient } from './MapaCalorClient';

describe('MapaCalorClient', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => mockAreas,
    })) as never;
  });

  it('busca dados com granularidade=zona por padrão', async () => {
    render(<MapaCalorClient />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/mapa-calor?granularidade=zona');
    });
  });

  it('troca granularidade e refaz o fetch com bairro', async () => {
    render(<MapaCalorClient />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/granularidade/i), { target: { value: 'bairro' } });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/mapa-calor?granularidade=bairro');
    });
  });

  it('trocar camada NÃO refaz o fetch (dado já veio todo de uma vez)', async () => {
    render(<MapaCalorClient />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/camada/i), { target: { value: 'potencial' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<MapaCalorClient />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/mapa-calor/MapaCalorClient.test.tsx`
Expected: FAIL — placeholder atual não tem seletor de granularidade/camada nem faz fetch

- [ ] **Step 4: Implementar o componente real**

```tsx
// web/app/mapa-calor/MapaCalorClient.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

type Granularidade = 'zona' | 'bairro';
type Camada = 'forca' | 'potencial' | 'penetracao';

type AreaCalor = {
  area_id: string;
  area_nome: string;
  forca: number;
  potencial: number;
  penetracao: number | null;
  ponto_geojson: { type: 'Point'; coordinates: [number, number] } | null;
};

const CORES: Record<Camada, string> = {
  forca: '#2563eb',
  potencial: '#16a34a',
  penetracao: '#dc2626',
};

export function MapaCalorClient() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [granularidade, setGranularidade] = useState<Granularidade>('zona');
  const [camada, setCamada] = useState<Camada>('forca');
  const [areas, setAreas] = useState<AreaCalor[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch(`/api/mapa-calor?granularidade=${granularidade}`)
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar mapa de calor');
        return res.json();
      })
      .then((data: AreaCalor[]) => {
        if (!cancelado) setAreas(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar os dados do mapa.');
      });
    return () => {
      cancelado = true;
    };
  }, [granularidade]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [-42.8034, -5.0892],
      zoom: 11,
    });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers: maplibregl.Marker[] = [];
    for (const area of areas) {
      if (!area.ponto_geojson) continue;
      const valor = area[camada];
      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.background = CORES[camada];
      el.style.opacity = valor === null ? '0.2' : '1';

      const popup = new maplibregl.Popup({ offset: 12 }).setHTML(
        `<strong>${area.area_nome}</strong><br/>Força: ${area.forca}<br/>Potencial: ${area.potencial}<br/>Penetração: ${area.penetracao ?? 'sem dado'}`,
      );

      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat(area.ponto_geojson.coordinates)
          .setPopup(popup)
          .addTo(map),
      );
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [areas, camada]);

  return (
    <div>
      <div>
        <label>
          Granularidade:
          <select
            value={granularidade}
            onChange={(e) => setGranularidade(e.target.value as Granularidade)}
          >
            <option value="zona">Zona</option>
            <option value="bairro">Bairro</option>
          </select>
        </label>
        <label>
          Camada:
          <select value={camada} onChange={(e) => setCamada(e.target.value as Camada)}>
            <option value="forca">Força</option>
            <option value="potencial">Potencial</option>
            <option value="penetracao">Penetração</option>
          </select>
        </label>
      </div>
      {erro && <p role="alert">{erro}</p>}
      <div ref={mapContainerRef} style={{ width: '100%', height: '600px' }} />
    </div>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/mapa-calor/MapaCalorClient.test.tsx`
Expected: PASS — 4/4

- [ ] **Step 6: Rodar a suíte inteira (confirma que o novo `@vitest-environment jsdom` pragma não vazou pra outros arquivos)**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes (rodando em `node`, não `jsdom`)

- [ ] **Step 7: Rodar `npx tsc --noEmit`, confirmar zero erros novos em `app/mapa-calor/`**

- [ ] **Step 8: Commit**

```bash
git add web/app/mapa-calor/MapaCalorClient.tsx web/app/mapa-calor/MapaCalorClient.test.tsx web/package.json web/package-lock.json
git commit -m "feat(s4): MapaCalorClient — MapLibre GL + OSM, seletor de camada/granularidade"
```

---

### Task 8: Publicar o lote real + verificação end-to-end manual

**Files:** nenhum arquivo de código — task operacional/verificação, sem implementação nova.

**Interfaces:** nenhuma nova. Consome tudo das Tasks 1-7.

- [ ] **Step 1: Confirmar estado do lote real**

```sql
SELECT id, status, total_publicados FROM public.importacao_tre
 WHERE id = '81d77111-c382-4849-9616-774d4fdff7f5';
-- esperado: status='pendente_revisao', total_publicados=334 (herdado do S3)
```

- [ ] **Step 2: Rodar `tre:geocode` (fora do escopo desta fatia decidir SE geocodificar — só é pré-requisito operacional já documentado no S3/S4 spec). Rodar em foreground, aguardar (Nominatim é 1 req/s — até ~6min pra 334 linhas):**

```bash
cd web && npx tsx --env-file=.env.local scripts/tre/cli/geocode.ts --importacao 81d77111-c382-4849-9616-774d4fdff7f5
```

- [ ] **Step 3: Publicar o lote**

```bash
cd web && npx tsx --env-file=.env.local scripts/tre/cli/publicar.ts --importacao 81d77111-c382-4849-9616-774d4fdff7f5
```

- [ ] **Step 4: Verificar via `execute_sql` que o mapa tem dado real pra mostrar**

```sql
SELECT count(*) FROM public.mapa_calor_agregado('zona') AS m
 -- chamado impersonando um gestor real de uma campanha municipal de Teresina
 -- (reusar usuário de teste já seedado — s1_seed_usuarios.mjs — se a
 -- campanha dele for municipio_id=2211001; senão, criar fixture temporária
 -- igual à do Task 3/4, rodar aqui, e limpar depois)
WHERE m.ponto_geojson IS NOT NULL;
-- esperado: > 0 linhas com ponto_geojson preenchido (geocode rodou)
```

- [ ] **Step 5: Verificação manual no browser**

```bash
cd web && npm run dev
```

Logar com um usuário de teste de uma campanha municipal de Teresina, acessar `/mapa-calor`. Confirmar visualmente: mapa carrega com tiles OSM, pontos aparecem sobre Teresina, trocar camada (Força/Potencial/Penetração) muda a cor sem recarregar, trocar granularidade (zona/bairro) refaz o fetch e muda os pontos, clicar num ponto abre popup com os 3 números.

- [ ] **Step 6: Documentar o resultado**

Anotar no relatório da task: screenshot ou descrição do que foi visto, contagem de áreas/pontos reais exibidos, qualquer problema visual encontrado (mesmo que não bloqueie — registrar como débito, não corrigir silenciosamente fora do plano).

---

## Self-Review

**1. Cobertura do spec:** decisões 1 (full-stack) → Tasks 5-7; decisão 2 (só municipal) → nenhum código de drill-down escrito, confirmado; decisão 3 (bairro via `normalizar_texto`, toggle) → Task 2/7; decisão 4 (3 funções, 1 pública) → Tasks 2-4; decisão 5 (Potencial) → Task 2; decisão 6 (Força = qualquer papel) → Task 3 (fixture usa `apoiador` e a própria Liderança contando); decisão 7 (Penetração NULL) → Task 4; decisão 8 (visibilidade sub-árvore) → Task 3; decisão 9 (sem cache) → nenhuma task adiciona cache, confirmado; decisão 10-11 (GRANT + auth.uid()) → Task 4; decisão 12 (pré-requisito operacional) → Task 8. Não-objetivos: nenhuma task toca CEP, estadual, voto-por-local, cache, dashboard maior — confirmado por omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda task tem SQL/TS completo.

**3. Consistência de tipos:** `ponto_geojson` usado com o mesmo shape (`{type: 'Point', coordinates: [number, number]}`) em Task 2 (SQL), Task 5 (rota), Task 7 (client) — confirmado. `Granularidade`/`Camada` como union types consistentes entre Task 5 (`'zona'|'bairro'` runtime array) e Task 7 (mesmo union). `AreaCalor` (Task 7) tem exatamente os campos que `mapa_calor_agregado` retorna (Task 4) — `area_id, area_nome, forca, potencial, penetracao, ponto_geojson`, mesma ordem/nomes.

**Gap encontrado e corrigido durante o self-review:** a spec original dizia a página `/mapa-calor` seguiria "mesmo padrão de `/redefinir-senha`" pra redirecionar sem sessão — mas `/redefinir-senha` não checa sessão nenhuma (é client-only, sem guard). Não existe página de login no app. Resolvido na sessão de planejamento: Task 6 mostra mensagem simples, sem redirecionar — não constrói login nesta fatia (fora de escopo, não foi brainstormed).

---

Plano completo e salvo em `docs/superpowers/plans/2026-07-03-s4-mapa-calor.md`.
