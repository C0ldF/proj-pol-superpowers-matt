# S1 — Auth & papéis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar login (CPF→e-mail ou e-mail) e sessão aos usuários de campanha sobre o Supabase Auth, com um Custom Access Token Hook que preenche `app_metadata.campanha_id`/`papel`, fazendo o RLS do S0 operar fim-a-fim.

**Architecture:** Camada de dados em migrations Postgres (enum + tabela de membership + 3 funções: hook, resolver de e-mail, auditoria de auth) aplicadas no projeto Supabase cloud via MCP. Camada server no app Next do S0: utils puros (CPF, HMAC), clientes Supabase (service-role e SSR com cookies), orquestração de login testável por injeção de dependências, route handlers finos, e reforço de subdomínio no middleware. Segredos (`CPF_HMAC_KEY`, service-role) só no server, fora do banco.

**Tech Stack:** Postgres 17 (Supabase cloud, projeto `axcftjqdjvknrpqzrxls`), Supabase Auth + Custom Access Token Hook, Next.js 16.2.9 (App Router, route handlers, middleware), `@supabase/supabase-js`, `@supabase/ssr` (novo), `node:crypto`, Vitest.

## Global Constraints

- **Next.js 16.2.9** — APIs diferem do conhecido; **antes de escrever qualquer código web, ler o guia relevante em `web/node_modules/next/dist/docs/`** (regra de `web/AGENTS.md`).
- **Migrations:** uma por passo, nomeada, aplicada via `mcp__supabase__apply_migration`; **cópia versionada em `supabase/migrations/`** (próximos números: `0006`+). Verificação via `mcp__supabase__execute_sql`.
- **Projeto cloud:** `axcftjqdjvknrpqzrxls` (org `hzucdcptinqcgepwvpih`), região `sa-east-1`.
- **Deny-safe:** sem dados o hook não adiciona claim; RLS devolve vazio, nunca erro.
- **Erro de login sempre genérico:** `"CPF/e-mail ou senha inválidos"` — sem oráculo de enumeração.
- **CPF nunca em claro:** só `cpf_hmac` (hex de HMAC-SHA256). `CPF_HMAC_KEY` em env do server, fora do banco e do cliente.
- **Contrato de claim congelado no S0:** `app_metadata.campanha_id` (uuid como string), `app_metadata.papel` (texto). Não alterar nomes.
- **Testes web:** Vitest (`npm test` em `web/`, = `vitest run`), arquivos `*.test.ts` colocados ao lado do código (padrão do S0, ex. `web/lib/subdomain.test.ts`).
- **Commits frequentes**, um por task concluída.

---

### Task 1: Schema — enum `papel_login` + tabela `usuario_campanha`

**Files:**
- Create: `supabase/migrations/0006_papel_login_usuario_campanha.sql` (cópia versionada)
- Apply: migration `0006_papel_login_usuario_campanha` no projeto cloud via MCP

**Interfaces:**
- Produces: enum `papel_login` (`gestor|coordenador|lideranca|colaborador`); tabela `public.usuario_campanha(user_id uuid pk, campanha_id uuid, papel papel_login, cpf_hmac text, criado_em timestamptz)`; grants p/ `supabase_auth_admin` (select via policy) e `service_role` (select+insert).

- [ ] **Step 1: Escrever o teste de schema (deve falhar)**

Rodar via `mcp__supabase__execute_sql`:

```sql
select to_regclass('public.usuario_campanha') is not null as tabela_existe,
       exists (select 1 from pg_type where typname = 'papel_login') as enum_existe;
```

- [ ] **Step 2: Verificar que falha/retorna falso**

Esperado: `tabela_existe = false`, `enum_existe = false` (ainda não criados).

- [ ] **Step 3: Escrever a migration**

Conteúdo de `supabase/migrations/0006_papel_login_usuario_campanha.sql`:

```sql
-- S1 Task 1: enum de papel-base e tabela de membership (fonte do claim do hook).
create type public.papel_login as enum ('gestor', 'coordenador', 'lideranca', 'colaborador');

create table public.usuario_campanha (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  campanha_id uuid not null references public.campanha (id),
  papel       public.papel_login not null,
  cpf_hmac    text not null,
  criado_em   timestamptz not null default now(),
  unique (campanha_id, cpf_hmac)
);

alter table public.usuario_campanha enable row level security;

-- Ninguém do app (anon/authenticated) acessa diretamente; fonte só p/ o hook e seed.
revoke all on table public.usuario_campanha from authenticated, anon, public;

-- O Custom Access Token Hook roda como supabase_auth_admin e precisa ler.
grant select on table public.usuario_campanha to supabase_auth_admin;
create policy "auth_admin_le_usuario_campanha" on public.usuario_campanha
  as permissive for select to supabase_auth_admin using (true);

-- service_role (seed/provisão server-side) escreve e lê. service_role ignora RLS,
-- mas ainda precisa de GRANT de tabela.
grant select, insert, update, delete on table public.usuario_campanha to service_role;
```

Aplicar com `mcp__supabase__apply_migration` (name: `0006_papel_login_usuario_campanha`, query: conteúdo acima) e salvar cópia idêntica no arquivo.

- [ ] **Step 4: Verificar que o teste passa**

Reexecutar o SQL do Step 1. Esperado: `tabela_existe = true`, `enum_existe = true`.
Conferir também o isolamento da tabela:

```sql
select has_table_privilege('authenticated', 'public.usuario_campanha', 'SELECT') as auth_le;
```
Esperado: `auth_le = false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_papel_login_usuario_campanha.sql
git commit -m "feat(s1): enum papel_login e tabela usuario_campanha com RLS"
```

---

### Task 2: Custom Access Token Hook (função Postgres)

