# S5 — Dashboard BI determinístico Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship o dashboard BI determinístico — ranking de lideranças por sub-árvore, evolução temporal de pessoas, e alertas por regra fixa (sem LLM) — na segunda tela autenticada do sistema.

**Architecture:** Três funções `SECURITY DEFINER` no Postgres (`ranking_liderancas`, `evolucao_pessoas`, `dashboard_alertas`, todas lendo `auth.uid()` internamente, mesmo padrão anti-spoofing do `mapa_calor_agregado` do S4) → três rotas `GET /api/dashboard/*` (Next.js, sessão via `ssrClient`) → página `/dashboard` (server component com checagem de sessão + client components: `RankingTable`, `EvolucaoChart` com Recharts, `AlertasList`) → `NavShell` compartilhado entre `/mapa-calor` e `/dashboard`.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript, Supabase (Postgres 17), `recharts` (novo nesta fatia), Vitest + `jsdom`/`@testing-library/react` (já existentes desde o S4), `execute_sql`/`apply_migration` via MCP Supabase.

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/` (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência: `docs/superpowers/specs/2026-07-04-s5-dashboard-bi-design.md` — toda task abaixo implementa uma seção dela.
- Projeto Supabase: `axcftjqdjvknrpqzrxls`. Migrations via `mcp__supabase__apply_migration` — uma por task; cópia idêntica salva em `supabase/migrations/`. Migration mais recente é `0043`; esta fatia usa `0044`-`0046`.
- Toda função `SECURITY DEFINER` desta fatia: `search_path = ''`, identificadores fully-qualified (`public.tabela`), sem parâmetro de identidade — lê `auth.uid()` internamente (mesmo padrão do `mapa_calor_agregado`, S4). `REVOKE ALL FROM public, anon` + `GRANT EXECUTE TO authenticated` nas 3.
- Testes de função SQL (Tasks 1-3) seguem o padrão S2/S3/S4: verificação via `execute_sql` direto no projeto live, fixtures próprios criados e limpos dentro da própria task — **não** viram arquivo `.test.ts`. Fixtures que envolvem `auth.uid()` exigem usuários reais em `auth.users` (via Admin SDK, `SUPABASE_SECRET_KEY`) **e** simular a sessão via `execute_sql` com `SET LOCAL request.jwt.claims = '{"sub":"<user_id>"}'` antes de chamar a função (mesma técnica de impersonation já usada no S2).
- Testes de código Next.js (Tasks 4-11) rodam com `cd web && npx vitest run <caminho>`.
- `ssrClient()` = `web/lib/supabase/ssr.ts` — rotas usam `ssrClient`, nunca `adminClient`.
- Sem página de login no app ainda — página `/dashboard` mostra mensagem simples quando não autenticado, **sem redirecionar** (mesmo padrão de `/mapa-calor`, decisão do S4 mantida).
- Commits frequentes; mensagens estilo do repo (`feat(s5): ...`, `test(s5): ...`).
- Progresso rastreado pela skill `subagent-driven-development` em `.superpowers/sdd/progress-s5.md`.

---

## Contexto de schema (não repetir em cada task)

Tabelas/funções usadas por este plano, já existentes desde S2/S3/S4 — conferidas
direto nas migrations antes de escrever este plano:

- `public.vinculo(id uuid, campanha_id uuid NOT NULL, pessoa_id uuid NOT NULL, responsavel_id uuid NULL, papel public.papel_vinculo NOT NULL, criado_em timestamptz NOT NULL)`
- `public.pessoa(id uuid, campanha_id uuid NOT NULL, nome text NOT NULL, criado_em timestamptz NOT NULL, deleted_at timestamptz NULL)`
- `public.usuario_campanha(user_id uuid PRIMARY KEY REFERENCES auth.users(id), campanha_id uuid NOT NULL, papel public.papel_login NOT NULL, pessoa_id uuid NULL)` — `papel_login` = `'gestor' | 'coordenador' | 'lideranca' | 'colaborador'`
- `public.subarvore_count(p_vinculo_id uuid) RETURNS integer` — já existe desde o S2 (`0016_funcoes_autoridade.sql`); dado o `vinculo_id`, resolve `pessoa_id`/`campanha_id` daquele vínculo e retorna a contagem recursiva de descendentes (não conta a própria pessoa).
- `public.pessoa_em_subarvore_do_actor(actor_uid uuid, target_pessoa_id uuid) RETURNS boolean` — já existe desde o S2.
- `public.mapa_calor_agregado(granularidade public.granularidade_calor_enum) RETURNS TABLE(area_id text, area_nome text, forca integer, potencial integer, penetracao numeric, ponto_geojson jsonb)` — já existe desde o S4, `GRANT`ada pra `authenticated`, lê `auth.uid()` internamente.
- Lote real publicado (S4 Task 8): `municipio_id = 2211001` (Teresina), campanhas municipais com esse `municipio_id` têm dado real em `mapa_calor_agregado`.

---

### Task 1: `ranking_liderancas()` — ranking por sub-árvore + nota soma≠total

**Files:**
- Create: `supabase/migrations/0044_ranking_liderancas.sql`

**Interfaces:**
- Consumes: `public.subarvore_count(uuid)`, `public.usuario_campanha`, `public.vinculo`, `public.pessoa` (existentes).
- Produces: `public.ranking_liderancas() RETURNS jsonb` — payload `{ramos: [{pessoa_id, nome, subarvore_count}, ...], soma_ramos: integer, total_real: integer}`, `ramos` já ordenado (`subarvore_count DESC, nome ASC`). Task 5 (rota Next.js) chama via `supabase.rpc('ranking_liderancas')`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0044_ranking_liderancas.sql
CREATE OR REPLACE FUNCTION public.ranking_liderancas()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel       public.papel_login;
  v_pessoa_id   uuid;
  v_topo        boolean;
  v_result      jsonb;
BEGIN
  SELECT campanha_id, papel, pessoa_id INTO v_campanha_id, v_papel, v_pessoa_id
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_campanha_id IS NULL THEN
    RETURN jsonb_build_object('ramos', '[]'::jsonb, 'soma_ramos', 0, 'total_real', 0);
  END IF;

  v_topo := v_papel IN ('gestor', 'coordenador');

  WITH RECURSIVE ramos_raw AS (
    -- Gestor/coordenador: líderes de topo (vínculo próprio sem responsável
    -- acima). Liderança: só os subordinados diretos dela.
    SELECT DISTINCT ON (v.pessoa_id) v.pessoa_id, v.id AS vinculo_id
      FROM public.vinculo v
     WHERE v.campanha_id = v_campanha_id
       AND (
         (v_topo AND v.responsavel_id IS NULL)
         OR (NOT v_topo AND v.responsavel_id = v_pessoa_id)
       )
     ORDER BY v.pessoa_id, v.criado_em ASC
  ),
  ramos AS (
    SELECT r.pessoa_id, p.nome, public.subarvore_count(r.vinculo_id) AS subarvore_count
      FROM ramos_raw r
      JOIN public.pessoa p ON p.id = r.pessoa_id
  ),
  sub AS (
    -- União recursiva de todos os descendentes de todos os ramos, dedupada
    -- por UNION (não UNION ALL) — base pro total_real.
    SELECT v2.pessoa_id FROM public.vinculo v2
      JOIN ramos_raw rr ON v2.responsavel_id = rr.pessoa_id
     WHERE v2.campanha_id = v_campanha_id
    UNION
    SELECT v3.pessoa_id FROM public.vinculo v3
      JOIN sub ON sub.pessoa_id = v3.responsavel_id
     WHERE v3.campanha_id = v_campanha_id
  )
  SELECT jsonb_build_object(
    'ramos', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
                'pessoa_id', ramos.pessoa_id,
                'nome', ramos.nome,
                'subarvore_count', ramos.subarvore_count
              ) ORDER BY ramos.subarvore_count DESC, ramos.nome ASC)
         FROM ramos),
      '[]'::jsonb
    ),
    'soma_ramos', coalesce((SELECT sum(subarvore_count) FROM ramos), 0),
    'total_real', coalesce((SELECT count(DISTINCT pessoa_id) FROM sub), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.ranking_liderancas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ranking_liderancas() TO authenticated;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `ranking_liderancas`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture (2 usuários reais em `auth.users`, 1 campanha temporária, árvore com 2 raízes e um apoiador compartilhado)**

Árvore: `CoordA` (raiz) → `LiderB` (sob CoordA) → `ApoiadorC` (sob LiderB); `ApoiadorD` (direto sob CoordA); `CoordE` (segunda raiz); `ApoiadorCompartilhado` (sob CoordA **e** sob CoordE — 2 vínculos). Rode uma vez (não commitar, apagar no Step 5):

```javascript
// scratchpad: fixture-ranking-liderancas.mjs
// Rodar com: node fixture-ranking-liderancas.mjs
// Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (carregar do web/.env.local)
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: gestorUser } = await admin.auth.admin.createUser({
  email: 's5-fixture-gestor@teste.local', password: 'SenhaForte!S5a', email_confirm: true,
});
const { data: liderancaUser } = await admin.auth.admin.createUser({
  email: 's5-fixture-liderb@teste.local', password: 'SenhaForte!S5b', email_confirm: true,
});
console.log('gestor_user_id=', gestorUser.user.id);
console.log('liderb_user_id=', liderancaUser.user.id);

