# S7 — Painel Superadmin (mínimo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship login e painel Superadmin mínimos — identidade fora de qualquer campanha, autenticada via Supabase Auth, com uma tela pra listar campanhas e ligar/desligar módulo (S6) por campanha.

**Architecture:** Duas migrations Postgres (tabela `superadmin` + `actor_e_superadmin()`; `custom_access_token_hook` atualizado com um 2º claim independente) → `requireSuperadmin` helper (mesmo formato do `requireModulo`, S6) → 3 rotas Next.js (`login`, `logout`, `campanhas`, `modulos` — a última reusa `toggleModulo`/`buildToggleModuloDeps` do S6 sem modificar) → 2 páginas (`/superadmin/login`, `/superadmin/dashboard`) → script CLI pra criar o primeiro superadmin.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript, Supabase (Postgres 17 + Auth), Vitest (+ `jsdom`/`@testing-library/react`, já existentes desde S4/S5), `execute_sql`/`apply_migration` via MCP Supabase.

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/` (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência: `docs/superpowers/specs/2026-07-05-s7-painel-superadmin-design.md` — toda task abaixo implementa uma seção dela.
- Projeto Supabase: `axcftjqdjvknrpqzrxls`. Migrations via `mcp__supabase__apply_migration` — uma por task; cópia idêntica salva em `supabase/migrations/`. Migration mais recente é `0048`; esta fatia usa `0049`-`0050`.
- **Nunca chamar `apply_migration` mais de uma vez pra mesma migration** — lição registrada em fatias anteriores (deixa entrada órfã no ledger remoto). Iterar com `execute_sql` + `CREATE OR REPLACE`, só 1 `apply_migration` final por task.
- `actor_e_superadmin()` é **pública**: `SECURITY DEFINER` (necessário — `superadmin` tem RLS deny-total pra `authenticated`, `SECURITY INVOKER` sempre retornaria `false`), `STABLE`, `search_path=''`, lê `auth.uid()` internamente, nunca recebe identidade como parâmetro. `REVOKE ALL FROM public, anon` + `GRANT EXECUTE TO authenticated`.
- **Banco é a autoridade final, não o JWT.** `requireSuperadmin()` e a página do dashboard sempre chamam `actor_e_superadmin()` a cada request — nunca confiam no claim `app_metadata.superadmin` do JWT pra autorizar uma ação (o JWT só serve pra saber quem logou, checado uma vez no momento do login).
- `POST /api/superadmin/modulos` **reusa sem modificar** `toggleModulo`/`ToggleModuloDeps`/`buildToggleModuloDeps` de `web/scripts/modulos/toggle-modulo.ts` e `web/scripts/modulos/build-toggle-modulo-deps.ts` (já existentes desde o S6) — nenhuma lógica de mutação de array nova nesta fatia.
- Toggle de módulo na UI é **pessimista**: o checkbox só reflete o novo estado depois da resposta `200`, nunca antes.
- `ssrClient()` = `web/lib/supabase/ssr.ts`; `adminClient()` = `web/lib/supabase/server.ts` (`service_role`, só server-side/scripts).
- Commits frequentes; mensagens estilo do repo (`feat(s7): ...`, `test(s7): ...`).
- Progresso rastreado pela skill `subagent-driven-development` em `.superpowers/sdd/progress-s7.md`.

---

## Contexto de schema (não repetir em cada task)

- `public.campanha(id uuid, nome text, subdominio text, modulos_habilitados jsonb NOT NULL DEFAULT '[]'::jsonb, ...)` — já existe desde o S0; RLS deny-total pra `authenticated`/`anon` (`0003_campanha_rls.sql`).
- `public.usuario_campanha(user_id uuid PRIMARY KEY REFERENCES auth.users(id), campanha_id uuid NOT NULL, papel public.papel_login NOT NULL, ...)` — já existe desde o S1.
- `public.custom_access_token_hook(event jsonb) RETURNS jsonb` — já existe desde o S1 (`0007_custom_access_token_hook.sql`), `LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''`, `GRANT EXECUTE TO supabase_auth_admin` + `REVOKE ... FROM authenticated, anon, public`. Corpo atual completo:
  ```sql
  create or replace function public.custom_access_token_hook(event jsonb)
  returns jsonb
  language plpgsql stable security invoker set search_path = ''
  as $$
  declare
    claims jsonb;
    rec record;
  begin
    claims := event->'claims';
    select campanha_id, papel into rec
      from public.usuario_campanha where user_id = (event->>'user_id')::uuid;
    if jsonb_typeof(claims->'app_metadata') is null then
      claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
    end if;
    if rec.campanha_id is not null then
      claims := jsonb_set(claims, '{app_metadata, campanha_id}', to_jsonb(rec.campanha_id::text));
      claims := jsonb_set(claims, '{app_metadata, papel}', to_jsonb(rec.papel::text));
    end if;
    return jsonb_set(event, '{claims}', claims);
  end;
  $$;
  ```
- `web/lib/modulos.ts` (S6) → `MODULOS` (`readonly ['comunicacao', 'ia']`), `Modulo` (`'comunicacao' | 'ia'`), `isModulo(value: string): value is Modulo`.
- `web/scripts/modulos/toggle-modulo.ts` (S6) → `ToggleModuloDeps = { chamarRpc(rpcName: 'habilitar_modulo' | 'desabilitar_modulo', args: { p_campanha_id: string; p_modulo: string }): Promise<{ data: boolean | null; error: { message: string } | null }> }`; `toggleModulo(acao: 'habilitar' | 'desabilitar', campanhaId: string, modulo: Modulo, deps: ToggleModuloDeps): Promise<void>` (lança erro se `error` ou se `data === false`).
- `web/scripts/modulos/build-toggle-modulo-deps.ts` (S6) → `buildToggleModuloDeps(): ToggleModuloDeps` (wiring real via `adminClient().rpc(...)`).
- `web/lib/auth/login.ts` (S1) → padrão de orquestrador puro de login já estabelecido (`loginCampanha`/`LoginDeps`), referência de estilo pro login do superadmin.
- `web/lib/supabase/require-modulo.ts` (S6) → padrão de helper já estabelecido (`checarModulo` interno + `hasModulo`/`requireModulo` públicos), referência de estilo pro `requireSuperadmin`.

---

### Task 1: `superadmin` (tabela) + `actor_e_superadmin()`

**Files:**
- Create: `supabase/migrations/0049_superadmin.sql`

**Interfaces:**
- Produces: tabela `public.superadmin(user_id uuid PRIMARY KEY REFERENCES auth.users(id), criado_em timestamptz NOT NULL DEFAULT now())`; `public.actor_e_superadmin() RETURNS boolean`, `GRANT`ada pra `authenticated`. Task 3 (`requireSuperadmin`) chama via `supabase.rpc('actor_e_superadmin')`. Task 8 (CLI) insere linhas nesta tabela via `service_role`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0049_superadmin.sql
CREATE TABLE public.superadmin (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id),
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.superadmin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.superadmin FROM authenticated, anon, public;

-- O hook (rodando como supabase_auth_admin) precisa ler, mesmo padrão de
-- usuario_campanha (0006_papel_login_usuario_campanha.sql).
GRANT SELECT ON TABLE public.superadmin TO supabase_auth_admin;
CREATE POLICY "auth_admin_le_superadmin" ON public.superadmin
  AS PERMISSIVE FOR SELECT TO supabase_auth_admin USING (true);

-- service_role (CLI de criação e rotas administrativas do painel) lê e escreve.
GRANT SELECT, INSERT, DELETE ON TABLE public.superadmin TO service_role;

CREATE OR REPLACE FUNCTION public.actor_e_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.superadmin WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.actor_e_superadmin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actor_e_superadmin() TO authenticated;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `superadmin`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture (2 usuários reais em `auth.users`: um comum, um superadmin)**

```javascript
// scratchpad: fixture-actor-e-superadmin.mjs
// Rodar com: node fixture-actor-e-superadmin.mjs
// Requer NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (carregar do web/.env.local)
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: userComum } = await admin.auth.admin.createUser({
  email: 's7-fixture-comum@teste.local', password: 'SenhaForte!S7a', email_confirm: true,
});
console.log('user_comum_id=', userComum.user.id);