**Files:**
- Create: `supabase/migrations/0007_custom_access_token_hook.sql`
- Apply: migration `0007_custom_access_token_hook`

**Interfaces:**
- Consumes: `public.usuario_campanha` (Task 1).
- Produces: `public.custom_access_token_hook(event jsonb) returns jsonb` — adiciona `claims.app_metadata.campanha_id` e `claims.app_metadata.papel` quando há linha; executável só por `supabase_auth_admin`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

Via `execute_sql`, chamar o hook com um evento sintético (sem precisar de login real):

```sql
select public.custom_access_token_hook(
  jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000',
                     'claims', jsonb_build_object('app_metadata', '{}'::jsonb))
);
```

- [ ] **Step 2: Verificar que falha**

Esperado: erro `function public.custom_access_token_hook(jsonb) does not exist`.

- [ ] **Step 3: Escrever a migration**

Conteúdo de `supabase/migrations/0007_custom_access_token_hook.sql`:

```sql
-- S1 Task 2: Custom Access Token Hook. Preenche app_metadata.campanha_id/papel
-- a partir de usuario_campanha. Deny-safe: sem linha, não adiciona claim.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  claims jsonb;
  rec record;
begin
  claims := event->'claims';

  select campanha_id, papel into rec
    from public.usuario_campanha
   where user_id = (event->>'user_id')::uuid;

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

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
```

Aplicar via `mcp__supabase__apply_migration` e salvar cópia.

- [ ] **Step 4: Verificar que passa**

Reexecutar o SQL do Step 1. Esperado: retorna o `event` com `claims.app_metadata` presente (objeto vazio, pois o user_id fictício não tem linha — comprova o caminho deny-safe sem erro).

Verificar restrição de execução:
```sql
select has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE') as auth_exec;
```
Esperado: `auth_exec = false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_custom_access_token_hook.sql
git commit -m "feat(s1): custom access token hook preenche app_metadata"
```

---

### Task 3: Resolver de e-mail por CPF (função `SECURITY DEFINER`)

**Files:**
- Create: `supabase/migrations/0008_auth_login_email.sql`
- Apply: migration `0008_auth_login_email`

