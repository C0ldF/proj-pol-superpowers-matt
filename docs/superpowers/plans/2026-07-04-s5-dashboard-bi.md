# S5 — Dashboard BI determinístico Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship o dashboard BI determinístico — ranking de lideranças por sub-árvore, evolução temporal de pessoas, e alertas por regra fixa (sem LLM) — na segunda tela autenticada do sistema.

**Architecture:** Três funções `SECURITY DEFINER` no Postgres (`ranking_liderancas`, `evolucao_pessoas` públicas + `dashboard_alertas` composta de 2 internas — mesmo padrão de composição do `mapa_calor_agregado` do S4) → três rotas `GET /api/dashboard/*` (Next.js, via helper `authenticatedRpc` compartilhado) → página `/dashboard` (server component com checagem de sessão + client components: `RankingTable`, `EvolucaoChart` com Recharts, `AlertasList`) → `NavShell` compartilhado entre `/mapa-calor` e `/dashboard`.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript, Supabase (Postgres 17), `recharts` (novo nesta fatia), Vitest + `jsdom`/`@testing-library/react` (já existentes desde o S4), `execute_sql`/`apply_migration` via MCP Supabase.

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/` (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência: `docs/superpowers/specs/2026-07-04-s5-dashboard-bi-design.md` — toda task abaixo implementa uma seção dela.
- Projeto Supabase: `axcftjqdjvknrpqzrxls`. Migrations via `mcp__supabase__apply_migration` — uma por task; cópia idêntica salva em `supabase/migrations/`. Migration mais recente é `0043`; esta fatia usa `0044`-`0047`.
- Toda função `SECURITY DEFINER` desta fatia: `search_path = ''`, identificadores fully-qualified (`public.tabela`). Convenção de identidade (mesma do S2/S4): função **pública** (`GRANT`ada a `authenticated`) nunca recebe identidade como parâmetro — lê `auth.uid()` internamente (prova estrutural anti-spoofing). Função **interna** (`REVOKE`d de `authenticated`) recebe `p_actor_uid` como parâmetro explícito sempre que não depender, por sua vez, de outra função que já exige `auth.uid()` de sessão — isso a deixa testável por impersonation direta via `execute_sql`, sem precisar simular sessão.
- Recursão sobre `vinculo` (usada em `ranking_liderancas` e `dashboard_alertas_lideranca`) é seguramente livre de ciclo: `trg_vinculo_ciclo_check` (S2, migration `0017_vinculo.sql`) bloqueia no `INSERT` qualquer vínculo que criaria um ciclo — a mesma garantia da qual `subarvore_count` e `pessoa_em_subarvore_do_actor` (S2) já dependem sem checagem própria. Nenhuma função nova precisa reimplementar detecção de ciclo.
- Testes de função SQL (Tasks 1-3) seguem o padrão S2/S3/S4: verificação via `execute_sql` direto no projeto live, fixtures próprios criados e limpos dentro da própria task — **não** viram arquivo `.test.ts`. Função pública lida via `auth.uid()`: testar simulando sessão com `SET LOCAL request.jwt.claims = '{"sub":"<user_id>"}'` antes de chamar. Função interna com `p_actor_uid` explícito: chamar direto, sem `SET LOCAL`.
- Testes de código Next.js (Tasks 5-11) rodam com `cd web && npx vitest run <caminho>`.
- `ssrClient()` = `web/lib/supabase/ssr.ts` — rotas usam `ssrClient`, nunca `adminClient`.
- Sem página de login no app ainda — página `/dashboard` mostra mensagem simples quando não autenticado, **sem redirecionar** (mesmo padrão de `/mapa-calor`, decisão do S4 mantida).
- Limiares das regras de alerta (Task 3) ficam como constantes nomeadas no corpo da função (`v_limiar_penetracao`, `v_dias_tenure_minimo`, `v_dias_janela_estagnacao`), não mágicos soltos no meio do SQL — continuam hardcoded por decisão explícita do spec (YAGNI: sem motor de regra configurável nesta fatia), só nomeados pra leitura/manutenção.
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
- Produces: `public.ranking_liderancas() RETURNS TABLE(pessoa_id uuid, nome text, subarvore_count integer, soma_ramos integer, total_real integer)`. **Uma linha por líder do ranking**, ordenado (`subarvore_count DESC, nome ASC`); `soma_ramos`/`total_real` vêm repetidos (mesmo valor) em toda linha — resumo do conjunto inteiro, não específico de cada líder. **Tabela vazia (0 linhas)** quando não há líder no escopo do actor — o cliente trata isso como "nenhum líder ainda" e assume `soma_ramos=0`/`total_real=0`. Task 5 (rota Next.js) chama via `supabase.rpc('ranking_liderancas')`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0044_ranking_liderancas.sql
CREATE OR REPLACE FUNCTION public.ranking_liderancas()
RETURNS TABLE (
  pessoa_id       uuid,
  nome            text,
  subarvore_count integer,
  soma_ramos      integer,
  total_real      integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel       public.papel_login;
  v_pessoa_id   uuid;
  v_topo        boolean;
BEGIN
  SELECT campanha_id, papel, pessoa_id INTO v_campanha_id, v_papel, v_pessoa_id
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  v_topo := v_papel IN ('gestor', 'coordenador');

  -- Recursão sobre vinculo é segura contra ciclo: trg_vinculo_ciclo_check
  -- (S2, migration 0017) bloqueia no INSERT qualquer vínculo que criaria um
  -- ciclo — mesma garantia da qual subarvore_count/pessoa_em_subarvore_do_actor
  -- (S2) já dependem sem checagem própria.
  RETURN QUERY
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
  ),
  totais AS (
    SELECT
      coalesce((SELECT sum(subarvore_count) FROM ramos), 0)::integer AS soma_ramos,
      coalesce((SELECT count(DISTINCT pessoa_id) FROM sub), 0)::integer AS total_real
  )
  SELECT ramos.pessoa_id, ramos.nome, ramos.subarvore_count,
         totais.soma_ramos, totais.total_real
    FROM ramos, totais
   ORDER BY ramos.subarvore_count DESC, ramos.nome ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.ranking_liderancas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ranking_liderancas() TO authenticated;
```