const { data: userSuperadmin } = await admin.auth.admin.createUser({
  email: 's7-fixture-superadmin@teste.local', password: 'SenhaForte!S7b', email_confirm: true,
});
console.log('user_superadmin_id=', userSuperadmin.user.id);

await admin.from('superadmin').insert({ user_id: userSuperadmin.user.id });

console.log('fixture pronta.');
```

- [ ] **Step 4: Verificar via `execute_sql` (impersonation com `request.jwt.claims`)**

Substitua `<user_comum_id>`/`<user_superadmin_id>` pelos valores impressos no Step 3.

```sql
-- Usuário comum (não superadmin): false.
SET LOCAL request.jwt.claims = '{"sub":"<user_comum_id>"}';
SELECT public.actor_e_superadmin();
-- esperado: false

-- Superadmin real: true.
SET LOCAL request.jwt.claims = '{"sub":"<user_superadmin_id>"}';
SELECT public.actor_e_superadmin();
-- esperado: true

-- Usuário sem sessão real (uuid aleatório, nunca existiu): false, não erro.
-- Gere o uuid primeiro (SET LOCAL exige um literal, não aceita `||` direto).
SELECT gen_random_uuid();
-- copie o valor impresso e cole no lugar de <uuid_aleatorio> abaixo
SET LOCAL request.jwt.claims = '{"sub":"<uuid_aleatorio>"}';
SELECT public.actor_e_superadmin();
-- esperado: false
```

- [ ] **Step 5: Limpar a fixture**

```sql
DELETE FROM public.superadmin WHERE user_id = '<user_superadmin_id>';
```

```javascript
await admin.auth.admin.deleteUser('<user_comum_id>');
await admin.auth.admin.deleteUser('<user_superadmin_id>');
```

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos além do WARN esperado (`actor_e_superadmin` executável por `authenticated`, mesma categoria já aceita das outras funções desta família).

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0049_superadmin.sql
git commit -m "feat(s7): tabela superadmin + actor_e_superadmin()"
```

Não commitar o script de fixture.

---

### Task 2: `custom_access_token_hook` — atualizado (2º claim independente)

**Files:**
- Create: `supabase/migrations/0050_custom_access_token_hook_superadmin.sql`

**Interfaces:**
- Consumes: `public.superadmin` (Task 1).
- Produces: `public.custom_access_token_hook(event jsonb)` atualizado — mesma assinatura/grants do S1, corpo com um bloco `eh_superadmin` novo. Task 5 (`buildLoginSuperadminDeps`) depende do claim `app_metadata.superadmin` aparecer no JWT emitido por este hook.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0050_custom_access_token_hook_superadmin.sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  rec record;
  eh_superadmin boolean;
BEGIN
  claims := event->'claims';

  SELECT campanha_id, papel INTO rec
    FROM public.usuario_campanha WHERE user_id = (event->>'user_id')::uuid;

  SELECT EXISTS (
    SELECT 1 FROM public.superadmin WHERE user_id = (event->>'user_id')::uuid
  ) INTO eh_superadmin;

  IF jsonb_typeof(claims->'app_metadata') IS NULL THEN
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  END IF;

  IF rec.campanha_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata, campanha_id}', to_jsonb(rec.campanha_id::text));
    claims := jsonb_set(claims, '{app_metadata, papel}', to_jsonb(rec.papel::text));
  END IF;

  IF eh_superadmin THEN
    claims := jsonb_set(claims, '{app_metadata, superadmin}', 'true'::jsonb);
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
```

O bloco `campanha_id`/`papel` é idêntico ao já existente desde o S1 — só o
bloco `eh_superadmin` é novo, independente (nenhuma condição cruzada entre
os dois).

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `custom_access_token_hook_superadmin`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture (3 cenários: só campanha, só superadmin, nenhum dos dois — sem precisar de login real, a função aceita um `event` sintético)**

```javascript
// scratchpad: fixture-hook-superadmin.mjs
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: userCampanha } = await admin.auth.admin.createUser({
  email: 's7-fixture-hook-campanha@teste.local', password: 'SenhaForte!S7c', email_confirm: true,
});
const { data: userSuperadmin } = await admin.auth.admin.createUser({
  email: 's7-fixture-hook-superadmin@teste.local', password: 'SenhaForte!S7d', email_confirm: true,
});
const { data: userNenhum } = await admin.auth.admin.createUser({
  email: 's7-fixture-hook-nenhum@teste.local', password: 'SenhaForte!S7e', email_confirm: true,
});
console.log('user_campanha_id=', userCampanha.user.id);
console.log('user_superadmin_id=', userSuperadmin.user.id);
console.log('user_nenhum_id=', userNenhum.user.id);

const { data: camp } = await admin.from('campanha').insert({
  subdominio: 's7-fixture-hook', nome: 'S7 Fixture Hook', cargo: 'prefeito',
  abrangencia: 'municipal', municipio_id: 2211001, data_eleicao: '2028-10-01',
}).select('id').single();
console.log('campanha_id=', camp.id);

await admin.from('usuario_campanha').insert({
  user_id: userCampanha.user.id, campanha_id: camp.id, papel: 'gestor', cpf_hmac: 'fixture-s7-hook',
});
await admin.from('superadmin').insert({ user_id: userSuperadmin.user.id });

console.log('fixture pronta.');
```

- [ ] **Step 4: Verificar chamando o hook diretamente com um `event` sintético via `execute_sql`**

Substitua `<user_campanha_id>`/`<user_superadmin_id>`/`<user_nenhum_id>` pelos valores impressos no Step 3.

```sql
-- Usuário só em usuario_campanha: claims com campanha_id/papel, sem superadmin.
SELECT public.custom_access_token_hook(
  jsonb_build_object('user_id', '<user_campanha_id>', 'claims', '{}'::jsonb)
);
-- esperado: claims.app_metadata tem campanha_id e papel='gestor'; NÃO tem chave "superadmin"