**Interfaces:**
- Consumes: `usuario_campanha` (Task 1), `campanha` e `auth.users` (S0).
- Produces: `public.auth_login_email(p_subdominio text, p_cpf_hmac text) returns text` — devolve o e-mail do usuário cujo `cpf_hmac` casa na campanha do subdomínio, ou `null`. Executável só por `service_role`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
select public.auth_login_email('campanha-a', 'deadbeef');
```

- [ ] **Step 2: Verificar que falha**

Esperado: erro `function public.auth_login_email(text, text) does not exist`.

- [ ] **Step 3: Escrever a migration**

Conteúdo de `supabase/migrations/0008_auth_login_email.sql`:

```sql
-- S1 Task 3: resolve e-mail (auth.users) a partir de (subdomínio, cpf_hmac).
-- SECURITY DEFINER: lê auth.users e usuario_campanha. Só service_role executa,
-- para nunca virar oráculo de enumeração pelo app.
create or replace function public.auth_login_email(p_subdominio text, p_cpf_hmac text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
    from public.usuario_campanha uc
    join public.campanha c on c.id = uc.campanha_id
    join auth.users u on u.id = uc.user_id
   where c.subdominio = p_subdominio
     and uc.cpf_hmac = p_cpf_hmac
   limit 1;
$$;

revoke execute on function public.auth_login_email(text, text) from authenticated, anon, public;
grant execute on function public.auth_login_email(text, text) to service_role;
```

Aplicar via MCP e salvar cópia.

- [ ] **Step 4: Verificar que passa**

Reexecutar o SQL do Step 1. Esperado: retorna `null` (sem linha casando), sem erro.
Verificar restrição:
```sql
select has_function_privilege('authenticated', 'public.auth_login_email(text, text)', 'EXECUTE') as auth_exec;
```
Esperado: `auth_exec = false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_auth_login_email.sql
git commit -m "feat(s1): resolver auth_login_email (subdominio+cpf_hmac -> email)"
```

---

### Task 4: Auditoria de auth (função `SECURITY DEFINER`)

**Files:**
- Create: `supabase/migrations/0009_registrar_evento_auth.sql`
- Apply: migration `0009_registrar_evento_auth`

**Interfaces:**
- Consumes: `audit_log` (S0).
- Produces: `public.registrar_evento_auth(p_campanha_id uuid, p_actor_id uuid, p_acao text, p_meta jsonb) returns void` — insere em `audit_log`; IP e demais metadados vão em `depois`. Executável por `service_role`.

- [ ] **Step 1: Escrever o teste (deve falhar)**

```sql
select public.registrar_evento_auth(null, null, 'login.falha', '{"ip":"1.2.3.4"}'::jsonb);
```

- [ ] **Step 2: Verificar que falha**

Esperado: erro `function public.registrar_evento_auth(...) does not exist`.

- [ ] **Step 3: Escrever a migration**

Conteúdo de `supabase/migrations/0009_registrar_evento_auth.sql`:

```sql
-- S1 Task 4: insere evento de auth no audit_log imutável do S0.
-- audit_log não tem coluna de IP; IP e metadados vão no jsonb 'depois'.
create or replace function public.registrar_evento_auth(
  p_campanha_id uuid,
  p_actor_id uuid,
  p_acao text,
  p_meta jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (campanha_id, actor_id, acao, entidade, depois)
  values (p_campanha_id, p_actor_id, p_acao, 'auth', p_meta);
$$;

revoke execute on function public.registrar_evento_auth(uuid, uuid, text, jsonb) from authenticated, anon, public;
grant execute on function public.registrar_evento_auth(uuid, uuid, text, jsonb) to service_role;
```

> Nota: `audit_log.campanha_id` é `not null` no S0. Para `login.falha` sem campanha conhecida, o chamador passa a `campanha_id` resolvida do subdomínio (sempre conhecida no fluxo de login, pois o middleware já validou o subdomínio). Nunca passar `null` em produção; o teste abaixo usa uma campanha real.

- [ ] **Step 4: Verificar que passa**

Aplicada a migration, inserir com uma campanha real e conferir:

```sql
with c as (select id from public.campanha where subdominio = 'campanha-a' limit 1)
select public.registrar_evento_auth((select id from c), null, 'login.falha', '{"ip":"1.2.3.4"}'::jsonb);

select acao, entidade, depois->>'ip' as ip
  from public.audit_log
 where acao = 'login.falha'
 order by criado_em desc limit 1;
```
Esperado: linha com `acao=login.falha`, `entidade=auth`, `ip=1.2.3.4`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_registrar_evento_auth.sql
git commit -m "feat(s1): registrar_evento_auth grava login.sucesso/falha no audit_log"
```

---

### Task 5: Validação de CPF (util puro)

**Files:**
- Create: `web/lib/cpf.ts`
- Test: `web/lib/cpf.test.ts`

**Interfaces:**
- Produces: `normalizarCpf(raw: string): string` (só dígitos); `cpfValido(cpf: string): boolean` (11 dígitos + dígitos verificadores; rejeita repetidos).

- [ ] **Step 1: Escrever o teste (deve falhar)**

`web/lib/cpf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizarCpf, cpfValido } from './cpf';

describe('normalizarCpf', () => {
  it('remove pontuação e espaços', () => {
    expect(normalizarCpf('529.982.247-25')).toBe('52998224725');
  });
});

describe('cpfValido', () => {
  it('aceita um CPF com dígitos verificadores corretos', () => {
    expect(cpfValido('52998224725')).toBe(true);
  });
  it('rejeita dígitos verificadores errados', () => {
    expect(cpfValido('52998224724')).toBe(false);
  });
  it('rejeita todos os dígitos iguais', () => {
    expect(cpfValido('11111111111')).toBe(false);
  });
  it('rejeita comprimento != 11', () => {
    expect(cpfValido('123')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npm test -- cpf`
Esperado: FAIL (`cpf.ts` não existe / funções indefinidas).

- [ ] **Step 3: Implementar**

`web/lib/cpf.ts`:

```ts
export function normalizarCpf(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

export function cpfValido(cpf: string): boolean {
  const d = normalizarCpf(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // todos iguais

  const calc = (fatorInicial: number, ate: number): number => {
    let soma = 0;
    let fator = fatorInicial;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * fator--;
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calc(10, 9) === Number(d[9]) && calc(11, 10) === Number(d[10]);
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd web && npm test -- cpf`
Esperado: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add web/lib/cpf.ts web/lib/cpf.test.ts
git commit -m "feat(s1): util de normalização e validação de CPF"
```

---

### Task 6: HMAC do CPF (índice cego, util server-side)

**Files:**
- Create: `web/lib/cpf-hmac.ts`
- Test: `web/lib/cpf-hmac.test.ts`

**Interfaces:**
- Consumes: `normalizarCpf` (Task 5).
- Produces: `cpfHmac(cpfNormalizado: string, key?: string): string` — hex lowercase do HMAC-SHA256; `key` cai em `process.env.CPF_HMAC_KEY` quando omitido e lança se ausente.

- [ ] **Step 1: Escrever o teste (deve falhar)**

`web/lib/cpf-hmac.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { cpfHmac } from './cpf-hmac';

const KEY = 'chave-de-teste';
const esperado = createHmac('sha256', KEY).update('52998224725').digest('hex');

describe('cpfHmac', () => {
  it('produz o hex do HMAC-SHA256 com a chave dada', () => {
    expect(cpfHmac('52998224725', KEY)).toBe(esperado);
  });
  it('é determinístico', () => {
    expect(cpfHmac('52998224725', KEY)).toBe(cpfHmac('52998224725', KEY));
  });
  it('difere para CPFs diferentes', () => {
    expect(cpfHmac('52998224725', KEY)).not.toBe(cpfHmac('11144477735', KEY));
  });
  it('lança se nenhuma chave está disponível', () => {
    const old = process.env.CPF_HMAC_KEY;
    delete process.env.CPF_HMAC_KEY;
    expect(() => cpfHmac('52998224725')).toThrow();
    if (old !== undefined) process.env.CPF_HMAC_KEY = old;
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npm test -- cpf-hmac`
Esperado: FAIL (`cpf-hmac.ts` não existe).

- [ ] **Step 3: Implementar**

`web/lib/cpf-hmac.ts`:

```ts
import { createHmac } from 'node:crypto';
import { normalizarCpf } from './cpf';

// Índice cego do CPF (ADR 0010). A chave vive em env do server, fora do banco.
export function cpfHmac(cpfNormalizado: string, key?: string): string {
  const chave = key ?? process.env.CPF_HMAC_KEY;
  if (!chave) throw new Error('CPF_HMAC_KEY ausente no ambiente do servidor');
  return createHmac('sha256', chave).update(normalizarCpf(cpfNormalizado)).digest('hex');
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd web && npm test -- cpf-hmac`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/cpf-hmac.ts web/lib/cpf-hmac.test.ts
git commit -m "feat(s1): HMAC do CPF como índice cego server-side"
```

---

### Task 7: Clientes Supabase server-side (service-role + SSR) e env

**Files:**
- Modify: `web/lib/supabase/server.ts` (adicionar `adminClient`)
- Create: `web/lib/supabase/ssr.ts`
- Modify: `web/.env.example` (documentar `SUPABASE_SECRET_KEY`, `CPF_HMAC_KEY`)
- Modify: `web/package.json` (dependência `@supabase/ssr`)

**Interfaces:**
- Consumes: env `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Produces: `adminClient(): SupabaseClient` (service-role, sem sessão); `ssrClient(cookieStore): SupabaseClient` (anon + cookies, para login/sessão).

- [ ] **Step 1: Ler o doc do Next antes de tocar código web**

Ler `web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/` (procurar `cookies`) e o guia de route handlers já citado, para a API de `cookies()` no Next 16.

- [ ] **Step 2: Instalar `@supabase/ssr`**

Run: `cd web && npm install @supabase/ssr`
Esperado: `@supabase/ssr` aparece em `dependencies` no `package.json`.

- [ ] **Step 3: Escrever o teste (deve falhar)**

`web/lib/supabase/server.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { adminClient } from './server';

describe('adminClient', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://exemplo.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'service-role-fake';
  });
  it('constrói um cliente com as funções do Supabase', () => {
    const c = adminClient();
    expect(typeof c.rpc).toBe('function');
    expect(typeof c.from).toBe('function');
  });
  it('lança se SUPABASE_SECRET_KEY está ausente', () => {
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => adminClient()).toThrow();
  });
});
```

- [ ] **Step 4: Rodar e verificar que falha**

Run: `cd web && npm test -- server`
Esperado: FAIL (`adminClient` não exportado).

- [ ] **Step 5: Implementar `adminClient` em `web/lib/supabase/server.ts`**

Acrescentar ao arquivo existente (manter `publicClient`):

```ts
// Cliente service-role para uso server-side (rotas/seed). Ignora RLS; nunca expor ao cliente.
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY ausente');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
```

- [ ] **Step 6: Criar `web/lib/supabase/ssr.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

// Cliente anon que persiste a sessão em cookies (login, leitura do usuário logado).
export function ssrClient(cookieStore: ReadonlyRequestCookies) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        },
      },
    },
  );
}
```

- [ ] **Step 7: Documentar env em `web/.env.example`**

Acrescentar:

```bash
# Service-role (Superadmin/seed/rotas server-side). NUNCA expor ao cliente.
SUPABASE_SECRET_KEY=
# Chave do índice cego de CPF (HMAC). Fora do banco; rotacioná-la exige recomputar cpf_hmac.
CPF_HMAC_KEY=
```

- [ ] **Step 8: Rodar e verificar que passa**

Run: `cd web && npm test -- server`
Esperado: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/lib/supabase/server.ts web/lib/supabase/ssr.ts web/lib/supabase/server.test.ts web/.env.example web/package.json web/package-lock.json
git commit -m "feat(s1): clientes admin e ssr do Supabase + env de segredos"
```