Nota: `FROM ramos, totais` é um cross join — se `ramos` estiver vazio, o resultado inteiro é 0 linhas (não uma linha com `NULL`s), que é exatamente o "coleção vazia sem erro" da decisão 10 do spec.

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
-- Gestor: vê os 2 líderes de topo (CoordA, CoordE).
SET LOCAL request.jwt.claims = '{"sub":"<gestor_user_id>"}';
SELECT pessoa_id, nome, subarvore_count, soma_ramos, total_real
  FROM public.ranking_liderancas();
-- esperado: 2 linhas —
--   CoordA: subarvore_count=4 (LiderB+ApoiadorC+ApoiadorD+ApoiadorCompartilhado)
--   CoordE: subarvore_count=1 (ApoiadorCompartilhado)
-- ambas com soma_ramos=5, total_real=4 (LiderB, ApoiadorC, ApoiadorD,
-- ApoiadorCompartilhado — sem duplicar o compartilhado).
-- soma_ramos(5) - total_real(4) = 1 = o ApoiadorCompartilhado — a nota do
-- ADR 0003. Ordenado: CoordA (subarvore_count maior) antes de CoordE.

-- Liderança (LiderB): só o subordinado direto dela (ApoiadorC), que não
-- tem descendentes — subarvore_count=0.
SET LOCAL request.jwt.claims = '{"sub":"<liderb_user_id>"}';
SELECT pessoa_id, nome, subarvore_count, soma_ramos, total_real
  FROM public.ranking_liderancas();
-- esperado: 1 linha — ApoiadorC, subarvore_count=0, soma_ramos=0, total_real=0

-- Usuário sem usuario_campanha: 0 linhas, não erro
SET LOCAL request.jwt.claims = '{"sub":"' || gen_random_uuid() || '"}';
SELECT count(*) FROM public.ranking_liderancas();
-- esperado: 0
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

`CURRENT_DATE`, não `now()`, em toda a função — garante resultado determinístico durante todo o dia (decisão 5 do spec). Nota de performance: `pessoa_em_subarvore_do_actor` roda por pessoa candidata por dia (90 × N) — mesmo trade-off já aceito em `forca_por_area` (S4) na escala MVP; se a campanha crescer pra dezenas de milhares de pessoas, materializar essa série vira candidato natural de otimização futura (fora de escopo aqui).

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

### Task 3: `dashboard_alertas_area` + `dashboard_alertas_lideranca` (internas) + `dashboard_alertas` (pública)

**Files:**
- Create: `supabase/migrations/0046_dashboard_alertas.sql`