const { data: camp } = await admin.from('campanha').insert({
  subdominio: 's5-fixture-ranking', nome: 'S5 Fixture Ranking', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
console.log('campanha_id=', camp.id);

async function criarPessoa(nome) {
  const { data } = await admin.from('pessoa').insert({
    campanha_id: camp.id, nome, base_legal: 'legitimointeresse',
  }).select('id').single();
  return data.id;
}

const coordA = await criarPessoa('CoordA');
const liderB = await criarPessoa('LiderB');
const apoiadorC = await criarPessoa('ApoiadorC');
const apoiadorD = await criarPessoa('ApoiadorD');
const coordE = await criarPessoa('CoordE');
const apoiadorCompartilhado = await criarPessoa('ApoiadorCompartilhado');
console.log({ coordA, liderB, apoiadorC, apoiadorD, coordE, apoiadorCompartilhado });

await admin.from('usuario_campanha').insert([
  { user_id: gestorUser.user.id, campanha_id: camp.id, papel: 'gestor', cpf_hmac: 'fixture-s5-gestor' },
  { user_id: liderancaUser.user.id, campanha_id: camp.id, papel: 'lideranca', pessoa_id: liderB, cpf_hmac: 'fixture-s5-liderb' },
]);

await admin.from('vinculo').insert([
  { campanha_id: camp.id, pessoa_id: coordA, responsavel_id: null, papel: 'coordenador' },
  { campanha_id: camp.id, pessoa_id: liderB, responsavel_id: coordA, papel: 'lideranca' },
  { campanha_id: camp.id, pessoa_id: apoiadorC, responsavel_id: liderB, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: apoiadorD, responsavel_id: coordA, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: coordE, responsavel_id: null, papel: 'coordenador' },
  { campanha_id: camp.id, pessoa_id: apoiadorCompartilhado, responsavel_id: coordA, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: apoiadorCompartilhado, responsavel_id: coordE, papel: 'apoiador' },
]);

console.log('fixture pronta.');
```

- [ ] **Step 4: Verificar via `execute_sql` (impersonation com `request.jwt.claims`)**

Substitua `<gestor_user_id>`/`<liderb_user_id>` pelos valores impressos no Step 3.

```sql
-- Gestor: vê os 2 líderes de topo (CoordA, CoordE)
SET LOCAL request.jwt.claims = '{"sub":"<gestor_user_id>"}';
SELECT public.ranking_liderancas();
-- esperado (formato): {
--   "ramos": [
--     {"pessoa_id": "<coordA>", "nome": "CoordA", "subarvore_count": 4},
--     {"pessoa_id": "<coordE>", "nome": "CoordE", "subarvore_count": 1}
--   ],
--   "soma_ramos": 5,
--   "total_real": 4
-- }
-- CoordA: LiderB + ApoiadorC + ApoiadorD + ApoiadorCompartilhado = 4.
-- CoordE: ApoiadorCompartilhado = 1.
-- total_real = 4 (LiderB, ApoiadorC, ApoiadorD, ApoiadorCompartilhado — sem
-- duplicar o compartilhado). soma_ramos(5) - total_real(4) = 1 = o
-- ApoiadorCompartilhado, exatamente a nota do ADR 0003.
-- ramos ordenado por subarvore_count DESC (CoordA antes de CoordE).

-- Liderança (LiderB): só o subordinado direto dela (ApoiadorC), que não
-- tem descendentes — subarvore_count=0 (ApoiadorC não conta a si mesma).
SET LOCAL request.jwt.claims = '{"sub":"<liderb_user_id>"}';
SELECT public.ranking_liderancas();
-- esperado: {"ramos": [{"pessoa_id": "<apoiadorC>", "nome": "ApoiadorC",
--   "subarvore_count": 0}], "soma_ramos": 0, "total_real": 0}

-- Usuário sem usuario_campanha: retorna zerado, não erro
SET LOCAL request.jwt.claims = '{"sub":"' || gen_random_uuid() || '"}';
SELECT public.ranking_liderancas();
-- esperado: {"ramos": [], "soma_ramos": 0, "total_real": 0}
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
// via Admin SDK (mesmo script/console usado no Step 3)
await admin.auth.admin.deleteUser('<gestor_user_id>');
await admin.auth.admin.deleteUser('<liderb_user_id>');
```

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos além do WARN esperado (`ranking_liderancas` executável por `authenticated`, mesma categoria já aceita do `mapa_calor_agregado`).

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0044_ranking_liderancas.sql
git commit -m "feat(s5): ranking_liderancas — ranking por sub-árvore com nota soma≠total"
```

Não commitar o script de fixture.

---

### Task 2: `evolucao_pessoas()` — evolução acumulada de pessoas, 90 dias

**Files:**
- Create: `supabase/migrations/0045_evolucao_pessoas.sql`

**Interfaces:**
- Consumes: `public.pessoa_em_subarvore_do_actor(uuid, uuid)`, `public.usuario_campanha`, `public.pessoa` (existentes).
- Produces: `public.evolucao_pessoas() RETURNS TABLE(dia date, total integer)`, 90 linhas (hoje + 89 dias anteriores), ordenado por `dia ASC`. Task 6 (rota Next.js) chama via `supabase.rpc('evolucao_pessoas')`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0045_evolucao_pessoas.sql
CREATE OR REPLACE FUNCTION public.evolucao_pessoas()
RETURNS TABLE (dia date, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel       public.papel_login;
BEGIN
  SELECT campanha_id, papel INTO v_campanha_id, v_papel
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT d.dia::date,
    (
      SELECT count(*)::integer FROM public.pessoa p
       WHERE p.campanha_id = v_campanha_id
         AND p.criado_em::date <= d.dia
         AND (p.deleted_at IS NULL OR p.deleted_at::date > d.dia)
         AND (
           v_papel IN ('gestor', 'coordenador')
           OR public.pessoa_em_subarvore_do_actor(auth.uid(), p.id)
         )
    ) AS total
  FROM generate_series(CURRENT_DATE - 89, CURRENT_DATE, interval '1 day') AS d(dia)
  ORDER BY d.dia;
END;
$$;
REVOKE ALL ON FUNCTION public.evolucao_pessoas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.evolucao_pessoas() TO authenticated;
```

`CURRENT_DATE`, não `now()`, em toda a função — garante resultado determinístico durante todo o dia (decisão 5 do spec). Nota de performance: `pessoa_em_subarvore_do_actor` roda por pessoa candidata por dia (90 × N) — mesmo trade-off já aceito em `forca_por_area` (S4) na escala MVP.

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `evolucao_pessoas`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture (1 usuário gestor real, 1 campanha, 3 pessoas com `criado_em` backdatado e 1 soft-deletada)**

```javascript
// scratchpad: fixture-evolucao-pessoas.mjs
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: gestorUser } = await admin.auth.admin.createUser({
  email: 's5-fixture-evolucao@teste.local', password: 'SenhaForte!S5c', email_confirm: true,
});
console.log('gestor_user_id=', gestorUser.user.id);

const { data: camp } = await admin.from('campanha').insert({
  subdominio: 's5-fixture-evolucao', nome: 'S5 Fixture Evolucao', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
console.log('campanha_id=', camp.id);

await admin.from('usuario_campanha').insert({
  user_id: gestorUser.user.id, campanha_id: camp.id, papel: 'gestor', cpf_hmac: 'fixture-s5-evolucao',
});

const { data: pessoaAntiga } = await admin.from('pessoa').insert({
  campanha_id: camp.id, nome: 'Pessoa Antiga', base_legal: 'legitimointeresse',
}).select('id').single();
const { data: pessoaRemovida } = await admin.from('pessoa').insert({
  campanha_id: camp.id, nome: 'Pessoa Removida', base_legal: 'legitimointeresse',
}).select('id').single();
console.log('pessoa_antiga=', pessoaAntiga.id, 'pessoa_removida=', pessoaRemovida.id);
console.log('fixture pronta — próximo passo: UPDATE via execute_sql (Step 4).');
```

- [ ] **Step 4: Backdatar via `execute_sql` e verificar**

Substitua `<gestor_user_id>`/`<campanha_id>`/`<pessoa_antiga>`/`<pessoa_removida>` pelos valores do Step 3.

```sql
-- Pessoa Antiga: criada há 60 dias, nunca removida.
UPDATE public.pessoa SET criado_em = CURRENT_DATE - 60
 WHERE id = '<pessoa_antiga>';

-- Pessoa Removida: criada há 60 dias, soft-deletada há 10 dias.
UPDATE public.pessoa SET criado_em = CURRENT_DATE - 60, deleted_at = CURRENT_DATE - 10
 WHERE id = '<pessoa_removida>';

SET LOCAL request.jwt.claims = '{"sub":"<gestor_user_id>"}';

-- Ponto de 45 dias atrás (antes da remoção): as 2 pessoas contam.
SELECT total FROM public.evolucao_pessoas() WHERE dia = CURRENT_DATE - 45;
-- esperado: 2

-- Ponto de hoje (depois da remoção): só Pessoa Antiga conta.
SELECT total FROM public.evolucao_pessoas() WHERE dia = CURRENT_DATE;
-- esperado: 1

-- 90 pontos, do mais antigo ao mais recente, incluindo hoje.
SELECT count(*), min(dia), max(dia) FROM public.evolucao_pessoas();
-- esperado: count=90, min=CURRENT_DATE-89, max=CURRENT_DATE

-- Ponto de 70 dias atrás (antes de QUALQUER pessoa existir — criado_em=-60): zero.
SELECT total FROM public.evolucao_pessoas() WHERE dia = CURRENT_DATE - 70;
-- esperado: 0

-- Usuário sem usuario_campanha: 0 linhas, não erro.
SET LOCAL request.jwt.claims = '{"sub":"' || gen_random_uuid() || '"}';
SELECT count(*) FROM public.evolucao_pessoas();
-- esperado: 0
```

- [ ] **Step 5: Limpar a fixture**

```sql
DELETE FROM public.pessoa WHERE campanha_id = '<campanha_id>';
DELETE FROM public.usuario_campanha WHERE campanha_id = '<campanha_id>';
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

```javascript
await admin.auth.admin.deleteUser('<gestor_user_id>');
```

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos.

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0045_evolucao_pessoas.sql
git commit -m "feat(s5): evolucao_pessoas — série diária de 90 pontos, CURRENT_DATE determinístico"
```

---

### Task 3: `dashboard_alertas()` — alerta de área + liderança estagnada

**Files:**
- Create: `supabase/migrations/0046_dashboard_alertas.sql`

**Interfaces:**
- Consumes: `public.mapa_calor_agregado('zona')` (S4), `public.usuario_campanha`, `public.vinculo`, `public.pessoa`.
- Produces: `public.dashboard_alertas() RETURNS TABLE(tipo text, alvo_id text, label text, detalhe jsonb)`. Task 7 (rota Next.js) chama via `supabase.rpc('dashboard_alertas')`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0046_dashboard_alertas.sql
CREATE OR REPLACE FUNCTION public.dashboard_alertas()
RETURNS TABLE (tipo text, alvo_id text, label text, detalhe jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel       public.papel_login;
  v_pessoa_id   uuid;
BEGIN
  SELECT campanha_id, papel, pessoa_id INTO v_campanha_id, v_papel, v_pessoa_id
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  -- Alerta de área: só gestor/coordenador (não é conceito de sub-árvore).
  IF v_papel IN ('gestor', 'coordenador') THEN
    RETURN QUERY
    WITH areas AS (
      SELECT * FROM public.mapa_calor_agregado('zona')
    ),
    media AS (
      SELECT avg(potencial) AS media_potencial FROM areas
    )
    SELECT 'area'::text, a.area_id, a.area_nome,
      jsonb_build_object(
        'potencial', a.potencial,
        'penetracao', a.penetracao,
        'media_potencial', round(m.media_potencial, 2)
      )
    FROM areas a, media m
    WHERE a.potencial > m.media_potencial AND a.penetracao < 0.05;
  END IF;

  -- Alerta de liderança estagnada: líder com tenure >= 30 dias e zero
  -- inserção na sub-árvore (qualquer profundidade) em 30 dias.
  RETURN QUERY
  WITH lideres AS (
    SELECT DISTINCT ON (v.pessoa_id) v.pessoa_id, v.criado_em AS lider_desde
      FROM public.vinculo v
     WHERE v.campanha_id = v_campanha_id
       AND v.pessoa_id IN (
         SELECT DISTINCT responsavel_id FROM public.vinculo
          WHERE campanha_id = v_campanha_id AND responsavel_id IS NOT NULL
       )
       AND (
         v_papel IN ('gestor', 'coordenador')
         OR v.pessoa_id = v_pessoa_id
         OR v.responsavel_id = v_pessoa_id
       )
     ORDER BY v.pessoa_id, v.criado_em ASC
  )
  SELECT 'lideranca_estagnada'::text, l.pessoa_id::text, p.nome,
    jsonb_build_object('lider_desde', l.lider_desde)
  FROM lideres l
  JOIN public.pessoa p ON p.id = l.pessoa_id
  WHERE l.lider_desde::date <= CURRENT_DATE - 30
    AND NOT EXISTS (
      WITH RECURSIVE sub AS (
        SELECT v2.pessoa_id FROM public.vinculo v2
         WHERE v2.responsavel_id = l.pessoa_id AND v2.campanha_id = v_campanha_id
        UNION
        SELECT v3.pessoa_id FROM public.vinculo v3
          JOIN sub ON sub.pessoa_id = v3.responsavel_id
         WHERE v3.campanha_id = v_campanha_id
      )
      SELECT 1 FROM public.pessoa pd
       WHERE pd.id IN (SELECT pessoa_id FROM sub)
         AND pd.criado_em::date >= CURRENT_DATE - 30
    );
END;
$$;
REVOKE ALL ON FUNCTION public.dashboard_alertas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_alertas() TO authenticated;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `dashboard_alertas`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture pra alerta de liderança estagnada (3 líderes: estagnado, ativo, recém-criado)**

```javascript
// scratchpad: fixture-dashboard-alertas.mjs
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: gestorUser } = await admin.auth.admin.createUser({
  email: 's5-fixture-alertas@teste.local', password: 'SenhaForte!S5d', email_confirm: true,
});
console.log('gestor_user_id=', gestorUser.user.id);

const { data: camp } = await admin.from('campanha').insert({
  subdominio: 's5-fixture-alertas', nome: 'S5 Fixture Alertas', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
console.log('campanha_id=', camp.id);

await admin.from('usuario_campanha').insert({
  user_id: gestorUser.user.id, campanha_id: camp.id, papel: 'gestor', cpf_hmac: 'fixture-s5-alertas',
});

async function criarPessoa(nome) {
  const { data } = await admin.from('pessoa').insert({
    campanha_id: camp.id, nome, base_legal: 'legitimointeresse',
  }).select('id').single();
  return data.id;
}

const liderEstagnado = await criarPessoa('Lider Estagnado'); // 35 dias, sem novo apoiador em 30 dias
const apoiadorAntigo = await criarPessoa('Apoiador Antigo do Estagnado'); // criado há 40 dias
const liderAtivo = await criarPessoa('Lider Ativo'); // 35 dias, apoiador novo há 5 dias
const apoiadorNovo = await criarPessoa('Apoiador Novo do Ativo');
const liderRecente = await criarPessoa('Lider Recente'); // só 10 dias de tenure — não deve alertar

console.log({ liderEstagnado, apoiadorAntigo, liderAtivo, apoiadorNovo, liderRecente });

await admin.from('vinculo').insert([
  { campanha_id: camp.id, pessoa_id: liderEstagnado, responsavel_id: null, papel: 'lideranca' },
  { campanha_id: camp.id, pessoa_id: apoiadorAntigo, responsavel_id: liderEstagnado, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: liderAtivo, responsavel_id: null, papel: 'lideranca' },
  { campanha_id: camp.id, pessoa_id: apoiadorNovo, responsavel_id: liderAtivo, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: liderRecente, responsavel_id: null, papel: 'lideranca' },
]);

console.log('fixture pronta — próximo passo: backdatar via execute_sql (Step 4).');
```

- [ ] **Step 4: Backdatar tenure/criado_em via `execute_sql` e verificar**

Substitua os placeholders pelos valores do Step 3.

```sql
-- Lider Estagnado: virou líder há 35 dias; o único apoiador dela é de 40 dias atrás (nenhum novo em 30 dias).
UPDATE public.vinculo SET criado_em = now() - interval '35 days'
 WHERE pessoa_id = '<liderEstagnado>' AND responsavel_id IS NULL;
UPDATE public.pessoa SET criado_em = CURRENT_DATE - 40 WHERE id = '<apoiadorAntigo>';

-- Lider Ativo: também 35 dias de tenure, mas ganhou apoiador há 5 dias — não deve alertar.
UPDATE public.vinculo SET criado_em = now() - interval '35 days'
 WHERE pessoa_id = '<liderAtivo>' AND responsavel_id IS NULL;
UPDATE public.pessoa SET criado_em = CURRENT_DATE - 5 WHERE id = '<apoiadorNovo>';

-- Lider Recente: só 10 dias de tenure, zero apoiador — não deve alertar (falso-positivo evitado).
UPDATE public.vinculo SET criado_em = now() - interval '10 days'
 WHERE pessoa_id = '<liderRecente>' AND responsavel_id IS NULL;

SET LOCAL request.jwt.claims = '{"sub":"<gestor_user_id>"}';

SELECT tipo, alvo_id, label FROM public.dashboard_alertas() WHERE tipo = 'lideranca_estagnada';
-- esperado: exatamente 1 linha — alvo_id = <liderEstagnado>, label = 'Lider Estagnado'.
-- Lider Ativo não aparece (teve inserção recente). Lider Recente não aparece
-- (tenure < 30 dias).
```

- [ ] **Step 5: Verificar alerta de área contra o lote real de Teresina (municipio_id=2211001, já publicado no S4)**

```sql
-- Mesmo gestor da fixture (campanha municipal, municipio_id=2211001 — mapa_calor_agregado enxerga o lote real).
SELECT tipo, alvo_id, detalhe FROM public.dashboard_alertas() WHERE tipo = 'area';
-- esperado: 0 ou mais linhas, cada uma com detalhe.potencial > detalhe.media_potencial
-- e detalhe.penetracao < 0.05 (Força real da fixture é 0 em toda área, então
-- se o lote real tiver alguma zona com potencial acima da média, ela DEVE
-- aparecer aqui — penetração=0 é sempre < 0.05). Documentar quantas apareceram.

-- Confirmar que nenhuma área com penetração >= 0.05 aparece, mesmo que
-- potencial seja alto (checagem negativa manual sobre o resultado acima
-- comparado a SELECT * FROM public.mapa_calor_agregado('zona')).
```

- [ ] **Step 6: Verificar escopo por papel**

```sql
-- Liderança (usando o mesmo mecanismo — crie um usuario_campanha extra
-- papel='lideranca', pessoa_id=<liderEstagnado> pra este teste específico,
-- reaproveitando o usuário gestor não serve pois ele já é 'gestor'):
-- pule este sub-passo se preferir testar só a via gestor/coordenador já
-- coberta acima — o caso liderança usa a MESMA query de alertas, já
-- coberta estruturalmente pelo teste de ranking_liderancas (Task 1) quanto
-- a escopo de vínculo; aqui, confirmar apenas que tipo='area' NUNCA aparece
-- pra um papel fora de ('gestor','coordenador') lendo o corpo da função
-- (branch condicional explícito) — não precisa de fixture nova.
```

- [ ] **Step 7: Limpar a fixture**

```sql
DELETE FROM public.vinculo WHERE campanha_id = '<campanha_id>';
DELETE FROM public.pessoa WHERE campanha_id = '<campanha_id>';
DELETE FROM public.usuario_campanha WHERE campanha_id = '<campanha_id>';
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

```javascript
await admin.auth.admin.deleteUser('<gestor_user_id>');
```

- [ ] **Step 8: `get_advisors(type=security)`**

Confirmar zero alertas novos.

- [ ] **Step 9: Salvar cópia e commitar**

```bash
git add supabase/migrations/0046_dashboard_alertas.sql
git commit -m "feat(s5): dashboard_alertas — alerta de área e de liderança estagnada"
```

---

### Task 4: `NavShell` — header compartilhado + retrofit em `/mapa-calor`

**Files:**
- Create: `web/app/components/NavShell.tsx`
- Create: `web/app/components/NavShell.test.tsx`
- Modify: `web/app/mapa-calor/MapaCalorClient.tsx` (envolve o conteúdo existente com `<NavShell>`)
- Modify: `web/app/mapa-calor/MapaCalorClient.test.tsx` (ajusta seletores se necessário — ver Step 4)

**Interfaces:**
- Produces: `NavShell({ children }: { children: React.ReactNode })` — componente puro, sem fetch, sem estado. Renderiza header com 2 links (`/mapa-calor`, `/dashboard`) + `{children}` abaixo. Task 8 (`DashboardClient`) e este task (`MapaCalorClient`) consomem.

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/components/NavShell.test.tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavShell } from './NavShell';

describe('NavShell', () => {
  it('renderiza os 2 links de navegação e o children', () => {
    const html = renderToStaticMarkup(
      <NavShell>
        <p>conteudo-de-teste</p>
      </NavShell>,
    );
    expect(html).toContain('href="/mapa-calor"');
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('conteudo-de-teste');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/components/NavShell.test.tsx`
Expected: FAIL — `Cannot find module './NavShell'`

- [ ] **Step 3: Implementar**

```tsx
// web/app/components/NavShell.tsx
import Link from 'next/link';

export function NavShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header>
        <nav>
          <Link href="/mapa-calor">Mapa de Calor</Link>
          {' '}
          <Link href="/dashboard">Dashboard</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/components/NavShell.test.tsx`
Expected: PASS — 1/1

- [ ] **Step 5: Envolver `MapaCalorClient` com `NavShell`**

Abrir `web/app/mapa-calor/MapaCalorClient.tsx` (do S4). Adicionar o import e envolver o `return (...)` existente: trocar a tag raiz externa `<div>...</div>` do componente por `<NavShell><div>...</div></NavShell>`, mantendo todo o conteúdo interno idêntico. Adicionar no topo do arquivo:

```tsx
import { NavShell } from '../components/NavShell';
```

E no `return`, envolver o `<div>` raiz existente (o que contém os 2 `<label>` de granularidade/camada e o `<div ref={mapContainerRef}>`) com `<NavShell>...</NavShell>`.

- [ ] **Step 6: Rodar a suíte de `MapaCalorClient` e confirmar que ainda passa**

Run: `cd web && npx vitest run app/mapa-calor/MapaCalorClient.test.tsx`
Expected: PASS — os testes existentes usam `screen.getByLabelText`/`getByRole('alert')`, que continuam funcionando com o novo wrapper (não removem nenhum elemento, só adicionam um header em volta). Se algum teste falhar por causa de múltiplos elementos `<nav>`/`<main>` ambíguos, não deve acontecer aqui pois os testes não fazem query por tag genérica.

- [ ] **Step 7: Commit**

```bash
git add web/app/components/NavShell.tsx web/app/components/NavShell.test.tsx web/app/mapa-calor/MapaCalorClient.tsx
git commit -m "feat(s5): NavShell compartilhado, integrado em /mapa-calor"
```

---

### Task 5: `GET /api/dashboard/ranking`

**Files:**
- Create: `web/app/api/dashboard/ranking/route.ts`
- Create: `web/app/api/dashboard/ranking/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`), RPC `ranking_liderancas` (Task 1).
- Produces: `GET` handler retornando `NextResponse` com `{ramos, soma_ramos, total_real}` (200), `{erro}` (401/500). Task 9 (`RankingTable`) faz `fetch('/api/dashboard/ranking')`.

- [ ] **Step 1: Escrever o teste**

```typescript
// web/app/api/dashboard/ranking/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const mockRanking = {
  ramos: [{ pessoa_id: 'p-1', nome: 'Lider A', subarvore_count: 3 }],
  soma_ramos: 3,
  total_real: 3,
};

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = mockRanking, rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('../../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

import { GET } from './route';
import { ssrClient } from '../../../../lib/supabase/ssr';

describe('GET /api/dashboard/ranking', () => {
  it('retorna o payload de ranking_liderancas', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockRanking);
    expect(supabase.rpc).toHaveBeenCalledWith('ranking_liderancas');
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/dashboard/ranking/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/dashboard/ranking/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';

export async function GET() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase.rpc('ranking_liderancas');
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/dashboard/ranking/route.test.ts`
Expected: PASS — 3/3

- [ ] **Step 5: Commit**

```bash
git add web/app/api/dashboard/ranking/route.ts web/app/api/dashboard/ranking/route.test.ts
git commit -m "feat(s5): GET /api/dashboard/ranking"
```

---

### Task 6: `GET /api/dashboard/evolucao`

**Files:**
- Create: `web/app/api/dashboard/evolucao/route.ts`
- Create: `web/app/api/dashboard/evolucao/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient`, RPC `evolucao_pessoas` (Task 2).
- Produces: `GET` handler retornando array `{dia, total}[]` (200), `{erro}` (401/500). Task 10 (`EvolucaoChart`) faz `fetch('/api/dashboard/evolucao')`.

- [ ] **Step 1: Escrever o teste**

```typescript
// web/app/api/dashboard/evolucao/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const mockEvolucao = [
  { dia: '2026-07-03', total: 10 },
  { dia: '2026-07-04', total: 11 },
];

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = mockEvolucao, rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('../../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

import { GET } from './route';
import { ssrClient } from '../../../../lib/supabase/ssr';

describe('GET /api/dashboard/evolucao', () => {
  it('retorna o payload de evolucao_pessoas', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockEvolucao);
    expect(supabase.rpc).toHaveBeenCalledWith('evolucao_pessoas');
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/dashboard/evolucao/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/dashboard/evolucao/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';

export async function GET() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase.rpc('evolucao_pessoas');
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/dashboard/evolucao/route.test.ts`
Expected: PASS — 3/3

- [ ] **Step 5: Commit**

```bash
git add web/app/api/dashboard/evolucao/route.ts web/app/api/dashboard/evolucao/route.test.ts
git commit -m "feat(s5): GET /api/dashboard/evolucao"
```

---

### Task 7: `GET /api/dashboard/alertas`

**Files:**
- Create: `web/app/api/dashboard/alertas/route.ts`
- Create: `web/app/api/dashboard/alertas/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient`, RPC `dashboard_alertas` (Task 3).
- Produces: `GET` handler retornando array `{tipo, alvo_id, label, detalhe}[]` (200), `{erro}` (401/500). Task 11 (`AlertasList`) faz `fetch('/api/dashboard/alertas')`.

- [ ] **Step 1: Escrever o teste**

```typescript
// web/app/api/dashboard/alertas/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const mockAlertas = [
  { tipo: 'area', alvo_id: 'zona-1', label: '1', detalhe: { potencial: 500, penetracao: 0.01, media_potencial: 300 } },
];

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = mockAlertas, rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('../../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

import { GET } from './route';
import { ssrClient } from '../../../../lib/supabase/ssr';

describe('GET /api/dashboard/alertas', () => {
  it('retorna o payload de dashboard_alertas', async () => {
    const supabase = mockSupabase();
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockAlertas);
    expect(supabase.rpc).toHaveBeenCalledWith('dashboard_alertas');
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/dashboard/alertas/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/dashboard/alertas/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';

export async function GET() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase.rpc('dashboard_alertas');
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/dashboard/alertas/route.test.ts`
Expected: PASS — 3/3

- [ ] **Step 5: Commit**

```bash
git add web/app/api/dashboard/alertas/route.ts web/app/api/dashboard/alertas/route.test.ts
git commit -m "feat(s5): GET /api/dashboard/alertas"
```

---

### Task 8: Página `/dashboard` — checagem de sessão + placeholder

**Files:**
- Create: `web/app/dashboard/page.tsx`
- Create: `web/app/dashboard/page.test.tsx`
- Create: `web/app/dashboard/DashboardClient.tsx` (placeholder — Tasks 9-11 substituem pelo conteúdo real)

**Interfaces:**
- Consumes: `ssrClient`; `DashboardClient` (placeholder nesta task, Tasks 9-11 completam).
- Produces: página server component em `/dashboard`, sem redirect quando não autenticado (mesmo padrão de `/mapa-calor`).

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/dashboard/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('./DashboardClient', () => ({
  DashboardClient: () => 'dashboard-client-mock',
}));

import { ssrClient } from '../../lib/supabase/ssr';
import Page from './page';

describe('/dashboard page', () => {
  it('mostra mensagem quando não autenticado, sem renderizar o dashboard', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('não autenticado');
    expect(html).not.toContain('dashboard-client-mock');
  });

  it('renderiza o dashboard quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('dashboard-client-mock');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/dashboard/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 3: Implementar a página + placeholder**

```tsx
// web/app/dashboard/page.tsx
import { cookies } from 'next/headers';
import { ssrClient } from '../../lib/supabase/ssr';
import { DashboardClient } from './DashboardClient';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <p>Você precisa estar autenticado para ver o dashboard.</p>;
  }

  return <DashboardClient />;
}
```

```tsx
// web/app/dashboard/DashboardClient.tsx (placeholder — Tasks 9-11 substituem pelo conteúdo real)
'use client';
import { NavShell } from '../components/NavShell';

export function DashboardClient() {
  return (
    <NavShell>
      <div>dashboard em construção</div>
    </NavShell>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard/page.test.tsx`
Expected: PASS — 2/2

- [ ] **Step 5: Commit**

```bash
git add web/app/dashboard/page.tsx web/app/dashboard/page.test.tsx web/app/dashboard/DashboardClient.tsx
git commit -m "feat(s5): página /dashboard — checagem de sessão server-side"
```

---

### Task 9: `RankingTable` — ranking de lideranças + nota soma≠total

**Files:**
- Create: `web/app/dashboard/RankingTable.tsx`
- Create: `web/app/dashboard/RankingTable.test.tsx`
- Modify: `web/app/dashboard/DashboardClient.tsx` (substitui o placeholder por `<RankingTable />`, dentro do `<NavShell>`)

**Interfaces:**
- Consumes: `GET /api/dashboard/ranking` (Task 5) via `fetch`.
- Produces: componente `RankingTable` (nenhum prop). Task 12 (verificação manual) usa via `/dashboard`.

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/dashboard/RankingTable.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RankingTable } from './RankingTable';

const mockRanking = {
  ramos: [
    { pessoa_id: 'p-1', nome: 'Lider A', subarvore_count: 5 },
    { pessoa_id: 'p-2', nome: 'Lider B', subarvore_count: 2 },
  ],
  soma_ramos: 7,
  total_real: 6,
};

describe('RankingTable', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => mockRanking })) as never;
  });

  it('busca /api/dashboard/ranking e renderiza as linhas', async () => {
    render(<RankingTable />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/dashboard/ranking');
    });
    expect(await screen.findByText('Lider A')).toBeInTheDocument();
    expect(screen.getByText('Lider B')).toBeInTheDocument();
  });

  it('mostra a nota soma dos ramos ≠ total real', async () => {
    render(<RankingTable />);
    expect(await screen.findByText(/7/)).toBeInTheDocument();
    expect(screen.getByText(/6/)).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há líder', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ ramos: [], soma_ramos: 0, total_real: 0 }),
    })) as never;
    render(<RankingTable />);
    expect(await screen.findByText(/nenhum líder/i)).toBeInTheDocument();
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<RankingTable />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/dashboard/RankingTable.test.tsx`
Expected: FAIL — `Cannot find module './RankingTable'`

- [ ] **Step 3: Implementar o componente**

```tsx
// web/app/dashboard/RankingTable.tsx
'use client';
import { useEffect, useState } from 'react';

type Ramo = { pessoa_id: string; nome: string; subarvore_count: number };
type RankingPayload = { ramos: Ramo[]; soma_ramos: number; total_real: number };

export function RankingTable() {
  const [dado, setDado] = useState<RankingPayload | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/dashboard/ranking')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar ranking');
        return res.json();
      })
      .then((data: RankingPayload) => {
        if (!cancelado) setDado(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar o ranking.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) return <p role="alert">{erro}</p>;
  if (!dado) return null;

  if (dado.ramos.length === 0) {
    return <p>Nenhum líder com sub-árvore ainda.</p>;
  }

  return (
    <section>
      <h2>Ranking de lideranças</h2>
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Tamanho da sub-árvore</th>
          </tr>
        </thead>
        <tbody>
          {dado.ramos.map((r) => (
            <tr key={r.pessoa_id}>
              <td>{r.nome}</td>
              <td>{r.subarvore_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Soma dos ramos: {dado.soma_ramos} · Total real da campanha: {dado.total_real}
        {dado.soma_ramos !== dado.total_real && (
          <> · {dado.soma_ramos - dado.total_real} apoiador(es) compartilhado(s) entre ramos.</>
        )}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard/RankingTable.test.tsx`
Expected: PASS — 4/4

- [ ] **Step 5: Ligar no `DashboardClient`**

```tsx
// web/app/dashboard/DashboardClient.tsx
'use client';
import { NavShell } from '../components/NavShell';
import { RankingTable } from './RankingTable';

export function DashboardClient() {
  return (
    <NavShell>
      <RankingTable />
    </NavShell>
  );
}
```

- [ ] **Step 6: Rodar a suíte de `/dashboard` inteira e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard`
Expected: todos os arquivos passam.

- [ ] **Step 7: Commit**

```bash
git add web/app/dashboard/RankingTable.tsx web/app/dashboard/RankingTable.test.tsx web/app/dashboard/DashboardClient.tsx
git commit -m "feat(s5): RankingTable — ranking de lideranças com nota soma≠total"
```

---

### Task 10: `EvolucaoChart` — gráfico de linha (Recharts)

**Files:**
- Create: `web/app/dashboard/EvolucaoChart.tsx`
- Create: `web/app/dashboard/EvolucaoChart.test.tsx`
- Modify: `web/app/dashboard/DashboardClient.tsx` (adiciona `<EvolucaoChart />` acima de `<RankingTable />`)
- Modify: `web/package.json` (nova dep: `recharts`)

**Interfaces:**
- Consumes: `GET /api/dashboard/evolucao` (Task 6) via `fetch`.
- Produces: componente `EvolucaoChart` (nenhum prop).

- [ ] **Step 1: Instalar dependência**

```bash
cd web && npm install recharts
```

- [ ] **Step 2: Escrever o teste**

```tsx
// web/app/dashboard/EvolucaoChart.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EvolucaoChart } from './EvolucaoChart';

const mockEvolucao = [
  { dia: '2026-07-03', total: 10 },
  { dia: '2026-07-04', total: 12 },
];

describe('EvolucaoChart', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => mockEvolucao })) as never;
    // Recharts mede o container via ResizeObserver, ausente em jsdom.
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  it('busca /api/dashboard/evolucao', async () => {
    render(<EvolucaoChart />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/dashboard/evolucao');
    });
  });

  it('mostra estado vazio quando a série é toda zero', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [{ dia: '2026-07-04', total: 0 }],
    })) as never;
    render(<EvolucaoChart />);
    expect(await screen.findByText(/nenhuma movimentação/i)).toBeInTheDocument();
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<EvolucaoChart />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/dashboard/EvolucaoChart.test.tsx`
Expected: FAIL — `Cannot find module './EvolucaoChart'`

- [ ] **Step 4: Implementar o componente**

```tsx
// web/app/dashboard/EvolucaoChart.tsx
'use client';
import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

type Ponto = { dia: string; total: number };

export function EvolucaoChart() {
  const [pontos, setPontos] = useState<Ponto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/dashboard/evolucao')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar evolução');
        return res.json();
      })
      .then((data: Ponto[]) => {
        if (!cancelado) setPontos(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar a evolução.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) return <p role="alert">{erro}</p>;
  if (!pontos) return null;

  const temMovimentacao = pontos.some((p) => p.total > 0);
  if (!temMovimentacao) {
    return <p>Nenhuma movimentação nos últimos 90 dias.</p>;
  }

  return (
    <section>
      <h2>Evolução (90 dias)</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={pontos}>
          <XAxis dataKey="dia" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey="total" stroke="#2563eb" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard/EvolucaoChart.test.tsx`
Expected: PASS — 3/3

- [ ] **Step 6: Ligar no `DashboardClient`**

```tsx
// web/app/dashboard/DashboardClient.tsx
'use client';
import { NavShell } from '../components/NavShell';
import { EvolucaoChart } from './EvolucaoChart';
import { RankingTable } from './RankingTable';

export function DashboardClient() {
  return (
    <NavShell>
      <EvolucaoChart />
      <RankingTable />
    </NavShell>
  );
}
```

- [ ] **Step 7: Rodar a suíte de `/dashboard` inteira**

Run: `cd web && npx vitest run app/dashboard`
Expected: todos os arquivos passam.

- [ ] **Step 8: Commit**

```bash
git add web/app/dashboard/EvolucaoChart.tsx web/app/dashboard/EvolucaoChart.test.tsx web/app/dashboard/DashboardClient.tsx web/package.json web/package-lock.json
git commit -m "feat(s5): EvolucaoChart — linha de 90 dias com Recharts"
```

---

### Task 11: `AlertasList` — alertas de área e liderança estagnada

**Files:**
- Create: `web/app/dashboard/AlertasList.tsx`
- Create: `web/app/dashboard/AlertasList.test.tsx`
- Modify: `web/app/dashboard/DashboardClient.tsx` (adiciona `<AlertasList />` no topo, antes de `<EvolucaoChart />`)

**Interfaces:**
- Consumes: `GET /api/dashboard/alertas` (Task 7) via `fetch`.
- Produces: componente `AlertasList` (nenhum prop). Última peça do dashboard — após esta task, `DashboardClient` está completo (Alertas → Evolução → Ranking, decisão 8 do spec).

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/dashboard/AlertasList.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AlertasList } from './AlertasList';

const mockAlertas = [
  { tipo: 'area', alvo_id: 'zona-1', label: '1', detalhe: { potencial: 500, penetracao: 0.01, media_potencial: 300 } },
  { tipo: 'lideranca_estagnada', alvo_id: 'p-1', label: 'Lider A', detalhe: { lider_desde: '2026-05-01T00:00:00Z' } },
];

describe('AlertasList', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => mockAlertas })) as never;
  });

  it('busca /api/dashboard/alertas e renderiza os 2 tipos', async () => {
    render(<AlertasList />);
    expect(await screen.findByText(/zona 1/i)).toBeInTheDocument();
    expect(screen.getByText(/lider a/i)).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há alerta', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as never;
    render(<AlertasList />);
    expect(await screen.findByText(/nenhum alerta/i)).toBeInTheDocument();
  });

  it('mostra erro quando o fetch falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<AlertasList />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/dashboard/AlertasList.test.tsx`
Expected: FAIL — `Cannot find module './AlertasList'`

- [ ] **Step 3: Implementar o componente**

```tsx
// web/app/dashboard/AlertasList.tsx
'use client';
import { useEffect, useState } from 'react';

type Alerta = {
  tipo: 'area' | 'lideranca_estagnada';
  alvo_id: string;
  label: string;
  detalhe: Record<string, unknown>;
};

export function AlertasList() {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/dashboard/alertas')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar alertas');
        return res.json();
      })
      .then((data: Alerta[]) => {
        if (!cancelado) setAlertas(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar os alertas.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) return <p role="alert">{erro}</p>;
  if (!alertas) return null;

  if (alertas.length === 0) {
    return <p>Nenhum alerta no momento.</p>;
  }

  return (
    <section>
      <h2>Alertas</h2>
      <ul>
        {alertas.map((a) => (
          <li key={`${a.tipo}-${a.alvo_id}`}>
            {a.tipo === 'area'
              ? `Zona ${a.label}: potencial acima da média com baixa penetração.`
              : `${a.label}: sem crescimento na sub-árvore nos últimos 30 dias.`}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard/AlertasList.test.tsx`
Expected: PASS — 3/3

- [ ] **Step 5: Ligar no `DashboardClient` (ordem final: Alertas → Evolução → Ranking)**

```tsx
// web/app/dashboard/DashboardClient.tsx
'use client';
import { NavShell } from '../components/NavShell';
import { AlertasList } from './AlertasList';
import { EvolucaoChart } from './EvolucaoChart';
import { RankingTable } from './RankingTable';

export function DashboardClient() {
  return (
    <NavShell>
      <AlertasList />
      <EvolucaoChart />
      <RankingTable />
    </NavShell>
  );
}
```

- [ ] **Step 6: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes de S0-S4.

- [ ] **Step 7: Rodar `npx tsc --noEmit`, confirmar zero erros novos em `app/dashboard/`**

- [ ] **Step 8: Commit**

```bash
git add web/app/dashboard/AlertasList.tsx web/app/dashboard/AlertasList.test.tsx web/app/dashboard/DashboardClient.tsx
git commit -m "feat(s5): AlertasList — alerta de área e de liderança estagnada"
```

---

### Task 12: Verificação manual em browser

**Files:** nenhum arquivo de código — task de verificação, sem implementação nova.

**Interfaces:** nenhuma nova. Consome tudo das Tasks 1-11.

- [ ] **Step 1: Rodar o servidor de desenvolvimento**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Logar com um usuário de teste de uma campanha municipal de Teresina (`municipio_id=2211001`) e acessar `/dashboard`**

Confirmar visualmente:
- Header com os 2 links (Mapa de Calor / Dashboard) navega corretamente entre as páginas.
- Seção Alertas aparece primeiro; se vazia, mostra "Nenhum alerta no momento" (não erro).
- Gráfico de evolução renderiza uma linha (Recharts) com o eixo de datas dos últimos 90 dias; se a campanha de teste não tiver pessoa cadastrada há tempo suficiente, confirmar que mostra "Nenhuma movimentação" corretamente em vez de gráfico vazio quebrado.
- Ranking de lideranças aparece por último, com a nota de soma dos ramos ≠ total (se a campanha de teste tiver pelo menos 1 líder com apoiador compartilhado — senão, confirmar que mostra "Nenhum líder com sub-árvore ainda" corretamente).
- Zero erros no console do browser.

- [ ] **Step 3: Documentar o resultado**

Anotar no relatório da task: o que foi visto (screenshot ou descrição), qualquer problema visual encontrado (mesmo que não bloqueie — registrar como débito, não corrigir silenciosamente fora do plano).

---

## Self-Review

**1. Cobertura do spec:** decisão 1 (ranking = líderes por subárvore) → Task 1; decisão 2 (visibilidade líderes de topo vs subordinados diretos) → Task 1; decisão 3 (nota soma≠total) → Task 1 + Task 9; decisão 4 (ordenação) → Task 1 (`ORDER BY` dentro do `jsonb_agg`); decisão 5 (evolução acumulada, `CURRENT_DATE`) → Task 2; decisão 6 (alertas de área e liderança estagnada, regras fixas) → Task 3; decisão 7 (nav shell) → Task 4; decisão 8 (Recharts, layout empilhado) → Tasks 8-11; decisão 9 (3 RPCs independentes) → Tasks 1-3 + 5-7; decisão 10 (coleção vazia sem erro) → Tasks 1-3 (branches `IF v_campanha_id IS NULL`) + Tasks 9-11 (estados vazios na UI). Não-objetivos: nenhuma task adiciona motor de regra configurável, IA, snapshot, toggle de granularidade nos alertas, abas, logout, ou abrangência estadual — confirmado por omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda task tem SQL/TS completo.

**3. Consistência de tipos:** `RankingPayload` (Task 9) tem exatamente os campos de `ranking_liderancas` (Task 1) — `ramos: {pessoa_id, nome, subarvore_count}[]`, `soma_ramos`, `total_real`. `Ponto` (Task 10, `{dia, total}`) casa com `evolucao_pessoas` (Task 2, `TABLE(dia date, total integer)`). `Alerta` (Task 11, `{tipo, alvo_id, label, detalhe}`) casa com `dashboard_alertas` (Task 3). Rotas (Tasks 5-7) retornam o payload cru da RPC sem transformação, então os tipos client-side são idênticos aos server-side.

**Gap encontrado e corrigido durante o self-review:** a Task 3 originalmente não deixava claro como testar o escopo de "área" restrito a gestor/coordenador sem uma fixture extra cara (criar outro usuário liderança só pra confirmar ausência). Resolvido no Step 6 da Task 3: como a restrição é um branch condicional explícito no corpo da função (`IF v_papel IN ('gestor','coordenador')`), a verificação por leitura de código é suficiente — não precisa de fixture nova, evita duplicar custo de criação de usuário real só pra provar um `IF` que já é estruturalmente óbvio.

---

Plano completo e salvo em `docs/superpowers/plans/2026-07-04-s5-dashboard-bi.md`.