---

### Task 8: Orquestração de login (lógica pura por injeção de dependências)

**Files:**
- Create: `web/lib/auth/login.ts`
- Test: `web/lib/auth/login.test.ts`

**Interfaces:**
- Consumes: `normalizarCpf`, `cpfValido` (Task 5).
- Produces:
  - `interface LoginDeps { cpfHmac(cpf: string): string; resolverEmailPorCpf(sub: string, hmac: string): Promise<string | null>; campanhaIdPorSubdominio(sub: string): Promise<string | null>; signIn(email: string, senha: string): Promise<string | null>; signOut(): Promise<void>; registrarEvento(acao: string, campanhaId: string | null, meta: Record<string, unknown>): Promise<void>; }`
  - `loginCampanha(input: { identificador: string; senha: string; subdominio: string; ip?: string }, deps: LoginDeps): Promise<{ ok: boolean }>`
  - `signIn` devolve o `app_metadata.campanha_id` do token em caso de sucesso, ou `null` em falha de autenticação.

- [ ] **Step 1: Escrever o teste (deve falhar)**

`web/lib/auth/login.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { loginCampanha, type LoginDeps } from './login';

const CAMP = 'aaaaaaaa-0000-0000-0000-000000000001';

function deps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    cpfHmac: () => 'hmac-x',
    resolverEmailPorCpf: vi.fn(async () => 'gestor@a.com'),
    campanhaIdPorSubdominio: vi.fn(async () => CAMP),
    signIn: vi.fn(async () => CAMP),
    signOut: vi.fn(async () => {}),
    registrarEvento: vi.fn(async () => {}),
    ...over,
  };
}

describe('loginCampanha', () => {
  it('loga por CPF válido e audita sucesso', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.registrarEvento).toHaveBeenCalledWith('login.sucesso', CAMP, expect.anything());
  });

  it('loga por e-mail direto (sem resolver CPF)', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.resolverEmailPorCpf).not.toHaveBeenCalled();
  });

  it('rejeita CPF inválido com falha genérica e audita', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '12345678900', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.anything());
  });

  it('rejeita senha errada (signIn null)', async () => {
    const d = deps({ signIn: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 'x', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.anything());
  });

  it('rejeita CPF não encontrado (resolver null) sem chamar signIn', async () => {
    const d = deps({ resolverEmailPorCpf: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it('rejeita e desloga quando o token é de outra campanha', async () => {
    const d = deps({ signIn: vi.fn(async () => 'outra-campanha-id') });
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signOut).toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'subdominio' }));
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npm test -- auth/login`
Esperado: FAIL (`login.ts` não existe).

- [ ] **Step 3: Implementar**

`web/lib/auth/login.ts`:

```ts
import { normalizarCpf, cpfValido } from '../cpf';

export interface LoginDeps {
  cpfHmac(cpf: string): string;
  resolverEmailPorCpf(subdominio: string, hmac: string): Promise<string | null>;
  campanhaIdPorSubdominio(subdominio: string): Promise<string | null>;
  signIn(email: string, senha: string): Promise<string | null>; // -> app_metadata.campanha_id ou null
  signOut(): Promise<void>;
  registrarEvento(acao: string, campanhaId: string | null, meta: Record<string, unknown>): Promise<void>;
}

export interface LoginInput {
  identificador: string;
  senha: string;
  subdominio: string;
  ip?: string;
}

const ehEmail = (s: string) => s.includes('@');

export async function loginCampanha(input: LoginInput, deps: LoginDeps): Promise<{ ok: boolean }> {
  const { identificador, senha, subdominio, ip } = input;
  const campanhaId = await deps.campanhaIdPorSubdominio(subdominio);
  if (!campanhaId) return { ok: false }; // middleware já deveria ter barrado

  const falha = async (motivo: string) => {
    await deps.registrarEvento('login.falha', campanhaId, { ip, motivo });
    return { ok: false as const };
  };

  // Resolve o e-mail (caminho CPF vs e-mail direto).
  let email: string | null;
  if (ehEmail(identificador)) {
    email = identificador.trim().toLowerCase();
  } else {
    const cpf = normalizarCpf(identificador);
    if (!cpfValido(cpf)) return falha('cpf_invalido');
    email = await deps.resolverEmailPorCpf(subdominio, deps.cpfHmac(cpf));
    if (!email) return falha('cpf_nao_encontrado');
  }

  const tokenCampanhaId = await deps.signIn(email, senha);
  if (!tokenCampanhaId) return falha('credenciais');

  if (tokenCampanhaId !== campanhaId) {
    await deps.signOut();
    return falha('subdominio');
  }

  await deps.registrarEvento('login.sucesso', campanhaId, { ip });
  return { ok: true };
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd web && npm test -- auth/login`
Esperado: PASS (6 casos).

- [ ] **Step 5: Commit**

```bash
git add web/lib/auth/login.ts web/lib/auth/login.test.ts
git commit -m "feat(s1): orquestração de login (CPF/email, erro genérico, trava de subdomínio)"
```

---

### Task 9: Route handler de login (fiação das dependências)

**Files:**
- Create: `web/app/api/auth/login/route.ts`
- Test: `web/app/api/auth/login/route.test.ts`

**Interfaces:**
- Consumes: `loginCampanha`/`LoginDeps` (Task 8); `adminClient` (Task 7); `ssrClient` (Task 7); `cpfHmac` (Task 6).
- Produces: `POST /api/auth/login` — corpo `{ identificador, senha }`; subdomínio do header `x-campanha-subdominio` (posto pelo middleware do S0). Sucesso → `200 { ok: true }` + cookies de sessão; falha → `401 { erro: "CPF/e-mail ou senha inválidos" }`.

- [ ] **Step 1: Ler o doc do Next**

Reler `15-route-handlers.md` e o doc de `cookies()` (`web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/`) para confirmar a API no Next 16.

- [ ] **Step 2: Escrever o teste (deve falhar)**

`web/app/api/auth/login/route.test.ts` — testa a fiação montando as `LoginDeps` reais com stubs dos clientes, validando o mapeamento de resposta:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/auth/build-login-deps', () => ({
  buildLoginDeps: async () => ({
    cpfHmac: () => 'h',
    resolverEmailPorCpf: async () => 'gestor@a.com',
    campanhaIdPorSubdominio: async () => 'camp-1',
    signIn: async () => 'camp-1',
    signOut: async () => {},
    registrarEvento: async () => {},
  }),
}));

import { POST } from './route';