**Interfaces:**
- Consumes: `public.mapa_calor_agregado('zona')` (S4), `public.usuario_campanha`, `public.vinculo`, `public.pessoa`.
- Produces:
  - `public.dashboard_alertas_area() RETURNS TABLE(alvo_id text, label text, detalhe jsonb)` — interna, `REVOKE`d de `authenticated`. Não recebe `p_actor_uid` explícito porque **depende de `mapa_calor_agregado`, que por sua vez exige `auth.uid()` de sessão** — não há como desacoplar sem reimplementar a leitura de Força/Potencial; lê `auth.uid()` internamente pelo mesmo motivo (documentado no corpo, ver Step 1).
  - `public.dashboard_alertas_lideranca(p_actor_uid uuid) RETURNS TABLE(alvo_id text, label text, detalhe jsonb)` — interna, `REVOKE`d de `authenticated`, recebe identidade como parâmetro explícito (não depende de nenhuma função `auth.uid()`-only) — testável direto via `execute_sql`, mesmo padrão do `forca_por_area` (S4).
  - `public.dashboard_alertas() RETURNS TABLE(tipo text, alvo_id text, label text, detalhe jsonb)` — pública, `GRANT`ada a `authenticated`, lê `auth.uid()` uma vez e compõe as duas internas. Task 7 (rota Next.js) chama via `supabase.rpc('dashboard_alertas')`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0046_dashboard_alertas.sql