-- Usuário só em superadmin: claims com superadmin=true, sem campanha_id/papel.
SELECT public.custom_access_token_hook(
  jsonb_build_object('user_id', '<user_superadmin_id>', 'claims', '{}'::jsonb)
);
-- esperado: claims.app_metadata = {"superadmin": true}, sem campanha_id nem papel

-- Usuário em nenhuma das duas: claims sem nenhum dos dois blocos (comportamento
-- idêntico ao S1 original pra esse caso).
SELECT public.custom_access_token_hook(
  jsonb_build_object('user_id', '<user_nenhum_id>', 'claims', '{}'::jsonb)
);
-- esperado: claims.app_metadata = {} (vazio)
```

- [ ] **Step 5: Limpar a fixture**

```sql
DELETE FROM public.usuario_campanha WHERE campanha_id = '<campanha_id>';
DELETE FROM public.superadmin WHERE user_id = '<user_superadmin_id>';
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

```javascript
await admin.auth.admin.deleteUser('<user_campanha_id>');
await admin.auth.admin.deleteUser('<user_superadmin_id>');
await admin.auth.admin.deleteUser('<user_nenhum_id>');
```

- [ ] **Step 6: `get_advisors(type=security)`**

Confirmar zero alertas novos (mesma assinatura/grants do hook original do S1 — nenhuma mudança de superfície de segurança).

- [ ] **Step 7: Salvar cópia e commitar**

```bash
git add supabase/migrations/0050_custom_access_token_hook_superadmin.sql
git commit -m "feat(s7): custom_access_token_hook ganha claim superadmin independente"
```

Não commitar o script de fixture.

---

### Task 3: `requireSuperadmin` helper + `GET /api/superadmin/campanhas`

**Files:**
- Create: `web/lib/supabase/require-superadmin.ts`
- Create: `web/lib/supabase/require-superadmin.test.ts`
- Create: `web/app/api/superadmin/campanhas/route.ts`
- Create: `web/app/api/superadmin/campanhas/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`), `adminClient` (`web/lib/supabase/server.ts`), RPC `actor_e_superadmin` (Task 1).
- Produces: `requireSuperadmin(): Promise<NextResponse | null>` — `null` quando liberado, `NextResponse` (401/403/500) quando bloqueado. Task 4 (`POST /api/superadmin/modulos`) e Task 7 (página do dashboard, indiretamente) reusam este helper.

- [ ] **Step 1: Escrever o teste do helper**

```typescript
// web/lib/supabase/require-superadmin.test.ts
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

import { requireSuperadmin } from './require-superadmin';
import { ssrClient } from './ssr';

describe('requireSuperadmin', () => {
  it('retorna null quando é superadmin', async () => {
    const supabase = mockSupabase({ rpcData: true });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith('actor_e_superadmin');
  });

  it('401 sem sessão', async () => {
    const supabase = mockSupabase({ user: null });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it('403 quando não é superadmin', async () => {
    const supabase = mockSupabase({ rpcData: false });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it('500 quando a RPC retorna erro', async () => {
    const supabase = mockSupabase({ rpcError: { message: 'falha' } });
    vi.mocked(ssrClient).mockReturnValue(supabase as never);
    const result = await requireSuperadmin();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(500);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run lib/supabase/require-superadmin.test.ts`
Expected: FAIL — `Cannot find module './require-superadmin'`

- [ ] **Step 3: Implementar o helper**

```typescript
// web/lib/supabase/require-superadmin.ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ssrClient } from './ssr';

type ResultadoChecagem =
  | { status: 'ok' }
  | { status: 'sem-sessao' }
  | { status: 'nao-e-superadmin' }
  | { status: 'erro'; mensagem: string };

async function checarSuperadmin(): Promise<ResultadoChecagem> {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: 'sem-sessao' };

  const { data, error } = await supabase.rpc('actor_e_superadmin');
  if (error) return { status: 'erro', mensagem: error.message };
  return data ? { status: 'ok' } : { status: 'nao-e-superadmin' };
}

export async function requireSuperadmin(): Promise<NextResponse | null> {
  const r = await checarSuperadmin();
  if (r.status === 'ok') return null;
  if (r.status === 'sem-sessao') return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  if (r.status === 'nao-e-superadmin') return NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
  return NextResponse.json({ erro: r.mensagem }, { status: 500 });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run lib/supabase/require-superadmin.test.ts`
Expected: PASS — 4/4

- [ ] **Step 5: Escrever o teste da rota**

```typescript
// web/app/api/superadmin/campanhas/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

const mockCampanhas = [
  { id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a', modulos_habilitados: ['comunicacao'] },
];

function mockAdmin(overrides: Partial<{ data: unknown; error: unknown }> = {}) {
  const { data = mockCampanhas, error = null } = overrides;
  return {
    from: vi.fn(() => ({
      select: vi.fn(async () => ({ data, error })),
    })),
  };
}

vi.mock('../../../../lib/supabase/server', () => ({ adminClient: vi.fn() }));

import { GET } from './route';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';

describe('GET /api/superadmin/campanhas', () => {
  it('retorna 200 com array de campanhas quando liberado', async () => {
    vi.mocked(adminClient).mockReturnValue(mockAdmin() as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(mockCampanhas);
  });

  it('repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('500 quando a leitura falha', async () => {
    vi.mocked(adminClient).mockReturnValue(mockAdmin({ data: null, error: { message: 'falha' } }) as never);
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/superadmin/campanhas/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 7: Implementar a rota**

```typescript
// web/app/api/superadmin/campanhas/route.ts
import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';