function req(body: unknown, sub = 'campanha-a') {
  return new Request('http://campanha-a.localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-campanha-subdominio': sub },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login', () => {
  it('200 ok em login válido', async () => {
    const res = await POST(req({ identificador: 'gestor@a.com', senha: 's' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('400 quando falta o header de subdomínio', async () => {
    const res = await POST(req({ identificador: 'x', senha: 's' }, ''));
    expect(res.status).toBe(400);
  });
});
```

> A fiação real das `LoginDeps` mora numa fábrica isolada `web/lib/auth/build-login-deps.ts` (criada no Step 4) — é o módulo que o teste mocka acima e que o route handler importa.

- [ ] **Step 3: Rodar e verificar que falha**

Run: `cd web && npm test -- api/auth/login`
Esperado: FAIL (`route.ts` / fábrica não existem).

- [ ] **Step 4: Criar a fábrica de dependências `web/lib/auth/build-login-deps.ts`**

```ts
import { cookies } from 'next/headers';
import { adminClient } from '../supabase/server';
import { ssrClient } from '../supabase/ssr';
import { cpfHmac } from '../cpf-hmac';
import type { LoginDeps } from './login';

export async function buildLoginDeps(): Promise<LoginDeps> {
  const admin = adminClient();
  const ssr = ssrClient(await cookies());

  return {
    cpfHmac: (cpf) => cpfHmac(cpf),
    resolverEmailPorCpf: async (subdominio, hmac) => {
      const { data } = await admin.rpc('auth_login_email', { p_subdominio: subdominio, p_cpf_hmac: hmac });
      return (data as string | null) ?? null;
    },
    campanhaIdPorSubdominio: async (subdominio) => {
      const { data } = await admin.from('campanha').select('id').eq('subdominio', subdominio).maybeSingle();
      return data?.id ?? null;
    },
    signIn: async (email, senha) => {
      const { data, error } = await ssr.auth.signInWithPassword({ email, password: senha });
      if (error || !data.user) return null;
      const meta = data.user.app_metadata as { campanha_id?: string };
      return meta.campanha_id ?? null;
    },
    signOut: async () => { await ssr.auth.signOut(); },
    registrarEvento: async (acao, campanhaId, meta) => {
      await admin.rpc('registrar_evento_auth', {
        p_campanha_id: campanhaId, p_actor_id: null, p_acao: acao, p_meta: meta,
      });
    },
  };
}
```

- [ ] **Step 5: Implementar o route handler `web/app/api/auth/login/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { loginCampanha } from '../../../../lib/auth/login';
import { buildLoginDeps } from '../../../../lib/auth/build-login-deps';

const ERRO_GENERICO = 'CPF/e-mail ou senha inválidos';

export async function POST(req: NextRequest) {
  const subdominio = req.headers.get('x-campanha-subdominio') ?? '';
  if (!subdominio) return NextResponse.json({ erro: 'Campanha não identificada' }, { status: 400 });

  let body: { identificador?: string; senha?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }
  if (!body.identificador || !body.senha) {
    return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const deps = await buildLoginDeps();
  const { ok } = await loginCampanha(
    { identificador: body.identificador, senha: body.senha, subdominio, ip }, deps,
  );

  if (!ok) return NextResponse.json({ erro: ERRO_GENERICO }, { status: 401 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Rodar e verificar que passa**

Run: `cd web && npm test -- api/auth/login`
Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/app/api/auth/login/route.ts web/app/api/auth/login/route.test.ts web/lib/auth/build-login-deps.ts
git commit -m "feat(s1): route handler POST /api/auth/login com erro genérico"
```

---

### Task 10: Recuperação de senha (route handler + página de nova senha)

**Files:**
- Create: `web/lib/auth/recuperacao.ts`
- Test: `web/lib/auth/recuperacao.test.ts`
- Create: `web/app/api/auth/recuperar/route.ts`
- Create: `web/app/redefinir-senha/page.tsx`

**Interfaces:**
- Consumes: `normalizarCpf`/`cpfValido` (Task 5); `adminClient`, `ssrClient` (Task 7); `auth_login_email` (Task 3).
- Produces:
  - `resolverEmailParaRecuperacao(input: { identificador: string; subdominio: string }, deps: RecuperacaoDeps): Promise<string | null>` — mesma lógica CPF/e-mail, sem vazar existência.
  - `POST /api/auth/recuperar` — sempre `200 { ok: true }` (resposta genérica); dispara `resetPasswordForEmail` quando há e-mail.
  - Página `/redefinir-senha` — formulário que chama `updateUser({ password })` na sessão de recovery.

- [ ] **Step 1: Escrever o teste da resolução (deve falhar)**

`web/lib/auth/recuperacao.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolverEmailParaRecuperacao, type RecuperacaoDeps } from './recuperacao';

function deps(over: Partial<RecuperacaoDeps> = {}): RecuperacaoDeps {
  return {
    cpfHmac: () => 'h',
    resolverEmailPorCpf: vi.fn(async () => 'gestor@a.com'),
    ...over,
  };
}

describe('resolverEmailParaRecuperacao', () => {
  it('resolve por e-mail direto', async () => {
    const e = await resolverEmailParaRecuperacao({ identificador: 'gestor@a.com', subdominio: 'campanha-a' }, deps());
    expect(e).toBe('gestor@a.com');
  });
  it('resolve por CPF válido', async () => {
    const e = await resolverEmailParaRecuperacao({ identificador: '529.982.247-25', subdominio: 'campanha-a' }, deps());
    expect(e).toBe('gestor@a.com');
  });
  it('devolve null para CPF inválido (sem vazar)', async () => {
    const e = await resolverEmailParaRecuperacao({ identificador: '11111111111', subdominio: 'campanha-a' }, deps());
    expect(e).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npm test -- auth/recuperacao`
Esperado: FAIL.

- [ ] **Step 3: Implementar `web/lib/auth/recuperacao.ts`**

```ts
import { normalizarCpf, cpfValido } from '../cpf';

export interface RecuperacaoDeps {
  cpfHmac(cpf: string): string;
  resolverEmailPorCpf(subdominio: string, hmac: string): Promise<string | null>;
}

export async function resolverEmailParaRecuperacao(
  input: { identificador: string; subdominio: string },
  deps: RecuperacaoDeps,
): Promise<string | null> {
  const { identificador, subdominio } = input;
  if (identificador.includes('@')) return identificador.trim().toLowerCase();
  const cpf = normalizarCpf(identificador);
  if (!cpfValido(cpf)) return null;
  return deps.resolverEmailPorCpf(subdominio, deps.cpfHmac(cpf));
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd web && npm test -- auth/recuperacao`
Esperado: PASS.

- [ ] **Step 5: Implementar o route handler `web/app/api/auth/recuperar/route.ts`**

```ts
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '../../../../lib/supabase/server';
import { ssrClient } from '../../../../lib/supabase/ssr';
import { cpfHmac } from '../../../../lib/cpf-hmac';
import { resolverEmailParaRecuperacao } from '../../../../lib/auth/recuperacao';

const REDIRECT = '/redefinir-senha';

export async function POST(req: NextRequest) {
  const subdominio = req.headers.get('x-campanha-subdominio') ?? '';
  const generico = NextResponse.json({ ok: true }); // resposta sempre genérica
  if (!subdominio) return generico;

  let body: { identificador?: string };
  try { body = await req.json(); } catch { return generico; }
  if (!body.identificador) return generico;

  const admin = adminClient();
  const email = await resolverEmailParaRecuperacao(
    { identificador: body.identificador, subdominio },
    {
      cpfHmac: (cpf) => cpfHmac(cpf),
      resolverEmailPorCpf: async (sub, hmac) => {
        const { data } = await admin.rpc('auth_login_email', { p_subdominio: sub, p_cpf_hmac: hmac });
        return (data as string | null) ?? null;
      },
    },
  );

  if (email) {
    const ssr = ssrClient(await cookies());
    const origin = req.headers.get('origin') ?? '';
    await ssr.auth.resetPasswordForEmail(email, { redirectTo: `${origin}${REDIRECT}` });
  }
  return generico;
}
```

- [ ] **Step 6: Implementar a página `web/app/redefinir-senha/page.tsx`**

Página client que, na sessão de recovery (já estabelecida pelo link do e-mail), envia a nova senha:

```tsx
'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function RedefinirSenha() {
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState('');

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.updateUser({ password: senha });
    setMsg(error ? 'Não foi possível redefinir.' : 'Senha redefinida.');
  }

  return (
    <form onSubmit={salvar}>
      <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Nova senha" />
      <button type="submit">Salvar</button>
      {msg && <p>{msg}</p>}
    </form>
  );
}
```

- [ ] **Step 7: Rodar a suíte e o build**

Run: `cd web && npm test && npm run build`
Esperado: testes PASS; build sem erros de tipo.

- [ ] **Step 8: Commit**

```bash
git add web/lib/auth/recuperacao.ts web/lib/auth/recuperacao.test.ts web/app/api/auth/recuperar/route.ts web/app/redefinir-senha/page.tsx
git commit -m "feat(s1): recuperação de senha com resposta genérica + página de redefinição"
```

---

### Task 11: Reforço de subdomínio na sessão (middleware)

**Files:**
- Create: `web/lib/auth/sessao-subdominio.ts`
- Test: `web/lib/auth/sessao-subdominio.test.ts`
- Modify: `web/middleware.ts`

**Interfaces:**
- Consumes: subdomínio resolvido (middleware do S0).
- Produces: `sessaoConflitaSubdominio(args: { tokenCampanhaId: string | null; campanhaIdResolvida: string | null }): boolean` — `true` quando há sessão com campanha divergente da do subdomínio.

- [ ] **Step 1: Escrever o teste (deve falhar)**

`web/lib/auth/sessao-subdominio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sessaoConflitaSubdominio } from './sessao-subdominio';

describe('sessaoConflitaSubdominio', () => {
  it('não conflita quando batem', () => {
    expect(sessaoConflitaSubdominio({ tokenCampanhaId: 'a', campanhaIdResolvida: 'a' })).toBe(false);
  });
  it('conflita quando a sessão é de outra campanha', () => {
    expect(sessaoConflitaSubdominio({ tokenCampanhaId: 'a', campanhaIdResolvida: 'b' })).toBe(true);
  });
  it('não conflita quando não há sessão (token null)', () => {
    expect(sessaoConflitaSubdominio({ tokenCampanhaId: null, campanhaIdResolvida: 'b' })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `cd web && npm test -- sessao-subdominio`
Esperado: FAIL.

- [ ] **Step 3: Implementar `web/lib/auth/sessao-subdominio.ts`**

```ts
// Login preso ao subdomínio (ADR 0008): sessão de uma campanha não vale no
// subdomínio de outra. Sem sessão (token null) não há conflito.
export function sessaoConflitaSubdominio(args: {
  tokenCampanhaId: string | null;
  campanhaIdResolvida: string | null;
}): boolean {
  const { tokenCampanhaId, campanhaIdResolvida } = args;
  if (!tokenCampanhaId) return false;
  return tokenCampanhaId !== campanhaIdResolvida;
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `cd web && npm test -- sessao-subdominio`
Esperado: PASS.

- [ ] **Step 5: Ler o doc e ligar no middleware**

Reler como o middleware do S0 injeta `x-campanha-subdominio`. Em `web/middleware.ts`, após resolver a campanha do subdomínio, ler o usuário logado via `ssrClient` e, se `sessaoConflitaSubdominio(...)`, encerrar a sessão e responder bloqueio. Substituir o trecho final (após obter `data` da `campanha_publica`):

```ts
  // ... data válido e status 'ativa' já garantidos acima ...

  // Reforço de sessão: a sessão precisa pertencer à campanha deste subdomínio.
  const { ssrClient } = await import('./lib/supabase/ssr');
  const { adminClient } = await import('./lib/supabase/server');
  const supabaseSsr = ssrClient(req.cookies as unknown as Parameters<typeof ssrClient>[0]);
  const { data: userData } = await supabaseSsr.auth.getUser();
  const tokenCampanhaId =
    (userData.user?.app_metadata as { campanha_id?: string } | undefined)?.campanha_id ?? null;

  if (tokenCampanhaId) {
    const { sessaoConflitaSubdominio } = await import('./lib/auth/sessao-subdominio');
    const { data: camp } = await adminClient()
      .from('campanha').select('id').eq('subdominio', subdominio).maybeSingle();
    if (sessaoConflitaSubdominio({ tokenCampanhaId, campanhaIdResolvida: camp?.id ?? null })) {
      await supabaseSsr.auth.signOut();
      return new NextResponse('Sessão inválida para esta campanha', { status: 403 });
    }
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete('x-campanha-subdominio');
  requestHeaders.set('x-campanha-subdominio', subdominio);
  return NextResponse.next({ request: { headers: requestHeaders } });
```

> Atenção ao runtime do middleware no Next 16: o `adminClient` (service-role) só pode rodar se o middleware estiver em runtime Node. Conferir no doc de middleware (`web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`) e, se necessário, declarar `export const config = { ...matcher..., runtime: 'nodejs' }`. Se o runtime Node não estiver disponível, mover a checagem de conflito para um layout/route server-side em vez do middleware (a trava forte de login já está no Task 8; aqui é defesa adicional).

- [ ] **Step 6: Rodar a suíte e o build**

Run: `cd web && npm test && npm run build`
Esperado: testes PASS; build sem erros.

- [ ] **Step 7: Commit**

```bash
git add web/lib/auth/sessao-subdominio.ts web/lib/auth/sessao-subdominio.test.ts web/middleware.ts
git commit -m "feat(s1): reforço de subdomínio na sessão do middleware"
```

---

### Task 12: Habilitar o hook, seed e teste fim-a-fim + advisors

**Files:**
- Create: `supabase/seed/s1_seed_usuarios.mjs` (script Node, service-role + Admin API)
- Create: `docs/superpowers/specs/s1-README.md` (ou seção no README do projeto)

**Interfaces:**
- Consumes: tudo das Tasks 1–4; clientes/env do Task 7.
- Produces: usuários de teste (1 Gestor por campanha) com `cpf_hmac` e senha; verificação de que o JWT real carrega as claims e o RLS isola fim-a-fim.

- [ ] **Step 1: Habilitar o Custom Access Token Hook no projeto**

No Dashboard do Supabase: Authentication → Hooks → **Customize Access Token (JWT) Claims** → selecionar `public.custom_access_token_hook`. (Alternativa por Management API: `PATCH /v1/projects/{ref}/config/auth` com `hook_custom_access_token_enabled=true` e `hook_custom_access_token_uri=pg-functions://postgres/public/custom_access_token_hook`.) Não há tool MCP para esse passo — registrar no README qual via foi usada.

- [ ] **Step 2: Escrever o script de seed**

`supabase/seed/s1_seed_usuarios.mjs` (rodar com `node`, lê `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CPF_HMAC_KEY`):

```js
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const hmac = (cpf) => createHmac('sha256', process.env.CPF_HMAC_KEY).update(cpf).digest('hex');

// CPFs de teste válidos (dígitos verificadores corretos).
const usuarios = [
  { sub: 'campanha-a', email: 'gestor.a@teste.local', senha: 'SenhaForte!A1', cpf: '52998224725', papel: 'gestor' },
  { sub: 'campanha-b', email: 'gestor.b@teste.local', senha: 'SenhaForte!B1', cpf: '11144477735', papel: 'gestor' },
];

for (const u of usuarios) {
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email: u.email, password: u.senha, email_confirm: true,
  });
  if (e1 && !String(e1.message).includes('already')) throw e1;
  const userId = created?.user?.id
    ?? (await admin.auth.admin.listUsers()).data.users.find((x) => x.email === u.email)?.id;

  const { data: camp } = await admin.from('campanha').select('id').eq('subdominio', u.sub).maybeSingle();
  const { error: e2 } = await admin.from('usuario_campanha').upsert({
    user_id: userId, campanha_id: camp.id, papel: u.papel, cpf_hmac: hmac(u.cpf),
  });
  if (e2) throw e2;
  console.log(`seed ok: ${u.email} -> ${u.sub} (${u.papel})`);
}
```

- [ ] **Step 3: Rodar o seed**

Run: `cd /d/projeto-pol-superpowers && node supabase/seed/s1_seed_usuarios.mjs`
Esperado: `seed ok` para cada usuário, sem erro.

- [ ] **Step 4: Verificar claims no JWT real**

Via `mcp__supabase__execute_sql`, confirmar que a função do hook produz as claims para o usuário semeado:

```sql
select (public.custom_access_token_hook(
  jsonb_build_object(
    'user_id', (select user_id from public.usuario_campanha uc
                join public.campanha c on c.id = uc.campanha_id
               where c.subdominio = 'campanha-a' limit 1),
    'claims', jsonb_build_object('app_metadata', '{}'::jsonb))
) -> 'claims' -> 'app_metadata') as app_metadata;
```
Esperado: `app_metadata` com `campanha_id` (uuid da campanha A) e `papel = "gestor"`.

- [ ] **Step 5: Teste de isolamento RLS com claim real**

Simular a sessão da campanha A e tentar ler a campanha B (reusa o padrão do S0):

```sql
-- Pega os dois ids
select id, subdominio from public.campanha where subdominio in ('campanha-a','campanha-b');
```
Depois, com `set local request.jwt.claims` montado com o `app_metadata.campanha_id` de A (obtido no Step 4), repetir o teste de isolamento do S0 contra uma tabela operacional com `campanha_id` — confirmar 0 linhas de B. (Enquanto não há tabela operacional além de `campanha`/`audit_log`, validar via `audit_log`: inserir um evento em cada campanha pelo seed/função e confirmar que a claim de A só enxerga os de A.)

- [ ] **Step 6: Rodar advisors de segurança**

Via `mcp__supabase__get_advisors` (type=`security`).
Esperado: sem novos alertas de RLS faltante, policy frouxa ou função sem `search_path` fixo. (As funções já usam `set search_path = ''`.)

- [ ] **Step 7: Escrever o README do S1**

`docs/superpowers/specs/s1-README.md`: documentar `CPF_HMAC_KEY` e `SUPABASE_SECRET_KEY` (env, fora do banco), como o hook foi habilitado (Step 1), o fluxo de login, e o que ficou diferido (captcha, throttle por CPF/e-mail, 2FA, login/painel Superadmin).

- [ ] **Step 8: Commit**

```bash
git add supabase/seed/s1_seed_usuarios.mjs docs/superpowers/specs/s1-README.md
git commit -m "feat(s1): seed de usuarios, teste fim-a-fim de claims/RLS e README"
```

---

## Notas de execução

- **Progress ledger:** manter `.superpowers/sdd/progress.md` atualizado por task (padrão do S0): commit(s), resultado de review, IDs de campanha/usuário gerados.
- **Branch:** trabalho em `s1-auth-papeis` (já criada); merge p/ `main` ao fim, após review da branch (padrão do S0).
- **Ordem:** Tasks 1→4 (DB) antes de 5→11 (web); Task 12 fecha (depende de tudo). Tasks 5, 6, 8 são puras e podem ser feitas em paralelo se desejado.
- **Débito registrado (ADR 0008 parcial):** captcha, rate-limit/lockout por CPF/e-mail, 2FA e login/painel Superadmin ficam fora do S1.