-- Interna: alerta de área. Só chamada pela pública abaixo, quando o papel
-- do actor qualifica (gestor/coordenador) — a checagem de papel mora na
-- função pública, não aqui, porque esta função sozinha não sabe "pra quem"
-- ela está rodando de forma independente de auth.uid() (mapa_calor_agregado
-- já é auth.uid()-only, então esta função herda a mesma restrição).
CREATE OR REPLACE FUNCTION public.dashboard_alertas_area()
RETURNS TABLE (alvo_id text, label text, detalhe jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH areas AS (
    SELECT * FROM public.mapa_calor_agregado('zona')
  ),
  media AS (
    SELECT avg(potencial) AS media_potencial FROM areas
  )
  SELECT a.area_id, a.area_nome,
    jsonb_build_object(
      'potencial', a.potencial,
      'penetracao', a.penetracao,
      'media_potencial', round(m.media_potencial, 2)
    )
  FROM areas a, media m
  -- limiar de penetração = 0.05 (5%) — decisão 6 do spec, hardcoded por
  -- YAGNI (sem motor de regra configurável nesta fatia).
  WHERE a.potencial > m.media_potencial AND a.penetracao < 0.05;
$$;
REVOKE ALL ON FUNCTION public.dashboard_alertas_area() FROM public, authenticated, anon;

-- Interna: alerta de liderança estagnada. Recebe p_actor_uid explícito —
-- não depende de nenhuma função auth.uid()-only, então é diretamente
-- testável via execute_sql sem simular sessão (mesmo padrão do
-- forca_por_area, S4).
CREATE OR REPLACE FUNCTION public.dashboard_alertas_lideranca(p_actor_uid uuid)
RETURNS TABLE (alvo_id text, label text, detalhe jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id             uuid;
  v_papel                   public.papel_login;
  v_pessoa_id               uuid;
  v_dias_tenure_minimo      constant integer := 30;
  v_dias_janela_estagnacao  constant integer := 30;
BEGIN
  SELECT campanha_id, papel, pessoa_id INTO v_campanha_id, v_papel, v_pessoa_id
    FROM public.usuario_campanha WHERE user_id = p_actor_uid;
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  -- Recursão sobre vinculo é segura contra ciclo: trg_vinculo_ciclo_check
  -- (S2, migration 0017) bloqueia no INSERT qualquer vínculo que criaria um
  -- ciclo — mesma garantia já usada sem checagem própria em subarvore_count.
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
  SELECT l.pessoa_id::text, p.nome,
    jsonb_build_object('lider_desde', l.lider_desde)
  FROM lideres l
  JOIN public.pessoa p ON p.id = l.pessoa_id
  WHERE l.lider_desde::date <= CURRENT_DATE - v_dias_tenure_minimo
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
         AND pd.criado_em::date >= CURRENT_DATE - v_dias_janela_estagnacao
    );
END;
$$;
REVOKE ALL ON FUNCTION public.dashboard_alertas_lideranca(uuid) FROM public, authenticated, anon;

-- Pública: única GRANT'ada, lê auth.uid() uma vez e compõe as 2 internas —
-- mesmo padrão de composição do mapa_calor_agregado (S4).
CREATE OR REPLACE FUNCTION public.dashboard_alertas()
RETURNS TABLE (tipo text, alvo_id text, label text, detalhe jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_papel public.papel_login;
BEGIN
  SELECT papel INTO v_papel FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_papel IS NULL THEN RETURN; END IF;

  -- Alerta de área: só gestor/coordenador (não é conceito de sub-árvore).
  IF v_papel IN ('gestor', 'coordenador') THEN
    RETURN QUERY
    SELECT 'area'::text, a.alvo_id, a.label, a.detalhe
      FROM public.dashboard_alertas_area() a;
  END IF;

  RETURN QUERY
  SELECT 'lideranca_estagnada'::text, l.alvo_id, l.label, l.detalhe
    FROM public.dashboard_alertas_lideranca(auth.uid()) l;
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

console.log({ gestorUserId: gestorUser.user.id, liderEstagnado, apoiadorAntigo, liderAtivo, apoiadorNovo, liderRecente });

await admin.from('vinculo').insert([
  { campanha_id: camp.id, pessoa_id: liderEstagnado, responsavel_id: null, papel: 'lideranca' },
  { campanha_id: camp.id, pessoa_id: apoiadorAntigo, responsavel_id: liderEstagnado, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: liderAtivo, responsavel_id: null, papel: 'lideranca' },
  { campanha_id: camp.id, pessoa_id: apoiadorNovo, responsavel_id: liderAtivo, papel: 'apoiador' },
  { campanha_id: camp.id, pessoa_id: liderRecente, responsavel_id: null, papel: 'lideranca' },
]);

console.log('fixture pronta — próximo passo: backdatar via execute_sql (Step 4).');
```

- [ ] **Step 4: Backdatar tenure/criado_em e testar `dashboard_alertas_lideranca` direto (sem simular sessão — parâmetro explícito)**

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

-- Chamada direta, sem SET LOCAL — dashboard_alertas_lideranca recebe o
-- actor_uid como parâmetro explícito.
SELECT alvo_id, label FROM public.dashboard_alertas_lideranca('<gestor_user_id>');
-- esperado: exatamente 1 linha — alvo_id = <liderEstagnado>, label = 'Lider Estagnado'.
-- Lider Ativo não aparece (teve inserção recente). Lider Recente não aparece
-- (tenure < 30 dias).
```

- [ ] **Step 5: Verificar alerta de área contra o lote real de Teresina (municipio_id=2211001, já publicado no S4) e a função pública completa**

```sql
-- dashboard_alertas_area não recebe parâmetro (depende de mapa_calor_agregado,
-- que exige auth.uid() de sessão) — testar via a função PÚBLICA, simulando
-- sessão do gestor da fixture.
SET LOCAL request.jwt.claims = '{"sub":"<gestor_user_id>"}';

SELECT tipo, alvo_id, detalhe FROM public.dashboard_alertas() WHERE tipo = 'area';
-- esperado: 0 ou mais linhas, cada uma com detalhe.potencial > detalhe.media_potencial
-- e detalhe.penetracao < 0.05 (Força real da fixture é 0 em toda área, então
-- se o lote real tiver alguma zona com potencial acima da média, ela DEVE
-- aparecer aqui — penetração=0 é sempre < 0.05). Documentar quantas apareceram.

SELECT tipo, alvo_id, label FROM public.dashboard_alertas() WHERE tipo = 'lideranca_estagnada';
-- esperado: mesmo resultado do Step 4 (1 linha, Lider Estagnado) — confirma
-- que a função pública repassa corretamente pra dashboard_alertas_lideranca.

-- Escopo por papel: alerta de área é condicional no corpo da função pública
-- (IF v_papel IN ('gestor','coordenador')) — não precisa de fixture nova pra
-- confirmar que uma liderança nunca recebe tipo='area'; é um branch
-- estruturalmente óbvio lendo o Step 1, não um comportamento a redescobrir
-- por teste.
```

- [ ] **Step 6: Limpar a fixture**

```sql
DELETE FROM public.vinculo WHERE campanha_id = '<campanha_id>';
DELETE FROM public.pessoa WHERE campanha_id = '<campanha_id>';
DELETE FROM public.usuario_campanha WHERE campanha_id = '<campanha_id>';
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

```javascript
await admin.auth.admin.deleteUser('<gestor_user_id>');
```

- [ ] **Step 7: `get_advisors(type=security)`**

Confirmar zero alertas novos.

- [ ] **Step 8: Salvar cópia e commitar**

```bash
git add supabase/migrations/0046_dashboard_alertas.sql
git commit -m "feat(s5): dashboard_alertas — área + liderança estagnada, composição de 2 internas"
```

---

### Task 4: `NavShell` — header compartilhado + retrofit em `/mapa-calor`

**Files:**
- Create: `web/app/components/NavShell.tsx`
- Create: `web/app/components/NavShell.test.tsx`
- Modify: `web/app/mapa-calor/MapaCalorClient.tsx` (envolve o conteúdo existente com `<NavShell>`)

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
Expected: PASS — os testes existentes usam `screen.getByLabelText`/`getByRole('alert')`, que continuam funcionando com o novo wrapper (não removem nenhum elemento, só adicionam um header em volta).

- [ ] **Step 7: Commit**

```bash
git add web/app/components/NavShell.tsx web/app/components/NavShell.test.tsx web/app/mapa-calor/MapaCalorClient.tsx
git commit -m "feat(s5): NavShell compartilhado, integrado em /mapa-calor"
```

---

### Task 5: `authenticatedRpc` helper + `GET /api/dashboard/ranking`

**Files:**
- Create: `web/lib/supabase/authenticated-rpc.ts`
- Create: `web/lib/supabase/authenticated-rpc.test.ts`
- Create: `web/app/api/dashboard/ranking/route.ts`
- Create: `web/app/api/dashboard/ranking/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`).
- Produces: `authenticatedRpc(rpcName: string): Promise<NextResponse>` — checa sessão (401 se ausente), chama `supabase.rpc(rpcName)`, retorna `NextResponse.json(data)` (200) ou `{erro}` (401/500). Tasks 6-7 (rotas `evolucao`/`alertas`) reusam este helper — elimina a triplicação de `ssrClient`+`getUser`+`rpc`+erro entre as 3 rotas.

- [ ] **Step 1: Escrever o teste do helper**

```typescript
// web/lib/supabase/authenticated-rpc.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = [{ ok: true }], rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('./ssr', () => ({ ssrClient: vi.fn() }));

import { authenticatedRpc } from './authenticated-rpc';
import { ssrClient } from './ssr';

describe('authenticatedRpc', () => {
  it('retorna 200 com o payload da RPC', async () => {
    const supabase = mockSupabase({ rpcData: [{ a: 1 }] });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await authenticatedRpc('minha_funcao');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ a: 1 }]);
    expect(supabase.rpc).toHaveBeenCalledWith('minha_funcao');
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await authenticatedRpc('minha_funcao');
    expect(res.status).toBe(401);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const res = await authenticatedRpc('minha_funcao');
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run lib/supabase/authenticated-rpc.test.ts`
Expected: FAIL — `Cannot find module './authenticated-rpc'`

- [ ] **Step 3: Implementar o helper**

```typescript
// web/lib/supabase/authenticated-rpc.ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ssrClient } from './ssr';

export async function authenticatedRpc(rpcName: string) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase.rpc(rpcName);
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run lib/supabase/authenticated-rpc.test.ts`
Expected: PASS — 3/3

- [ ] **Step 5: Escrever o teste da rota `ranking` (thin — confirma só que chama o helper com o nome certo)**

```typescript
// web/app/api/dashboard/ranking/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/authenticated-rpc', () => ({
  authenticatedRpc: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { GET } from './route';
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

describe('GET /api/dashboard/ranking', () => {
  it('chama authenticatedRpc com "ranking_liderancas"', async () => {
    await GET();
    expect(authenticatedRpc).toHaveBeenCalledWith('ranking_liderancas');
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/dashboard/ranking/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 7: Implementar a rota**

```typescript
// web/app/api/dashboard/ranking/route.ts
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

export async function GET() {
  return authenticatedRpc('ranking_liderancas');
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/dashboard/ranking/route.test.ts`
Expected: PASS — 1/1

- [ ] **Step 9: Commit**

```bash
git add web/lib/supabase/authenticated-rpc.ts web/lib/supabase/authenticated-rpc.test.ts web/app/api/dashboard/ranking/route.ts web/app/api/dashboard/ranking/route.test.ts
git commit -m "feat(s5): authenticatedRpc helper + GET /api/dashboard/ranking"
```

---

### Task 6: `GET /api/dashboard/evolucao`

**Files:**
- Create: `web/app/api/dashboard/evolucao/route.ts`
- Create: `web/app/api/dashboard/evolucao/route.test.ts`

**Interfaces:**
- Consumes: `authenticatedRpc` (Task 5).
- Produces: `GET` handler retornando array `{dia, total}[]` (200) via `authenticatedRpc('evolucao_pessoas')`. Task 10 (`EvolucaoChart`) faz `fetch('/api/dashboard/evolucao')`.

- [ ] **Step 1: Escrever o teste**

```typescript
// web/app/api/dashboard/evolucao/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/authenticated-rpc', () => ({
  authenticatedRpc: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { GET } from './route';
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

describe('GET /api/dashboard/evolucao', () => {
  it('chama authenticatedRpc com "evolucao_pessoas"', async () => {
    await GET();
    expect(authenticatedRpc).toHaveBeenCalledWith('evolucao_pessoas');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/dashboard/evolucao/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/dashboard/evolucao/route.ts
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

export async function GET() {
  return authenticatedRpc('evolucao_pessoas');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/dashboard/evolucao/route.test.ts`
Expected: PASS — 1/1

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
- Consumes: `authenticatedRpc` (Task 5).
- Produces: `GET` handler retornando array `{tipo, alvo_id, label, detalhe}[]` (200) via `authenticatedRpc('dashboard_alertas')`. Task 11 (`AlertasList`) faz `fetch('/api/dashboard/alertas')`.

- [ ] **Step 1: Escrever o teste**

```typescript
// web/app/api/dashboard/alertas/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/authenticated-rpc', () => ({
  authenticatedRpc: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { GET } from './route';
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

describe('GET /api/dashboard/alertas', () => {
  it('chama authenticatedRpc com "dashboard_alertas"', async () => {
    await GET();
    expect(authenticatedRpc).toHaveBeenCalledWith('dashboard_alertas');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/dashboard/alertas/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/dashboard/alertas/route.ts
import { authenticatedRpc } from '../../../../lib/supabase/authenticated-rpc';

export async function GET() {
  return authenticatedRpc('dashboard_alertas');
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/dashboard/alertas/route.test.ts`
Expected: PASS — 1/1

- [ ] **Step 5: Commit**

```bash
git add web/app/api/dashboard/alertas/route.ts web/app/api/dashboard/alertas/route.test.ts
git commit -m "feat(s5): GET /api/dashboard/alertas"
```

---

### Task 8: Página `/dashboard` + `DashboardClient` + stubs dos 3 widgets

**Files:**
- Create: `web/app/dashboard/page.tsx`
- Create: `web/app/dashboard/page.test.tsx`
- Create: `web/app/dashboard/DashboardClient.tsx`
- Create: `web/app/dashboard/AlertasList.tsx` (stub — Task 11 substitui o corpo)
- Create: `web/app/dashboard/EvolucaoChart.tsx` (stub — Task 10 substitui o corpo)
- Create: `web/app/dashboard/RankingTable.tsx` (stub — Task 9 substitui o corpo)

**Interfaces:**
- Consumes: `ssrClient`; `NavShell` (Task 4).
- Produces: página server component em `/dashboard`, sem redirect quando não autenticado (mesmo padrão de `/mapa-calor`). `DashboardClient` já compõe os 3 widgets na ordem final (Alertas → Evolução → Ranking, decisão 8 do spec) desde esta task — Tasks 9-11 **só** substituem o corpo do próprio arquivo do widget (`AlertasList.tsx`/`EvolucaoChart.tsx`/`RankingTable.tsx`), nunca tocam `DashboardClient.tsx` de novo. Cada stub exporta o mesmo nome/assinatura que a versão final terá (`export function X()`, sem props) — Tasks 9-11 não mudam a interface, só o corpo.

- [ ] **Step 1: Escrever o teste da página**

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

- [ ] **Step 3: Implementar página, `DashboardClient` e os 3 stubs**

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

```tsx
// web/app/dashboard/AlertasList.tsx (stub — Task 11 substitui o corpo, mesma assinatura)
'use client';
export function AlertasList() {
  return <div>alertas em construção</div>;
}
```

```tsx
// web/app/dashboard/EvolucaoChart.tsx (stub — Task 10 substitui o corpo, mesma assinatura)
'use client';
export function EvolucaoChart() {
  return <div>evolução em construção</div>;
}
```

```tsx
// web/app/dashboard/RankingTable.tsx (stub — Task 9 substitui o corpo, mesma assinatura)
'use client';
export function RankingTable() {
  return <div>ranking em construção</div>;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard/page.test.tsx`
Expected: PASS — 2/2

- [ ] **Step 5: Commit**

```bash
git add web/app/dashboard/page.tsx web/app/dashboard/page.test.tsx web/app/dashboard/DashboardClient.tsx web/app/dashboard/AlertasList.tsx web/app/dashboard/EvolucaoChart.tsx web/app/dashboard/RankingTable.tsx
git commit -m "feat(s5): página /dashboard — sessão + DashboardClient com os 3 widgets (stub)"
```

---

### Task 9: `RankingTable` — ranking de lideranças + nota soma≠total

**Files:**
- Modify: `web/app/dashboard/RankingTable.tsx` (substitui o stub da Task 8 — mesma assinatura, `DashboardClient.tsx` não muda)
- Create: `web/app/dashboard/RankingTable.test.tsx`

**Interfaces:**
- Consumes: `GET /api/dashboard/ranking` (Task 5) via `fetch`.
- Produces: componente `RankingTable` completo — array de linhas `{pessoa_id, nome, subarvore_count, soma_ramos, total_real}` (mesmo shape de `ranking_liderancas`, Task 1).

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/dashboard/RankingTable.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RankingTable } from './RankingTable';

const mockRanking = [
  { pessoa_id: 'p-1', nome: 'Lider A', subarvore_count: 5, soma_ramos: 7, total_real: 6 },
  { pessoa_id: 'p-2', nome: 'Lider B', subarvore_count: 2, soma_ramos: 7, total_real: 6 },
];

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
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as never;
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
Expected: FAIL — stub atual não busca dado nenhum, não tem tabela nem nota

- [ ] **Step 3: Implementar o componente**

```tsx
// web/app/dashboard/RankingTable.tsx
'use client';
import { useEffect, useState } from 'react';

type RankingRow = {
  pessoa_id: string;
  nome: string;
  subarvore_count: number;
  soma_ramos: number;
  total_real: number;
};

export function RankingTable() {
  const [linhas, setLinhas] = useState<RankingRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/dashboard/ranking')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar ranking');
        return res.json();
      })
      .then((data: RankingRow[]) => {
        if (!cancelado) setLinhas(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar o ranking.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) return <p role="alert">{erro}</p>;
  if (!linhas) return null;

  if (linhas.length === 0) {
    return <p>Nenhum líder com sub-árvore ainda.</p>;
  }

  const { soma_ramos, total_real } = linhas[0];

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
          {linhas.map((l) => (
            <tr key={l.pessoa_id}>
              <td>{l.nome}</td>
              <td>{l.subarvore_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Soma dos ramos: {soma_ramos} · Total real da campanha: {total_real}
        {soma_ramos !== total_real && (
          <> · {soma_ramos - total_real} apoiador(es) compartilhado(s) entre ramos.</>
        )}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard/RankingTable.test.tsx`
Expected: PASS — 4/4

- [ ] **Step 5: Rodar a suíte de `/dashboard` inteira**

Run: `cd web && npx vitest run app/dashboard`
Expected: todos os arquivos passam.

- [ ] **Step 6: Commit**

```bash
git add web/app/dashboard/RankingTable.tsx web/app/dashboard/RankingTable.test.tsx
git commit -m "feat(s5): RankingTable — ranking de lideranças com nota soma≠total"
```

---

### Task 10: `EvolucaoChart` — gráfico de linha (Recharts)

**Files:**
- Modify: `web/app/dashboard/EvolucaoChart.tsx` (substitui o stub da Task 8 — mesma assinatura, `DashboardClient.tsx` não muda)
- Create: `web/app/dashboard/EvolucaoChart.test.tsx`
- Modify: `web/package.json` (nova dep: `recharts`)

**Interfaces:**
- Consumes: `GET /api/dashboard/evolucao` (Task 6) via `fetch`.
- Produces: componente `EvolucaoChart` completo.

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
Expected: FAIL — stub atual não busca dado nem renderiza gráfico

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

- [ ] **Step 6: Rodar a suíte de `/dashboard` inteira**

Run: `cd web && npx vitest run app/dashboard`
Expected: todos os arquivos passam.

- [ ] **Step 7: Commit**

```bash
git add web/app/dashboard/EvolucaoChart.tsx web/app/dashboard/EvolucaoChart.test.tsx web/package.json web/package-lock.json
git commit -m "feat(s5): EvolucaoChart — linha de 90 dias com Recharts"
```

---

### Task 11: `AlertasList` — alertas de área e liderança estagnada

**Files:**
- Modify: `web/app/dashboard/AlertasList.tsx` (substitui o stub da Task 8 — mesma assinatura, `DashboardClient.tsx` não muda)
- Create: `web/app/dashboard/AlertasList.test.tsx`

**Interfaces:**
- Consumes: `GET /api/dashboard/alertas` (Task 7) via `fetch`.
- Produces: componente `AlertasList` completo. Última peça do dashboard — após esta task, `DashboardClient` (montado na Task 8) está com os 3 widgets reais.

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
Expected: FAIL — stub atual não busca dado nem renderiza lista

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

- [ ] **Step 5: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes de S0-S4.

- [ ] **Step 6: Rodar `npx tsc --noEmit`, confirmar zero erros novos em `app/dashboard/`**

- [ ] **Step 7: Commit**

```bash
git add web/app/dashboard/AlertasList.tsx web/app/dashboard/AlertasList.test.tsx
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

**1. Cobertura do spec:** decisão 1 (ranking = líderes por subárvore) → Task 1; decisão 2 (visibilidade líderes de topo vs subordinados diretos) → Task 1; decisão 3 (nota soma≠total) → Task 1 + Task 9; decisão 4 (ordenação) → Task 1 (`ORDER BY` final); decisão 5 (evolução acumulada, `CURRENT_DATE`) → Task 2; decisão 6 (alertas de área e liderança estagnada, regras fixas) → Task 3; decisão 7 (nav shell) → Task 4; decisão 8 (Recharts, layout empilhado, ordem Alertas→Evolução→Ranking) → Task 8 (ordem fixada em `DashboardClient` desde o início) + Tasks 9-11 (conteúdo real); decisão 9 (3 RPCs independentes) → Tasks 1-3 + 5-7; decisão 10 (coleção vazia sem erro) → Tasks 1-3 (`RETURN`/cross-join vazio) + Tasks 9-11 (estados vazios na UI). Não-objetivos: nenhuma task adiciona motor de regra configurável, IA, snapshot, toggle de granularidade nos alertas, abas, logout, ou abrangência estadual — confirmado por omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda task tem SQL/TS completo.

**3. Consistência de tipos:** `RankingRow` (Task 9, `{pessoa_id, nome, subarvore_count, soma_ramos, total_real}`) casa exatamente com as colunas de `ranking_liderancas` (Task 1). `Ponto` (Task 10, `{dia, total}`) casa com `evolucao_pessoas` (Task 2). `Alerta` (Task 11, `{tipo, alvo_id, label, detalhe}`) casa com `dashboard_alertas` (Task 3). Rotas (Tasks 5-7) retornam o payload cru da RPC via `authenticatedRpc`, sem transformação — tipos client-side idênticos aos server-side em todos os 3 casos (nenhum caso especial de "objeto" vs "array": as 3 RPCs retornam `TABLE`, as 3 rotas retornam array).

**Mudanças feitas após revisão do usuário (antes de qualquer execução):** (1) `ranking_liderancas` mudou de `jsonb` único pra `TABLE` — consistente com as outras 2 RPCs, sem perda de informação (linha vazia = coleção vazia, decisão 10); (2) `dashboard_alertas` dividida em `dashboard_alertas_area`/`dashboard_alertas_lideranca` (internas) + `dashboard_alertas` (pública) — mesmo padrão de composição do `mapa_calor_agregado` (S4), cada regra agora testável/reusável isoladamente; (3) limiares de alerta (30 dias, 5%) viraram constantes nomeadas no corpo da função, não números soltos — YAGNI de configurabilidade mantido (decisão explícita do spec), só a leitura melhorou; (4) documentado explicitamente que a recursão sobre `vinculo` é seguramente livre de ciclo por causa do `trg_vinculo_ciclo_check` (S2) — não é uma omissão, é uma garantia já estabelecida; (5) `authenticatedRpc` extraído como helper compartilhado — as 3 rotas (Tasks 5-7) deixam de repetir `ssrClient`+`getUser`+`rpc`+erro; (6) `DashboardClient` + os 3 stubs de widget nascem juntos na Task 8, já na ordem final — Tasks 9-11 só substituem o corpo do próprio arquivo do widget, nunca mais tocam `DashboardClient.tsx`, reduzindo o número de tasks que mexem no mesmo arquivo (de 4 tasks — 8,9,10,11 — pra 1).

---

Plano completo e salvo em `docs/superpowers/plans/2026-07-04-s5-dashboard-bi.md`.
