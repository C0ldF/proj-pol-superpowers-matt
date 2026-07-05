# S6 — Módulos & entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a infraestrutura de entitlements por módulo (ADR 0018) — enum de módulos válidos, função de checagem `SECURITY DEFINER`, funções administrativas atômicas de toggle, helper Next.js reutilizável, e uma rota nova mínima como prova de conceito fim-a-fim.

**Architecture:** Duas migrations Postgres (`0047`: enum + função pública de leitura `actor_tem_modulo`; `0048`: duas funções administrativas de mutação `habilitar_modulo`/`desabilitar_modulo`, cada uma um único `UPDATE` atômico) → helper Next.js `requireModulo` (mesmo estilo do `authenticatedRpc`, S5) → 1 rota protegida como PoC → scripts CLI finos (orquestrador puro testável + `build*Deps` + entrypoint) que chamam as funções administrativas via `service_role`, mesmo padrão do `web/scripts/tre/` (S3).

**Tech Stack:** Next.js 16.2.9 (App Router), TypeScript, Supabase (Postgres 17), Vitest, `execute_sql`/`apply_migration` via MCP Supabase, `tsx` pros scripts CLI.

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/` (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência: `docs/superpowers/specs/2026-07-04-s6-modulos-entitlements-design.md` — toda task abaixo implementa uma seção dela.
- Projeto Supabase: `axcftjqdjvknrpqzrxls`. Migrations via `mcp__supabase__apply_migration` — uma por task; cópia idêntica salva em `supabase/migrations/`. Migration mais recente é `0046`; esta fatia usa `0047`-`0048`.
- **Nunca chamar `apply_migration` mais de uma vez pra mesma migration** (lição registrada nas fatias anteriores — deixa entrada órfã no ledger remoto de migrations). Iterar com `execute_sql` + `CREATE OR REPLACE`, só 1 `apply_migration` final por task.
- `actor_tem_modulo` é **pública**: `SECURITY DEFINER`, `search_path=''`, `STRICT`, lê `auth.uid()` internamente, nunca recebe identidade como parâmetro — `p_modulo` não é identidade, é só o nome do módulo perguntado. `REVOKE ALL FROM public, anon` + `GRANT EXECUTE TO authenticated`.
- `habilitar_modulo`/`desabilitar_modulo` são **administrativas**: `SECURITY DEFINER`, `search_path=''`, recebem `p_campanha_id` explícito (não dependem de `auth.uid()`), `REVOKE ALL FROM public, authenticated, anon` — só `service_role` chama.
- Testes de função SQL (Tasks 1-2) seguem o padrão S2-S5: verificação via `execute_sql` no projeto live, fixtures criados/limpos na própria task, não viram `.test.ts`. Função pública (`actor_tem_modulo`) testada via impersonation: `SET LOCAL request.jwt.claims = '{"sub":"<user_id>"}'`. Funções administrativas testadas com chamada direta (não dependem de sessão).
- Testes de código Next.js/scripts (Tasks 3-4) rodam com `cd web && npx vitest run <caminho>`.
- `ssrClient()` = `web/lib/supabase/ssr.ts`; `adminClient()` = `web/lib/supabase/server.ts` (`service_role`, só server-side/scripts).
- Commits frequentes; mensagens estilo do repo (`feat(s6): ...`, `test(s6): ...`).
- Progresso rastreado pela skill `subagent-driven-development` em `.superpowers/sdd/progress-s6.md`.

---

## Contexto de schema (não repetir em cada task)

- `public.campanha(id uuid, modulos_habilitados jsonb NOT NULL DEFAULT '[]'::jsonb, ...)` — já existe desde o S0 (`0002_campanha.sql`), nenhuma alteração de coluna nesta fatia.
- `public.campanha` tem RLS ligado **sem nenhuma policy** pra `authenticated`/`anon` (`0003_campanha_rls.sql`) — deny total; só `service_role` ou função `SECURITY DEFINER` acessa a tabela diretamente.
- `public.usuario_campanha(user_id uuid PRIMARY KEY, campanha_id uuid NOT NULL, papel public.papel_login NOT NULL, pessoa_id uuid NULL)` — já existe desde o S1.
- `web/lib/supabase/ssr.ts` → `ssrClient(cookieStore)`; `web/lib/supabase/server.ts` → `adminClient()` (`service_role`) e `publicClient()`.
- `web/lib/supabase/authenticated-rpc.ts` (S5) — helper de referência pro estilo do `requireModulo` desta fatia (mesmo padrão: checa sessão via `ssrClient`, chama uma RPC, retorna `NextResponse`).
- `web/scripts/tre/` (S3) — padrão de referência pro CLI desta fatia: orquestrador puro (`lote.ts`) + `build*Deps.ts` (wiring do `adminClient`) + `cli/*.ts` (entrypoint fino com `parseArgs`).

---

### Task 1: `modulo_enum` + `actor_tem_modulo` (leitura pública)

**Files:**
- Create: `supabase/migrations/0047_modulo_enum_e_actor_tem_modulo.sql`

**Interfaces:**
- Produces: tipo `public.modulo_enum` (`'comunicacao' | 'ia'`); `public.actor_tem_modulo(p_modulo public.modulo_enum) RETURNS boolean`, `GRANT`ada pra `authenticated`. Task 3 (`requireModulo`) chama via `supabase.rpc('actor_tem_modulo', { p_modulo })`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0047_modulo_enum_e_actor_tem_modulo.sql
CREATE TYPE public.modulo_enum AS ENUM ('comunicacao', 'ia');

CREATE OR REPLACE FUNCTION public.actor_tem_modulo(
  p_modulo public.modulo_enum
) RETURNS boolean
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuario_campanha uc
      JOIN public.campanha c ON c.id = uc.campanha_id
     WHERE uc.user_id = auth.uid()
       AND c.modulos_habilitados ? p_modulo::text
  );
$$;
REVOKE ALL ON FUNCTION public.actor_tem_modulo(public.modulo_enum) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actor_tem_modulo(public.modulo_enum) TO authenticated;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `modulo_enum_e_actor_tem_modulo`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture (1 usuário real em `auth.users`, 2 campanhas)**

```javascript
// scratchpad: fixture-actor-tem-modulo.mjs
// Rodar com: node fixture-actor-tem-modulo.mjs
// Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (carregar do web/.env.local)
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: userA } = await admin.auth.admin.createUser({
  email: 's6-fixture-campanha-a@teste.local', password: 'SenhaForte!S6a', email_confirm: true,
});
console.log('user_a_id=', userA.user.id);

const { data: campA } = await admin.from('campanha').insert({
  subdominio: 's6-fixture-campanha-a', nome: 'S6 Fixture Campanha A', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
const { data: campB } = await admin.from('campanha').insert({
  subdominio: 's6-fixture-campanha-b', nome: 'S6 Fixture Campanha B', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
console.log('campanha_a_id=', campA.id, 'campanha_b_id=', campB.id);

const { data: userB } = await admin.auth.admin.createUser({
  email: 's6-fixture-campanha-b@teste.local', password: 'SenhaForte!S6b', email_confirm: true,
});
console.log('user_b_id=', userB.user.id);

await admin.from('usuario_campanha').insert([
  { user_id: userA.user.id, campanha_id: campA.id, papel: 'gestor', cpf_hmac: 'fixture-s6-a' },
  { user_id: userB.user.id, campanha_id: campB.id, papel: 'gestor', cpf_hmac: 'fixture-s6-b' },
]);

console.log('fixture pronta. Ambas comecam com modulos_habilitados=[] (default do S0).');
```

- [ ] **Step 4: Verificar via `execute_sql` (impersonation com `request.jwt.claims`)**

Substitua `<user_a_id>`/`<user_b_id>`/`<campanha_a_id>`/`<campanha_b_id>` pelos valores impressos no Step 3.

```sql
SET LOCAL request.jwt.claims = '{"sub":"<user_a_id>"}';

-- Campanha A começa com modulos_habilitados=[] (default do S0) — sem o módulo.
SELECT public.actor_tem_modulo('comunicacao');
-- esperado: false

-- Adicionar um módulo DIFERENTE ('ia') via UPDATE direto (habilitar_modulo só
-- existe na Task 2) — confirma que 'comunicacao' continua false mesmo com
-- outro módulo presente no array (não é "array vazio", é "array sem esse
-- elemento específico").
UPDATE public.campanha SET modulos_habilitados = '["ia"]'::jsonb WHERE id = '<campanha_a_id>';
SELECT public.actor_tem_modulo('comunicacao');
-- esperado: false
SELECT public.actor_tem_modulo('ia');
-- esperado: true

-- Adicionar 'comunicacao' também.
UPDATE public.campanha SET modulos_habilitados = '["ia", "comunicacao"]'::jsonb WHERE id = '<campanha_a_id>';
SELECT public.actor_tem_modulo('comunicacao');
-- esperado: true

-- Array vazio explícito — caso distinto do "array sem o elemento".
UPDATE public.campanha SET modulos_habilitados = '[]'::jsonb WHERE id = '<campanha_a_id>';
SELECT public.actor_tem_modulo('comunicacao');
-- esperado: false

-- Isolamento entre campanhas: habilita 'comunicacao' SÓ em B (A continua []
-- deste passo anterior). Como actor_tem_modulo resolve a campanha do
-- PRÓPRIO usuário via usuario_campanha (não recebe campanha_id como
-- parâmetro), userA (ligado a A) e userB (ligado a B) devem ver resultados
-- DIFERENTES pro mesmo módulo — prova real de isolamento, não só "A está
-- vazio".
UPDATE public.campanha SET modulos_habilitados = '["comunicacao"]'::jsonb WHERE id = '<campanha_b_id>';

SET LOCAL request.jwt.claims = '{"sub":"<user_a_id>"}';
SELECT public.actor_tem_modulo('comunicacao');
-- esperado: false (userA está ligado à campanha A, que não tem o módulo)

SET LOCAL request.jwt.claims = '{"sub":"<user_b_id>"}';
SELECT public.actor_tem_modulo('comunicacao');
-- esperado: true (userB está ligado à campanha B, que tem o módulo)

-- Usuário sem usuario_campanha: retorna false, não erro. Gere um uuid
-- aleatório primeiro (SET LOCAL exige um literal, não aceita `||` direto no
-- valor) e substitua no SET LOCAL abaixo.
SELECT gen_random_uuid();
-- copie o valor impresso e cole no lugar de <uuid_aleatorio> abaixo
SET LOCAL request.jwt.claims = '{"sub":"<uuid_aleatorio>"}';
SELECT public.actor_tem_modulo('comunicacao');
-- esperado: false

-- Módulo inválido (fora do enum): erro de cast do Postgres, não precisa de
-- validação manual.
SELECT public.actor_tem_modulo('modulo-que-nao-existe');
-- esperado: erro "invalid input value for enum modulo_enum"
```

- [ ] **Step 5: Limpar a fixture**

```sql
DELETE FROM public.usuario_campanha WHERE campanha_id IN ('<campanha_a_id>', '<campanha_b_id>');
DELETE FROM public.campanha WHERE id IN ('<campanha_a_id>', '<campanha_b_id>');
```

```javascript
await admin.auth.admin.deleteUser('<user_a_id>');
await admin.auth.admin.deleteUser('<user_b_id>');
```

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos além do WARN esperado (`actor_tem_modulo` executável por `authenticated`, mesma categoria já aceita das outras funções desta família).

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0047_modulo_enum_e_actor_tem_modulo.sql
git commit -m "feat(s6): modulo_enum + actor_tem_modulo — checagem de entitlement por campanha"
```

Não commitar o script de fixture.

---

### Task 2: `habilitar_modulo` / `desabilitar_modulo` (mutação administrativa)

**Files:**
- Create: `supabase/migrations/0048_habilitar_desabilitar_modulo.sql`

**Interfaces:**
- Produces: `public.habilitar_modulo(p_campanha_id uuid, p_modulo public.modulo_enum) RETURNS void`, `public.desabilitar_modulo(p_campanha_id uuid, p_modulo public.modulo_enum) RETURNS void` — ambas `REVOKE`d de `authenticated`/`anon`/`public`, só `service_role` chama. Task 4 (`toggle-modulo.ts` via `buildToggleModuloDeps`) chama via `admin.rpc('habilitar_modulo' | 'desabilitar_modulo', { p_campanha_id, p_modulo })`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0048_habilitar_desabilitar_modulo.sql
CREATE OR REPLACE FUNCTION public.habilitar_modulo(
  p_campanha_id uuid,
  p_modulo public.modulo_enum
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.campanha
     SET modulos_habilitados = CASE
           WHEN modulos_habilitados ? p_modulo::text THEN modulos_habilitados
           ELSE modulos_habilitados || to_jsonb(p_modulo::text)
         END
   WHERE id = p_campanha_id;
$$;
REVOKE ALL ON FUNCTION public.habilitar_modulo(uuid, public.modulo_enum) FROM public, authenticated, anon;

CREATE OR REPLACE FUNCTION public.desabilitar_modulo(
  p_campanha_id uuid,
  p_modulo public.modulo_enum
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.campanha c
     SET modulos_habilitados = coalesce((
           SELECT jsonb_agg(elem)
             FROM jsonb_array_elements_text(c.modulos_habilitados) elem
            WHERE elem <> p_modulo::text
         ), '[]'::jsonb)
   WHERE c.id = p_campanha_id;
$$;
REVOKE ALL ON FUNCTION public.desabilitar_modulo(uuid, public.modulo_enum) FROM public, authenticated, anon;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `habilitar_desabilitar_modulo`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture (1 campanha, sem precisar de usuário real — estas funções não usam `auth.uid()`)**

```javascript
// scratchpad: fixture-habilitar-desabilitar-modulo.mjs
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: camp } = await admin.from('campanha').insert({
  subdominio: 's6-fixture-toggle', nome: 'S6 Fixture Toggle', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
console.log('campanha_id=', camp.id);
console.log('fixture pronta — comeca com modulos_habilitados=[] (default do S0).');
```

- [ ] **Step 4: Verificar via `execute_sql` (chamada direta, sem impersonation — não dependem de sessão)**

Substitua `<campanha_id>` pelo valor impresso no Step 3.

```sql
-- Habilitar 'comunicacao': array vai de [] pra ["comunicacao"].
SELECT public.habilitar_modulo('<campanha_id>', 'comunicacao');
SELECT modulos_habilitados FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: ["comunicacao"]

-- Idempotente: habilitar de novo não duplica.
SELECT public.habilitar_modulo('<campanha_id>', 'comunicacao');
SELECT modulos_habilitados, jsonb_array_length(modulos_habilitados) AS tamanho
  FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: ainda ["comunicacao"], tamanho=1 (não virou 2)

-- Habilitar um segundo módulo: array cresce sem apagar o primeiro.
SELECT public.habilitar_modulo('<campanha_id>', 'ia');
SELECT modulos_habilitados FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: ["comunicacao", "ia"] (ordem não é garantida nem significativa,
-- só confirme que os 2 elementos estão presentes)

-- Desabilitar 'comunicacao': só ele sai, 'ia' continua.
SELECT public.desabilitar_modulo('<campanha_id>', 'comunicacao');
SELECT modulos_habilitados FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: ["ia"]

-- Idempotente: desabilitar um módulo já ausente não erra e não altera o array.
SELECT public.desabilitar_modulo('<campanha_id>', 'comunicacao');
SELECT modulos_habilitados FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: ainda ["ia"], sem erro

-- Desabilitar até esvaziar: array vira [] explícito, não NULL.
SELECT public.desabilitar_modulo('<campanha_id>', 'ia');
SELECT modulos_habilitados FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: [] (não NULL — o coalesce garante isso)

-- REVOKE confirmado: authenticated não pode executar (nem via grant
-- indireto). Confirmar pela tabela de grants, não só lendo o DDL.
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
 WHERE routine_name IN ('habilitar_modulo', 'desabilitar_modulo');
-- esperado: nenhuma linha com grantee='authenticated' (só postgres/service
-- roles administrativos aparecem, se aparecerem)
```

- [ ] **Step 5: Limpar a fixture**

```sql
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos (estas funções não são executáveis por `authenticated`, então não devem gerar o WARN de "security definer function executable" — diferente de `actor_tem_modulo`).

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0048_habilitar_desabilitar_modulo.sql
git commit -m "feat(s6): habilitar_modulo/desabilitar_modulo — mutação atômica, só service_role"
```

Não commitar o script de fixture.

---

### Task 3: `requireModulo` helper + `GET /api/modulos/comunicacao-preview`

**Files:**
- Create: `web/lib/supabase/require-modulo.ts`
- Create: `web/lib/supabase/require-modulo.test.ts`
- Create: `web/app/api/modulos/comunicacao-preview/route.ts`
- Create: `web/app/api/modulos/comunicacao-preview/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`), RPC `actor_tem_modulo` (Task 1).
- Produces: `requireModulo(modulo: 'comunicacao' | 'ia'): Promise<NextResponse | null>` — retorna `NextResponse` (401/403/500) quando bloqueado, `null` quando liberado. `GET /api/modulos/comunicacao-preview` usa o helper e retorna `200 {preview: true}` quando liberado.

- [ ] **Step 1: Escrever o teste do helper**

```typescript
// web/lib/supabase/require-modulo.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

function mockSupabase(overrides: Partial<{ user: { id: string } | null; rpcData: unknown; rpcError: unknown }> = {}) {
  const { user = { id: 'u-1' }, rpcData = true, rpcError = null } = overrides;
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
  };
}

vi.mock('./ssr', () => ({ ssrClient: vi.fn() }));

import { requireModulo } from './require-modulo';
import { ssrClient } from './ssr';

describe('requireModulo', () => {
  it('retorna null quando o módulo está habilitado', async () => {
    const supabase = mockSupabase({ rpcData: true });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('actor_tem_modulo', { p_modulo: 'comunicacao' });
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('403 quando o módulo não está habilitado', async () => {
    const supabase = mockSupabase({ rpcData: false });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireModulo('comunicacao');
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run lib/supabase/require-modulo.test.ts`
Expected: FAIL — `Cannot find module './require-modulo'`

- [ ] **Step 3: Implementar o helper**

```typescript
// web/lib/supabase/require-modulo.ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ssrClient } from './ssr';

export async function requireModulo(modulo: 'comunicacao' | 'ia'): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data: temModulo, error } = await supabase.rpc('actor_tem_modulo', { p_modulo: modulo });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  if (!temModulo) return NextResponse.json({ erro: 'módulo não habilitado' }, { status: 403 });
  return null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run lib/supabase/require-modulo.test.ts`
Expected: PASS — 4/4

- [ ] **Step 5: Escrever o teste da rota**

```typescript
// web/app/api/modulos/comunicacao-preview/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/require-modulo', () => ({
  requireModulo: vi.fn(async () => null),
}));

import { GET } from './route';
import { requireModulo } from '../../../../lib/supabase/require-modulo';

describe('GET /api/modulos/comunicacao-preview', () => {
  it('retorna 200 {preview:true} quando requireModulo libera (retorna null)', async () => {
    vi.mocked(requireModulo).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ preview: true });
    expect(requireModulo).toHaveBeenCalledWith('comunicacao');
  });

  it('repassa o NextResponse de bloqueio quando requireModulo retorna não-null', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'módulo não habilitado' }, { status: 403 });
    vi.mocked(requireModulo).mockResolvedValueOnce(blocked);
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/modulos/comunicacao-preview/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 7: Implementar a rota**

```typescript
// web/app/api/modulos/comunicacao-preview/route.ts
import { NextResponse } from 'next/server';
import { requireModulo } from '../../../../lib/supabase/require-modulo';

export async function GET() {
  const blocked = await requireModulo('comunicacao');
  if (blocked) return blocked;
  return NextResponse.json({ preview: true });
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/modulos/comunicacao-preview/route.test.ts`
Expected: PASS — 2/2

- [ ] **Step 9: Verificar contra o banco real (opcional mas recomendado — confirma que `actor_tem_modulo` e `requireModulo` casam de verdade, não só via mock)**

Reaproveite a fixture do Task 1, Steps 3-4 (recrie se já limpou): logue de verdade como `userA` (via `POST /api/auth/login` ou sessão real), acesse `GET /api/modulos/comunicacao-preview` com `cd web && npm run dev` rodando — confirme 403 com `modulos_habilitados=[]`, depois rode `UPDATE campanha SET modulos_habilitados='["comunicacao"]'::jsonb WHERE id='<campanha_a_id>'` via `execute_sql` e confirme que a MESMA sessão (sem novo login) já passa a receber 200 (a checagem é por request, não fica em cache de sessão). Limpe a fixture depois.

- [ ] **Step 10: Commit**

```bash
git add web/lib/supabase/require-modulo.ts web/lib/supabase/require-modulo.test.ts web/app/api/modulos/comunicacao-preview/route.ts web/app/api/modulos/comunicacao-preview/route.test.ts
git commit -m "feat(s6): requireModulo helper + GET /api/modulos/comunicacao-preview (PoC do gate)"
```

---

### Task 4: Scripts CLI `modulos:habilitar` / `modulos:desabilitar`

**Files:**
- Create: `web/scripts/modulos/toggle-modulo.ts`
- Create: `web/scripts/modulos/toggle-modulo.test.ts`
- Create: `web/scripts/modulos/build-toggle-modulo-deps.ts`
- Create: `web/scripts/modulos/cli/habilitar.ts`
- Create: `web/scripts/modulos/cli/desabilitar.ts`
- Modify: `web/package.json` (2 novos scripts npm)

**Interfaces:**
- Consumes: `adminClient` (`web/lib/supabase/server.ts`), RPCs `habilitar_modulo`/`desabilitar_modulo` (Task 2).
- Produces: `toggleModulo(acao: 'habilitar' | 'desabilitar', campanhaId: string, modulo: string, deps: ToggleModuloDeps): Promise<void>` — orquestrador puro, testável sem rede. `buildToggleModuloDeps(): ToggleModuloDeps` — wiring real via `adminClient()`. Nenhuma task futura consome isso (é o fim da cadeia desta fatia).

- [ ] **Step 1: Escrever o teste do orquestrador**

```typescript
// web/scripts/modulos/toggle-modulo.test.ts
import { describe, it, expect, vi } from 'vitest';
import { toggleModulo, type ToggleModuloDeps } from './toggle-modulo';

function makeDeps(overrides: Partial<ToggleModuloDeps> = {}): ToggleModuloDeps {
  return {
    chamarRpc: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('toggleModulo', () => {
  it('chama habilitar_modulo quando acao="habilitar"', async () => {
    const deps = makeDeps();
    await toggleModulo('habilitar', 'campanha-1', 'comunicacao', deps);
    expect(deps.chamarRpc).toHaveBeenCalledWith('habilitar_modulo', {
      p_campanha_id: 'campanha-1',
      p_modulo: 'comunicacao',
    });
  });

  it('chama desabilitar_modulo quando acao="desabilitar"', async () => {
    const deps = makeDeps();
    await toggleModulo('desabilitar', 'campanha-1', 'ia', deps);
    expect(deps.chamarRpc).toHaveBeenCalledWith('desabilitar_modulo', {
      p_campanha_id: 'campanha-1',
      p_modulo: 'ia',
    });
  });

  it('lança erro quando a RPC retorna erro', async () => {
    const deps = makeDeps({ chamarRpc: vi.fn(async () => ({ error: { message: 'falha no banco' } })) });
    await expect(toggleModulo('habilitar', 'campanha-1', 'comunicacao', deps)).rejects.toThrow('falha no banco');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run scripts/modulos/toggle-modulo.test.ts`
Expected: FAIL — `Cannot find module './toggle-modulo'`

- [ ] **Step 3: Implementar o orquestrador**

```typescript
// web/scripts/modulos/toggle-modulo.ts
export type ToggleModuloDeps = {
  chamarRpc(
    rpcName: 'habilitar_modulo' | 'desabilitar_modulo',
    args: { p_campanha_id: string; p_modulo: string },
  ): Promise<{ error: { message: string } | null }>;
};

export async function toggleModulo(
  acao: 'habilitar' | 'desabilitar',
  campanhaId: string,
  modulo: string,
  deps: ToggleModuloDeps,
): Promise<void> {
  const rpcName = acao === 'habilitar' ? 'habilitar_modulo' : 'desabilitar_modulo';
  const { error } = await deps.chamarRpc(rpcName, { p_campanha_id: campanhaId, p_modulo: modulo });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run scripts/modulos/toggle-modulo.test.ts`
Expected: PASS — 3/3

- [ ] **Step 5: Implementar `buildToggleModuloDeps` (wiring real, sem teste próprio — só `adminClient` + `.rpc(...)`, mesmo padrão de `build-lote-deps.ts` no S3)**

```typescript
// web/scripts/modulos/build-toggle-modulo-deps.ts
import { adminClient } from '../../lib/supabase/server';
import type { ToggleModuloDeps } from './toggle-modulo';

export function buildToggleModuloDeps(): ToggleModuloDeps {
  const admin = adminClient();
  return {
    async chamarRpc(rpcName, args) {
      return admin.rpc(rpcName, args);
    },
  };
}
```

- [ ] **Step 6: Implementar os 2 entrypoints CLI**

```typescript
// web/scripts/modulos/cli/habilitar.ts
import { parseArgs } from 'node:util';
import { toggleModulo } from '../toggle-modulo';
import { buildToggleModuloDeps } from '../build-toggle-modulo-deps';

const { values } = parseArgs({
  options: { campanha: { type: 'string' }, modulo: { type: 'string' } },
});
if (!values.campanha || !values.modulo) {
  console.error('uso: modulos:habilitar --campanha <uuid> --modulo <comunicacao|ia>');
  process.exit(1);
}

toggleModulo('habilitar', values.campanha, values.modulo, buildToggleModuloDeps())
  .then(() => console.log(`módulo "${values.modulo}" habilitado pra campanha ${values.campanha}`))
  .catch((err) => {
    console.error('erro ao habilitar módulo:', err);
    process.exit(1);
  });
```

```typescript
// web/scripts/modulos/cli/desabilitar.ts
import { parseArgs } from 'node:util';
import { toggleModulo } from '../toggle-modulo';
import { buildToggleModuloDeps } from '../build-toggle-modulo-deps';

const { values } = parseArgs({
  options: { campanha: { type: 'string' }, modulo: { type: 'string' } },
});
if (!values.campanha || !values.modulo) {
  console.error('uso: modulos:desabilitar --campanha <uuid> --modulo <comunicacao|ia>');
  process.exit(1);
}

toggleModulo('desabilitar', values.campanha, values.modulo, buildToggleModuloDeps())
  .then(() => console.log(`módulo "${values.modulo}" desabilitado pra campanha ${values.campanha}`))
  .catch((err) => {
    console.error('erro ao desabilitar módulo:', err);
    process.exit(1);
  });
```

- [ ] **Step 7: Adicionar os scripts npm**

Editar `web/package.json`, dentro de `"scripts"` (mesmo bloco dos scripts `tre:*` já existentes):

```json
"modulos:habilitar": "tsx scripts/modulos/cli/habilitar.ts",
"modulos:desabilitar": "tsx scripts/modulos/cli/desabilitar.ts"
```

- [ ] **Step 8: Verificar o script real de ponta a ponta contra o banco (não é `.test.ts` — é execução real do CLI compilado)**

Criar uma campanha de fixture temporária via `execute_sql`:

```sql
INSERT INTO public.campanha (subdominio, nome, cargo, abrangencia, municipio_id, data_eleicao)
VALUES ('s6-fixture-cli', 'S6 Fixture CLI', 'prefeito', 'municipal', 2211001, '2028-10-01')
RETURNING id;
```

Rodar o CLI de verdade (substitua `<campanha_id>` pelo id retornado acima):

```bash
cd web && npx tsx --env-file=.env.local scripts/modulos/cli/habilitar.ts --campanha <campanha_id> --modulo comunicacao
```

Expected: imprime `módulo "comunicacao" habilitado pra campanha <campanha_id>`, sem erro.

Confirmar via `execute_sql`:

```sql
SELECT modulos_habilitados FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: ["comunicacao"]
```

Rodar o desabilitar:

```bash
cd web && npx tsx --env-file=.env.local scripts/modulos/cli/desabilitar.ts --campanha <campanha_id> --modulo comunicacao
```

Expected: imprime `módulo "comunicacao" desabilitado pra campanha <campanha_id>`, sem erro.

Confirmar via `execute_sql`:

```sql
SELECT modulos_habilitados FROM public.campanha WHERE id = '<campanha_id>';
-- esperado: []
```

Limpar a fixture:

```sql
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

- [ ] **Step 9: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes de S0-S5.

- [ ] **Step 10: Rodar `npx tsc --noEmit`, confirmar zero erros novos**

- [ ] **Step 11: Commit**

```bash
git add web/scripts/modulos/toggle-modulo.ts web/scripts/modulos/toggle-modulo.test.ts web/scripts/modulos/build-toggle-modulo-deps.ts web/scripts/modulos/cli/habilitar.ts web/scripts/modulos/cli/desabilitar.ts web/package.json
git commit -m "feat(s6): scripts modulos:habilitar/modulos:desabilitar (CLI fino sobre RPC atômica)"
```

---

## Self-Review

**1. Cobertura do spec:** decisão 1 (enum `modulo_enum`) → Task 1; decisão 2 (`actor_tem_modulo`, função elevada, `p_modulo` não é identidade) → Task 1; decisão 3 (`requireModulo`, sem middleware central) → Task 3; decisão 4 (toggle via CLI, mutação atômica em SQL — não read-modify-write em JS) → Task 2 (as funções) + Task 4 (o CLI que só chama as RPCs, nenhuma lógica de array em TS); decisão 5 (PoC `GET /api/modulos/comunicacao-preview`, rota nova em vez de proteger tela do núcleo) → Task 3; decisão 6 (sem restrição de papel adicional) → Task 1 (o `JOIN` com `usuario_campanha` não filtra por `papel`, qualquer papel que tenha vínculo com a campanha passa). Não-objetivos: nenhuma task cria painel/login Superadmin, módulo real funcional, middleware central, UI de toggle, ou billing automático — confirmado por omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda task tem SQL/TS completo.

**3. Consistência de tipos:** `modulo: 'comunicacao' | 'ia'` usado identicamente em `requireModulo` (Task 3) e no enum `modulo_enum` (Task 1) — mesmos 2 valores, mesma ordem de menção em toda a fatia. `ToggleModuloDeps.chamarRpc` (Task 4) tem a assinatura `(rpcName: 'habilitar_modulo' | 'desabilitar_modulo', args: {p_campanha_id, p_modulo}) => Promise<{error}>` — casa exatamente com o formato de retorno do `supabase-js` `.rpc(...)` (`{data, error}`, aqui só `error` é usado já que as funções retornam `void`) e com os nomes de parâmetro das funções SQL da Task 2 (`p_campanha_id`, `p_modulo`).

**Gap encontrado e corrigido durante o self-review:** a spec não especifica se o CLI (Task 4) precisa de uma verificação end-to-end contra o banco real, além do teste unitário do orquestrador — adicionado como Step 8 da Task 4 (execução real do `tsx` contra uma fixture temporária), fechando o loop entre "a lógica está correta" (teste unitário, Step 1-4) e "o script real funciona de ponta a ponta" (Step 8), mesmo padrão de verificação em 2 camadas usado nas fatias anteriores (S4 Task 8, S5 Task 12).

---

Plano completo e salvo em `docs/superpowers/plans/2026-07-04-s6-modulos-entitlements.md`.