export async function GET() {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  const { data, error } = await adminClient()
    .from('campanha')
    .select('id, nome, subdominio, modulos_habilitados');
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/superadmin/campanhas/route.test.ts`
Expected: PASS — 3/3

- [ ] **Step 9: Commit**

```bash
git add web/lib/supabase/require-superadmin.ts web/lib/supabase/require-superadmin.test.ts web/app/api/superadmin/campanhas/route.ts web/app/api/superadmin/campanhas/route.test.ts
git commit -m "feat(s7): requireSuperadmin helper + GET /api/superadmin/campanhas"
```

---

### Task 4: `POST /api/superadmin/modulos`

**Files:**
- Create: `web/app/api/superadmin/modulos/route.ts`
- Create: `web/app/api/superadmin/modulos/route.test.ts`

**Interfaces:**
- Consumes: `requireSuperadmin` (Task 3), `isModulo`/`MODULOS` (`web/lib/modulos.ts`, S6), `toggleModulo`/`buildToggleModuloDeps` (`web/scripts/modulos/toggle-modulo.ts`/`build-toggle-modulo-deps.ts`, S6).
- Produces: `POST /api/superadmin/modulos` — body `{campanhaId, modulo, acao}`, `400` com `modulo`/`acao` inválidos (sem chamar `toggleModulo`), `400` com erro lançado por `toggleModulo` (campanha inexistente ou erro de RPC), `200 {ok: true}` em sucesso. Nenhuma task futura depende desta interface.

- [ ] **Step 1: Escrever o teste**

```typescript
// web/app/api/superadmin/modulos/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

vi.mock('../../../../scripts/modulos/toggle-modulo', () => ({
  toggleModulo: vi.fn(async () => {}),
}));

vi.mock('../../../../scripts/modulos/build-toggle-modulo-deps', () => ({
  buildToggleModuloDeps: vi.fn(() => ({ chamarRpc: vi.fn() })),
}));

function req(body: unknown) {
  return new Request('http://localhost/api/superadmin/modulos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

import { POST } from './route';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { toggleModulo } from '../../../../scripts/modulos/toggle-modulo';

describe('POST /api/superadmin/modulos', () => {
  it('200 quando o toggle é bem-sucedido', async () => {
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(toggleModulo).toHaveBeenCalledWith('habilitar', 'c-1', 'comunicacao', expect.anything());
  });

  it('repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(403);
  });

  it('400 com campanhaId/modulo/acao ausentes', async () => {
    const res = await POST(req({ modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(400);
    expect(toggleModulo).not.toHaveBeenCalled();
  });

  it('400 com modulo inválido, sem chamar toggleModulo', async () => {
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'nao-existe', acao: 'habilitar' }));
    expect(res.status).toBe(400);
    expect(toggleModulo).not.toHaveBeenCalled();
  });

  it('400 com acao inválida, sem chamar toggleModulo', async () => {
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'apagar' }));
    expect(res.status).toBe(400);
    expect(toggleModulo).not.toHaveBeenCalled();
  });

  it('400 quando toggleModulo lança erro (ex.: campanha inexistente)', async () => {
    vi.mocked(toggleModulo).mockRejectedValueOnce(new Error('campanha c-1 não encontrada'));
    const res = await POST(req({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'habilitar' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: 'campanha c-1 não encontrada' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/superadmin/modulos/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/superadmin/modulos/route.ts
import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { isModulo } from '../../../../lib/modulos';
import { toggleModulo } from '../../../../scripts/modulos/toggle-modulo';
import { buildToggleModuloDeps } from '../../../../scripts/modulos/build-toggle-modulo-deps';

const ACOES = ['habilitar', 'desabilitar'] as const;
type Acao = (typeof ACOES)[number];
function isAcao(value: string): value is Acao {
  return (ACOES as readonly string[]).includes(value);
}

export async function POST(req: Request) {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  let body: { campanhaId?: string; modulo?: string; acao?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const { campanhaId, modulo, acao } = body;
  if (!campanhaId || !modulo || !acao) {
    return NextResponse.json({ erro: 'campanhaId, modulo e acao são obrigatórios' }, { status: 400 });
  }
  if (!isModulo(modulo)) {
    return NextResponse.json({ erro: `módulo inválido: "${modulo}"` }, { status: 400 });
  }
  if (!isAcao(acao)) {
    return NextResponse.json({ erro: `ação inválida: "${acao}"` }, { status: 400 });
  }

  try {
    await toggleModulo(acao, campanhaId, modulo, buildToggleModuloDeps());
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'erro desconhecido';
    return NextResponse.json({ erro: mensagem }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/superadmin/modulos/route.test.ts`
Expected: PASS — 6/6

- [ ] **Step 5: Commit**

```bash
git add web/app/api/superadmin/modulos/route.ts web/app/api/superadmin/modulos/route.test.ts
git commit -m "feat(s7): POST /api/superadmin/modulos — reusa toggleModulo do S6"
```

---

### Task 5: `loginSuperadmin` + `POST /api/superadmin/login`

**Files:**
- Create: `web/lib/auth/login-superadmin.ts`
- Create: `web/lib/auth/login-superadmin.test.ts`
- Create: `web/lib/auth/build-login-superadmin-deps.ts`
- Create: `web/app/api/superadmin/login/route.ts`
- Create: `web/app/api/superadmin/login/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`).
- Produces: `loginSuperadmin(input: {email, senha}, deps: LoginSuperadminDeps): Promise<{ok: boolean}>` — orquestrador puro. `buildLoginSuperadminDeps(): Promise<LoginSuperadminDeps>` — wiring real. `POST /api/superadmin/login` — `401 {erro}` genérico (credenciais erradas OU não-superadmin, mesma mensagem), `200 {ok: true}`. Task 6 (página de login) consome esta rota via `fetch`.

- [ ] **Step 1: Escrever o teste do orquestrador**

```typescript
// web/lib/auth/login-superadmin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loginSuperadmin, type LoginSuperadminDeps } from './login-superadmin';

function deps(over: Partial<LoginSuperadminDeps> = {}): LoginSuperadminDeps {
  return {
    signIn: vi.fn(async () => true),
    signOut: vi.fn(async () => {}),
    ...over,
  };
}

describe('loginSuperadmin', () => {
  it('sucesso quando signIn confirma superadmin', async () => {
    const d = deps();
    const r = await loginSuperadmin({ email: 'a@a.com', senha: 's' }, d);
    expect(r.ok).toBe(true);
    expect(d.signOut).not.toHaveBeenCalled();
  });

  it('falha e desloga quando signIn retorna false (credenciais erradas OU não-superadmin)', async () => {
    const d = deps({ signIn: vi.fn(async () => false) });
    const r = await loginSuperadmin({ email: 'a@a.com', senha: 'errada' }, d);
    expect(r.ok).toBe(false);
    expect(d.signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run lib/auth/login-superadmin.test.ts`
Expected: FAIL — `Cannot find module './login-superadmin'`

- [ ] **Step 3: Implementar o orquestrador**

```typescript
// web/lib/auth/login-superadmin.ts
export interface LoginSuperadminDeps {
  signIn(email: string, senha: string): Promise<boolean>;
  signOut(): Promise<void>;
}

export interface LoginSuperadminInput {
  email: string;
  senha: string;
}

export async function loginSuperadmin(
  input: LoginSuperadminInput,
  deps: LoginSuperadminDeps,
): Promise<{ ok: boolean }> {
  const ehSuperadmin = await deps.signIn(input.email, input.senha);
  if (!ehSuperadmin) {
    await deps.signOut();
    return { ok: false };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run lib/auth/login-superadmin.test.ts`
Expected: PASS — 2/2

- [ ] **Step 5: Implementar `buildLoginSuperadminDeps` (wiring real, sem teste próprio — mesmo padrão de `build-login-deps.ts`, S1)**

```typescript
// web/lib/auth/build-login-superadmin-deps.ts
import { cookies } from 'next/headers';
import { ssrClient } from '../supabase/ssr';
import type { LoginSuperadminDeps } from './login-superadmin';

export async function buildLoginSuperadminDeps(): Promise<LoginSuperadminDeps> {
  const ssr = ssrClient(await cookies());

  return {
    signIn: async (email, senha) => {
      const { data, error } = await ssr.auth.signInWithPassword({ email, password: senha });
      if (error || !data.user) return false;
      // Mesma lição do bug corrigido no S1: claims custom só existem no JWT
      // emitido pelo hook, nunca em user.app_metadata bruto.
      const { data: claimsData, error: claimsError } = await ssr.auth.getClaims();
      if (claimsError || !claimsData) return false;
      const meta = claimsData.claims.app_metadata as { superadmin?: boolean };
      return meta.superadmin === true;
    },
    signOut: async () => { await ssr.auth.signOut(); },
  };
}
```

- [ ] **Step 6: Escrever o teste da rota**

```typescript
// web/app/api/superadmin/login/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/auth/build-login-superadmin-deps', () => ({
  buildLoginSuperadminDeps: vi.fn(async () => ({
    signIn: async () => true,
    signOut: async () => {},
  })),
}));

import { POST } from './route';
import { buildLoginSuperadminDeps } from '../../../../lib/auth/build-login-superadmin-deps';

function req(body: unknown) {
  return new Request('http://localhost/api/superadmin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ERRO_GENERICO = { erro: 'e-mail ou senha inválidos' };

describe('POST /api/superadmin/login', () => {
  it('200 ok em login válido', async () => {
    const res = await POST(req({ email: 'admin@x.com', senha: 's' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('401 com corpo genérico quando email ou senha ausentes', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });

  it('401 com corpo genérico em JSON inválido', async () => {
    const badReq = new Request('http://localhost/api/superadmin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(badReq);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });

  it('401 com corpo genérico quando loginSuperadmin retorna ok:false', async () => {
    vi.mocked(buildLoginSuperadminDeps).mockResolvedValueOnce({
      signIn: async () => false,
      signOut: async () => {},
    });
    const res = await POST(req({ email: 'admin@x.com', senha: 'errada' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ERRO_GENERICO);
  });
});
```

- [ ] **Step 7: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/superadmin/login/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 8: Implementar a rota**

```typescript
// web/app/api/superadmin/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loginSuperadmin } from '../../../../lib/auth/login-superadmin';
import { buildLoginSuperadminDeps } from '../../../../lib/auth/build-login-superadmin-deps';

const ERRO_GENERICO = 'e-mail ou senha inválidos';

export async function POST(req: NextRequest) {
  let body: { email?: string; senha?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }
  if (!body.email || !body.senha) {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }

  const deps = await buildLoginSuperadminDeps();
  const { ok } = await loginSuperadmin({ email: body.email, senha: body.senha }, deps);

  if (!ok) return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 9: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/superadmin/login/route.test.ts`
Expected: PASS — 4/4

- [ ] **Step 10: Commit**

```bash
git add web/lib/auth/login-superadmin.ts web/lib/auth/login-superadmin.test.ts web/lib/auth/build-login-superadmin-deps.ts web/app/api/superadmin/login/route.ts web/app/api/superadmin/login/route.test.ts
git commit -m "feat(s7): loginSuperadmin + POST /api/superadmin/login"
```

---

### Task 6: Página `/superadmin/login`

**Files:**
- Create: `web/app/superadmin/login/page.tsx`
- Create: `web/app/superadmin/login/page.test.tsx`

**Interfaces:**
- Consumes: `POST /api/superadmin/login` (Task 5) via `fetch`.
- Produces: página client-side com form email+senha. Nenhuma task futura consome isso diretamente (é uma folha da árvore de dependências).

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/superadmin/login/page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperadminLoginPage from './page';

describe('/superadmin/login page', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
  });

  it('envia email e senha pro endpoint de login', async () => {
    render(<SuperadminLoginPage />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'admin@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'admin@x.com', senha: 'segredo' }),
      });
    });
  });

  it('mostra mensagem de erro quando o login falha', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ erro: 'e-mail ou senha inválidos' }),
    })) as never;
    render(<SuperadminLoginPage />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'admin@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('e-mail ou senha inválidos');
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/superadmin/login/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 3: Implementar a página**

```tsx
// web/app/superadmin/login/page.tsx
'use client';
import { useState } from 'react';

export default function SuperadminLoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const res = await fetch('/api/superadmin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (!res.ok) {
      const body = await res.json();
      setErro(body.erro ?? 'Não foi possível entrar.');
      return;
    }
    window.location.href = '/superadmin/dashboard';
  }

  return (
    <form onSubmit={entrar}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha" />
      <button type="submit">Entrar</button>
      {erro && <p role="alert">{erro}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/superadmin/login/page.test.tsx`
Expected: PASS — 2/2 (o redirect via `window.location.href` não é asserido no teste — `jsdom` não navega de verdade; o teste 1 já confirma que o `fetch` foi chamado com o corpo certo, o que é suficiente pra cobrir a lógica desta task)

- [ ] **Step 5: Commit**

```bash
git add web/app/superadmin/login/page.tsx web/app/superadmin/login/page.test.tsx
git commit -m "feat(s7): página /superadmin/login"
```

---

### Task 7: `POST /api/superadmin/logout` + página `/superadmin/dashboard`

**Files:**
- Create: `web/app/api/superadmin/logout/route.ts`
- Create: `web/app/api/superadmin/logout/route.test.ts`
- Create: `web/app/superadmin/dashboard/page.tsx`
- Create: `web/app/superadmin/dashboard/page.test.tsx`
- Create: `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx`
- Create: `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`); `GET /api/superadmin/campanhas` (Task 3) e `POST /api/superadmin/modulos` (Task 4) via `fetch`; `MODULOS`/`Modulo` (`web/lib/modulos.ts`, S6); `POST /api/superadmin/logout` (esta task).
- Produces: página `/superadmin/dashboard` (sem redirect quando não autenticado/não-superadmin, mesmo padrão de `/mapa-calor`/`/dashboard`) renderizando `DashboardSuperadminClient` (lista + toggle + botão Sair). Nenhuma task futura consome isso.

- [ ] **Step 1: Escrever o teste da rota de logout**

```typescript
// web/app/api/superadmin/logout/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({ auth: { signOut } })),
}));

import { POST } from './route';

describe('POST /api/superadmin/logout', () => {
  it('200 e chama signOut, mesmo sem sessão ativa', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/superadmin/logout/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota de logout (sem `requireSuperadmin` — sair deve funcionar mesmo sem o registro de superadmin)**

```typescript
// web/app/api/superadmin/logout/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';

export async function POST() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/superadmin/logout/route.test.ts`
Expected: PASS — 1/1

- [ ] **Step 5: Escrever o teste da página do dashboard**

```tsx
// web/app/superadmin/dashboard/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('./DashboardSuperadminClient', () => ({
  DashboardSuperadminClient: () => 'dashboard-superadmin-client-mock',
}));

import { ssrClient } from '../../../lib/supabase/ssr';
import Page from './page';

describe('/superadmin/dashboard page', () => {
  it('mostra mensagem quando não autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('não autenticado');
    expect(html).not.toContain('dashboard-superadmin-client-mock');
  });

  it('mostra mensagem quando autenticado mas não é superadmin', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
      rpc: async () => ({ data: false, error: null }),
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('acesso restrito ao superadmin');
    expect(html).not.toContain('dashboard-superadmin-client-mock');
  });

  it('renderiza o dashboard quando é superadmin', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
      rpc: async () => ({ data: true, error: null }),
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('dashboard-superadmin-client-mock');
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/superadmin/dashboard/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 7: Implementar a página + stub do client (o stub é substituído no Step 11 pelo componente real, na mesma task — diferente do padrão S5 de stub cross-task, aqui cabe tudo numa task só porque o client não tem consumidor externo além desta página)**

```tsx
// web/app/superadmin/dashboard/page.tsx
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';
import { DashboardSuperadminClient } from './DashboardSuperadminClient';

export default async function SuperadminDashboardPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <p>não autenticado</p>;
  }

  const { data: ehSuperadmin } = await supabase.rpc('actor_e_superadmin');
  if (!ehSuperadmin) {
    return <p>acesso restrito ao superadmin</p>;
  }

  return <DashboardSuperadminClient />;
}
```

```tsx
// web/app/superadmin/dashboard/DashboardSuperadminClient.tsx (placeholder mínimo — Step 11 substitui o corpo)
'use client';
export function DashboardSuperadminClient() {
  return <div>dashboard superadmin em construção</div>;
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/superadmin/dashboard/page.test.tsx`
Expected: PASS — 3/3

- [ ] **Step 9: Commit intermediário**

```bash
git add web/app/api/superadmin/logout/route.ts web/app/api/superadmin/logout/route.test.ts web/app/superadmin/dashboard/page.tsx web/app/superadmin/dashboard/page.test.tsx web/app/superadmin/dashboard/DashboardSuperadminClient.tsx
git commit -m "feat(s7): POST /api/superadmin/logout + página /superadmin/dashboard (stub do client)"
```

- [ ] **Step 10: Escrever o teste do `DashboardSuperadminClient` real**

```tsx
// web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DashboardSuperadminClient } from './DashboardSuperadminClient';

const mockCampanhas = [
  { id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a', modulos_habilitados: ['comunicacao'] },
];

describe('DashboardSuperadminClient', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/modulos') {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      if (url === '/api/superadmin/logout') {
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;
  });

  it('busca /api/superadmin/campanhas e lista a campanha com o módulo já marcado', async () => {
    render(<DashboardSuperadminClient />);
    expect(await screen.findByText(/Campanha A/)).toBeInTheDocument();
    const checkboxComunicacao = screen.getByRole('checkbox', { name: 'comunicacao' });
    expect(checkboxComunicacao).toBeChecked();
    const checkboxIa = screen.getByRole('checkbox', { name: 'ia' });
    expect(checkboxIa).not.toBeChecked();
  });

  it('marcar o checkbox chama POST /api/superadmin/modulos com acao=habilitar', async () => {
    render(<DashboardSuperadminClient />);
    const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
    fireEvent.click(checkboxIa);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/modulos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: 'c-1', modulo: 'ia', acao: 'habilitar' }),
      });
    });
    await waitFor(() => expect(checkboxIa).toBeChecked());
  });

  it('desmarcar o checkbox chama POST /api/superadmin/modulos com acao=desabilitar', async () => {
    render(<DashboardSuperadminClient />);
    const checkboxComunicacao = await screen.findByRole('checkbox', { name: 'comunicacao' });
    fireEvent.click(checkboxComunicacao);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/modulos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: 'c-1', modulo: 'comunicacao', acao: 'desabilitar' }),
      });
    });
    await waitFor(() => expect(checkboxComunicacao).not.toBeChecked());
  });

  it('clicar em Sair chama POST /api/superadmin/logout', async () => {
    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);
    fireEvent.click(screen.getByText('Sair'));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/logout', { method: 'POST' });
    });
  });

  it('mostra erro quando a busca de campanhas falha', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    render(<DashboardSuperadminClient />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });
});
```

- [ ] **Step 11: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
Expected: FAIL — o stub atual não busca dado nenhum, não tem tabela/checkbox/botão

- [ ] **Step 12: Implementar o componente real**

```tsx
// web/app/superadmin/dashboard/DashboardSuperadminClient.tsx
'use client';
import { useEffect, useState } from 'react';
import { MODULOS, type Modulo } from '../../../lib/modulos';

type Campanha = {
  id: string;
  nome: string;
  subdominio: string;
  modulos_habilitados: string[];
};

export function DashboardSuperadminClient() {
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch('/api/superadmin/campanhas')
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar campanhas');
        return res.json();
      })
      .then((data: Campanha[]) => {
        if (!cancelado) setCampanhas(data);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar as campanhas.');
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function alternar(campanha: Campanha, modulo: Modulo, habilitado: boolean) {
    const chave = `${campanha.id}:${modulo}`;
    setCarregando(chave);
    const acao = habilitado ? 'desabilitar' : 'habilitar';
    const res = await fetch('/api/superadmin/modulos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campanhaId: campanha.id, modulo, acao }),
    });
    if (res.ok) {
      setCampanhas((atual) =>
        (atual ?? []).map((c) =>
          c.id === campanha.id
            ? {
                ...c,
                modulos_habilitados: habilitado
                  ? c.modulos_habilitados.filter((m) => m !== modulo)
                  : [...c.modulos_habilitados, modulo],
              }
            : c,
        ),
      );
    }
    setCarregando(null);
  }

  async function sair() {
    await fetch('/api/superadmin/logout', { method: 'POST' });
    window.location.href = '/superadmin/login';
  }

  if (erro) return <p role="alert">{erro}</p>;
  if (!campanhas) return null;

  return (
    <div>
      <button onClick={sair}>Sair</button>
      <table>
        <thead>
          <tr>
            <th>Campanha</th>
            {MODULOS.map((m) => (
              <th key={m}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {campanhas.map((c) => (
            <tr key={c.id}>
              <td>
                {c.nome} ({c.subdominio})
              </td>
              {MODULOS.map((m) => {
                const habilitado = c.modulos_habilitados.includes(m);
                const chave = `${c.id}:${m}`;
                return (
                  <td key={m}>
                    <input
                      type="checkbox"
                      aria-label={m}
                      checked={habilitado}
                      disabled={carregando === chave}
                      onChange={() => alternar(c, m, habilitado)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 13: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
Expected: PASS — 5/5

- [ ] **Step 14: Rodar a suíte de `/superadmin` inteira**

Run: `cd web && npx vitest run app/superadmin app/api/superadmin`
Expected: todos os arquivos passam.

- [ ] **Step 15: Commit**

```bash
git add web/app/superadmin/dashboard/DashboardSuperadminClient.tsx web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx
git commit -m "feat(s7): DashboardSuperadminClient — lista + toggle pessimista + logout"
```

---

### Task 8: Script CLI `superadmin:criar`

**Files:**
- Create: `web/scripts/superadmin/criar-superadmin.ts`
- Create: `web/scripts/superadmin/criar-superadmin.test.ts`
- Create: `web/scripts/superadmin/build-criar-superadmin-deps.ts`
- Create: `web/scripts/superadmin/cli/criar.ts`
- Modify: `web/package.json` (1 novo script npm)

**Interfaces:**
- Consumes: `adminClient` (`web/lib/supabase/server.ts`).
- Produces: `criarSuperadmin(email: string, senha: string, deps: CriarSuperadminDeps): Promise<void>` — orquestrador puro, testável sem rede, com compensação (reverte o `auth.users` criado se a inserção em `superadmin` falhar). `buildCriarSuperadminDeps(): CriarSuperadminDeps` — wiring real. Nenhuma task futura consome isso.

- [ ] **Step 1: Escrever o teste do orquestrador**

```typescript
// web/scripts/superadmin/criar-superadmin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { criarSuperadmin, type CriarSuperadminDeps } from './criar-superadmin';

function makeDeps(overrides: Partial<CriarSuperadminDeps> = {}): CriarSuperadminDeps {
  return {
    criarAuthUser: vi.fn(async () => 'user-1'),
    inserirSuperadmin: vi.fn(async () => {}),
    removerAuthUser: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('criarSuperadmin', () => {
  it('cria o auth user e insere em superadmin, nessa ordem', async () => {
    const deps = makeDeps();
    await criarSuperadmin('a@a.com', 'senha123', deps);
    expect(deps.criarAuthUser).toHaveBeenCalledWith('a@a.com', 'senha123');
    expect(deps.inserirSuperadmin).toHaveBeenCalledWith('user-1');
    expect(deps.removerAuthUser).not.toHaveBeenCalled();
  });

  it('reverte o auth user se a inserção em superadmin falhar', async () => {
    const deps = makeDeps({
      inserirSuperadmin: vi.fn(async () => {
        throw new Error('user_id duplicado');
      }),
    });
    await expect(criarSuperadmin('a@a.com', 'senha123', deps)).rejects.toThrow('user_id duplicado');
    expect(deps.removerAuthUser).toHaveBeenCalledWith('user-1');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run scripts/superadmin/criar-superadmin.test.ts`
Expected: FAIL — `Cannot find module './criar-superadmin'`

- [ ] **Step 3: Implementar o orquestrador**

```typescript
// web/scripts/superadmin/criar-superadmin.ts
export type CriarSuperadminDeps = {
  criarAuthUser(email: string, senha: string): Promise<string>; // retorna user_id
  inserirSuperadmin(userId: string): Promise<void>;
  removerAuthUser(userId: string): Promise<void>;
};

export async function criarSuperadmin(
  email: string,
  senha: string,
  deps: CriarSuperadminDeps,
): Promise<void> {
  const userId = await deps.criarAuthUser(email, senha);
  try {
    await deps.inserirSuperadmin(userId);
  } catch (err) {
    await deps.removerAuthUser(userId);
    throw err;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run scripts/superadmin/criar-superadmin.test.ts`
Expected: PASS — 2/2

- [ ] **Step 5: Implementar `buildCriarSuperadminDeps` (wiring real, sem teste próprio — mesmo padrão de `build-toggle-modulo-deps.ts`, S6)**

```typescript
// web/scripts/superadmin/build-criar-superadmin-deps.ts
import { adminClient } from '../../lib/supabase/server';
import type { CriarSuperadminDeps } from './criar-superadmin';

export function buildCriarSuperadminDeps(): CriarSuperadminDeps {
  const admin = adminClient();
  return {
    async criarAuthUser(email, senha) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: senha, email_confirm: true,
      });
      if (error || !data.user) throw new Error(error?.message ?? 'falha ao criar usuário');
      return data.user.id;
    },
    async inserirSuperadmin(userId) {
      const { error } = await admin.from('superadmin').insert({ user_id: userId });
      if (error) throw new Error(error.message);
    },
    async removerAuthUser(userId) {
      await admin.auth.admin.deleteUser(userId);
    },
  };
}
```

- [ ] **Step 6: Implementar o entrypoint CLI**

```typescript
// web/scripts/superadmin/cli/criar.ts
import { parseArgs } from 'node:util';
import { criarSuperadmin } from '../criar-superadmin';
import { buildCriarSuperadminDeps } from '../build-criar-superadmin-deps';

const { values } = parseArgs({
  options: { email: { type: 'string' }, senha: { type: 'string' } },
});
if (!values.email || !values.senha) {
  console.error('uso: superadmin:criar --email <email> --senha <senha>');
  process.exit(1);
}

criarSuperadmin(values.email, values.senha, buildCriarSuperadminDeps())
  .then(() => console.log(`superadmin criado: ${values.email}`))
  .catch((err) => {
    console.error('erro ao criar superadmin:', err);
    process.exit(1);
  });
```

- [ ] **Step 7: Adicionar o script npm**

Editar `web/package.json`, dentro de `"scripts"` (mesmo bloco de `modulos:*`/`tre:*`):

```json
"superadmin:criar": "tsx scripts/superadmin/cli/criar.ts"
```

- [ ] **Step 8: Verificar o script real de ponta a ponta contra o banco (não é `.test.ts` — execução real do CLI compilado)**

```bash
cd web && npx tsx --env-file=.env.local scripts/superadmin/cli/criar.ts --email s7-cli-verify@teste.local --senha 'SenhaForte!S7cli'
```

Expected: imprime `superadmin criado: s7-cli-verify@teste.local`, sem erro.

Confirmar via `execute_sql`:

```sql
SELECT u.email, s.user_id
  FROM auth.users u JOIN public.superadmin s ON s.user_id = u.id
 WHERE u.email = 's7-cli-verify@teste.local';
-- esperado: 1 linha
```

Rodar de novo com o MESMO e-mail (deve falhar na criação do `auth.users`, não na inserção em `superadmin` — mas serve pra confirmar que o script não deixa nada pela metade):

```bash
cd web && npx tsx --env-file=.env.local scripts/superadmin/cli/criar.ts --email s7-cli-verify@teste.local --senha 'SenhaForte!S7cli'
```

Expected: imprime `erro ao criar superadmin:` com mensagem de e-mail duplicado, `process.exit(1)`.

Limpar a fixture:

```javascript
// via Admin SDK, script/console
const { data } = await admin.from('superadmin').select('user_id').eq(
  'user_id',
  (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === 's7-cli-verify@teste.local').id,
);
await admin.auth.admin.deleteUser(data[0].user_id); // cascade apaga a linha de superadmin também (FK)
```

- [ ] **Step 9: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes de S0-S6.

- [ ] **Step 10: Rodar `npx tsc --noEmit`, confirmar zero erros novos**

- [ ] **Step 11: Commit**

```bash
git add web/scripts/superadmin/criar-superadmin.ts web/scripts/superadmin/criar-superadmin.test.ts web/scripts/superadmin/build-criar-superadmin-deps.ts web/scripts/superadmin/cli/criar.ts web/package.json
git commit -m "feat(s7): script superadmin:criar (CLI fino, com compensação em caso de erro)"
```

---

### Task 9: Verificação manual em browser — banco como autoridade final

**Files:** nenhum arquivo de código — task de verificação, sem implementação nova.

**Interfaces:** nenhuma nova. Consome tudo das Tasks 1-8.

- [ ] **Step 1: Criar fixture: 1 superadmin real (via CLI) + 1 campanha real (via `execute_sql`)**

```bash
cd web && npx tsx --env-file=.env.local scripts/superadmin/cli/criar.ts --email s7-browser-verify@teste.local --senha 'SenhaForte!S7browser'
```

```sql
INSERT INTO public.campanha (subdominio, nome, cargo, abrangencia, municipio_id, data_eleicao)
VALUES ('s7-fixture-browser', 'S7 Fixture Browser', 'prefeito', 'municipal', 2211001, '2028-10-01')
RETURNING id;
```

- [ ] **Step 2: Rodar o servidor de desenvolvimento**

```bash
cd web && npm run dev
```

- [ ] **Step 3: Verificação visual completa via Playwright**

Acessar `/superadmin/login` (domínio raiz, sem subdomínio) e confirmar:
- Logar com o superadmin criado no Step 1 → redireciona pra `/superadmin/dashboard`.
- Dashboard lista a campanha do Step 1, com os 2 checkboxes (`comunicacao`, `ia`) desmarcados.
- Marcar o checkbox `comunicacao` → fica desabilitado brevemente (estado "carregando" do toggle pessimista), depois marcado. Confirmar via `execute_sql` que `modulos_habilitados` da campanha agora contém `["comunicacao"]`.
- Desmarcar o mesmo checkbox → volta a desmarcado; `execute_sql` confirma `modulos_habilitados = []`.
- Clicar em "Sair" → redireciona pra `/superadmin/login`.
- Zero erros de console durante toda a sequência.

- [ ] **Step 4: Prova de que o banco é a autoridade final, não o JWT (teste 10 do spec)**

Logar de novo como o mesmo superadmin (nova sessão, novo JWT com `superadmin=true`). **Sem fazer logout nem gerar novo token**, rodar via `execute_sql`:

```sql
DELETE FROM public.superadmin WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 's7-browser-verify@teste.local'
);
```

Sem recarregar a página (a sessão/cookie do browser continua a mesma), navegar de novo pro dashboard (ou dar refresh) — confirmar que a página agora mostra "acesso restrito ao superadmin" (a checagem `actor_e_superadmin()` roda de novo no servidor a cada request, lê o banco, não o JWT antigo). Se preferir verificar via API direto: `curl` ou o próprio browser em `/api/superadmin/campanhas` com o cookie de sessão ainda válido deve retornar `403`, não `200`.

- [ ] **Step 5: Limpar a fixture**

```sql
DELETE FROM public.campanha WHERE subdominio = 's7-fixture-browser';
```

```javascript
// via Admin SDK — a linha em superadmin já foi removida no Step 4
const { data } = await admin.auth.admin.listUsers();
const u = data.users.find((x) => x.email === 's7-browser-verify@teste.local');
if (u) await admin.auth.admin.deleteUser(u.id);
```

- [ ] **Step 6: Documentar o resultado**

Anotar no relatório da task: o que foi visto (screenshot ou descrição), confirmação explícita do teste "banco é autoridade final" (Step 4), qualquer problema visual encontrado (mesmo que não bloqueie — registrar como débito, não corrigir silenciosamente fora do plano).

---

## Self-Review

**1. Cobertura do spec:** decisão 1 (tabela `superadmin`) → Task 1; decisão 2 (hook atualizado) → Task 2; decisão 3 (`actor_e_superadmin`, `SECURITY DEFINER` necessário, banco como autoridade final) → Task 1 (função) + Task 3 (`requireSuperadmin` sempre consulta o banco) + Task 9 Step 4 (prova em browser); decisão 4 (rota `/superadmin/*` sem subdomínio, sem middleware) → Tasks 5-7 (nenhuma task toca `web/middleware.ts`); decisão 5 (login email+senha, `getClaims()`) → Task 5; decisão 6 (dashboard reusa `toggleModulo` do S6) → Task 4; decisão 7 (`requireSuperadmin`) → Task 3; decisão 8 (CLI de criação com compensação) → Task 8. Testes do spec (13 itens) → cobertos 1:1 pelas Tasks 1 (testes 1-3), 2 (teste 4), 1 Step 6 (teste 5), 5 (teste 6), 3 (teste 7), 4 (teste 8), 7 (teste 9), 9 (testes 10-11), 8 (testes 12-13). Não-objetivos: nenhuma task cria CRUD de campanha, middleware central, 2FA/captcha, UI de criar/remover superadmin, auditoria de ações do superadmin, ou trava ativa contra dupla identidade — confirmado por omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda task tem SQL/TS completo.

**3. Consistência de tipos:** `Modulo`/`MODULOS`/`isModulo` (S6, reusados sem modificação) usados identicamente em Task 4 e Task 7 — nenhuma redeclaração de união solta. `CriarSuperadminDeps` (Task 8) e `ToggleModuloDeps`/ `LoginSuperadminDeps` (Tasks 4/5) seguem o mesmo formato de objeto de dependências injetáveis já estabelecido em `web/scripts/tre/`/`web/scripts/modulos/`/`web/lib/auth/login.ts`. `ResultadoChecagem` (Task 3, `checarSuperadmin`) é uma união discriminada com os mesmos 4 estados (`ok`/`sem-sessao`/`nao-e-superadmin` [renomeado de `sem-modulo` do S6 pro contexto certo]/`erro`) do padrão `checarModulo` do S6 — nomes adaptados ao domínio, formato idêntico.

**Gap encontrado e corrigido durante o self-review:** a spec não especificava explicitamente se `DashboardSuperadminClient` deveria nascer como stub numa task e ser preenchido noutra (padrão do S5) ou tudo numa task só. Como esse componente não tem nenhum outro consumidor além da própria página `/superadmin/dashboard` (ao contrário dos widgets do S5, que dividiam `DashboardClient` entre 3 tasks paralelas), decidido manter tudo na Task 7 — o stub existe só entre os Steps 7 e 12 da mesma task (não entre tasks diferentes), evitando o overhead de uma task extra sem necessidade real de paralelização.

---

Plano completo e salvo em `docs/superpowers/plans/2026-07-05-s7-painel-superadmin.md`.
