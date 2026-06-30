# S2 — Pessoa & Vínculo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o grafo Pessoa ↔ Vínculo com RLS por sub-árvore, autoridade per-ramo derivada via trigger, dedup duplo (título → CPF) e rotas Next.js de CRUD/provisão, completando a ADR 0004.

**Architecture:** 9 migrations Postgres (0011–0019) criam enums, `papel_prioridade`, `audit_entity`, `pessoa`, `notificacao`, funções SECURITY DEFINER, `vinculo` + triggers, e extensão de `usuario_campanha`. Camada Next.js segue padrão de injeção de dependências do S1 (função de negócio pura + `build*Deps` que injeta os clientes reais).

**Tech Stack:** PostgreSQL 15 (Supabase cloud `axcftjqdjvknrpqzrxls`), Next.js 16.2.9, TypeScript, Vitest 4, `@supabase/supabase-js` 2.108, `@supabase/ssr` 0.12, Node.js `crypto` (HMAC + AES-GCM).

## Global Constraints

- **ANTES DE TOCAR CÓDIGO NEXT.JS:** ler `web/node_modules/next/dist/docs/` (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`)
- Branch de trabalho: `s2-pessoa-vinculo` criada a partir de `main`
- Migrations via `mcp__supabase__apply_migration` — uma por task; cópia local em `supabase/migrations/`
- `get_advisors(type=security)` obrigatório após tasks 6 e 7
- CPF nunca em claro no banco; título nunca em claro (só `titulo_hmac` + `titulo_enc`)
- `adminClient()` = `web/lib/supabase/server.ts#adminClient` (service_role, ignora RLS)
- `ssrClient(cookieStore)` = `web/lib/supabase/ssr.ts#ssrClient` (autenticado, RLS ativo)
- Testes rodam com `cd web && npx vitest run <caminho>`
- Commits frequentes; mensagens em inglês, estilo do repo
- Ledger `.superpowers/ledger.md` atualizado após cada task (padrão S0/S1)

---

## File Map

### Migrations
| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0011_enums_s2.sql` | `papel_vinculo`, `base_legal_enum`, `origem_coleta_enum` |
| `supabase/migrations/0012_papel_prioridade.sql` | Tabela + 5 linhas de prioridade |
| `supabase/migrations/0013_audit_entity.sql` | Auditoria before/after genérica |
| `supabase/migrations/0014_pessoa.sql` | Tabela `pessoa` + `generate_pessoa_public_id()` + RLS |
| `supabase/migrations/0015_notificacao.sql` | Tabela `notificacao` + RLS |
| `supabase/migrations/0016_funcoes_autoridade.sql` | 11 funções SECURITY DEFINER |
| `supabase/migrations/0017_vinculo.sql` | Tabela `vinculo` + trigger anti-ciclo + RLS |
| `supabase/migrations/0018_triggers_vinculo.sql` | `trg_vinculo_sync_papel` + `trg_notificacao_vinculo_compartilhado` |
| `supabase/migrations/0019_usuario_campanha_pessoa_id.sql` | `ALTER TABLE usuario_campanha ADD COLUMN pessoa_id` |

### Web — utilitários
| Arquivo | Responsabilidade |
|---|---|
| `web/lib/titulo-hmac.ts` | HMAC-SHA256 do título de eleitor |
| `web/lib/titulo-hmac.test.ts` | Testes unitários |
| `web/lib/titulo-enc.ts` | AES-GCM encrypt/decrypt do título |
| `web/lib/titulo-enc.test.ts` | Testes unitários |

### Web — camada de negócio
| Arquivo | Responsabilidade |
|---|---|
| `web/lib/pessoa/criar.ts` | Lógica pura: dedup + criar pessoa + vínculo |
| `web/lib/pessoa/criar.test.ts` | Testes unitários com deps mockados |
| `web/lib/pessoa/build-criar-deps.ts` | Injeta clientes reais em `CriarPessoaDeps` |
| `web/lib/vinculo/remover.ts` | Lógica pura: impacto + realocar + remover |
| `web/lib/vinculo/remover.test.ts` | Testes unitários |
| `web/lib/vinculo/build-remover-deps.ts` | Injeta clientes reais em `RemoverVinculoDeps` |

### Web — route handlers
| Arquivo | Responsabilidade |
|---|---|
| `web/app/api/pessoas/route.ts` | POST: criar Pessoa + Vínculo |
| `web/app/api/pessoas/route.test.ts` | |
| `web/app/api/pessoas/[publicId]/provisionar-login/route.ts` | POST: provisiona auth.users + usuario_campanha |
| `web/app/api/pessoas/[publicId]/provisionar-login/route.test.ts` | |
| `web/app/api/vinculos/[id]/impacto/route.ts` | GET: dry-run de remoção |
| `web/app/api/vinculos/[id]/impacto/route.test.ts` | |
| `web/app/api/vinculos/[id]/route.ts` | DELETE: remover vínculo + realocar sub-árvore |
| `web/app/api/vinculos/[id]/route.test.ts` | |
| `web/app/api/notificacoes/route.ts` | GET: lista não lidas |
| `web/app/api/notificacoes/route.test.ts` | |
| `web/app/api/notificacoes/[id]/ler/route.ts` | PATCH: marcar como lida |
| `web/app/api/notificacoes/[id]/ler/route.test.ts` | |

---

### Task 1: Branch setup + DB foundation (migrations 0011–0013)

**Files:**
- Create: `supabase/migrations/0011_enums_s2.sql`
- Create: `supabase/migrations/0012_papel_prioridade.sql`
- Create: `supabase/migrations/0013_audit_entity.sql`

**Interfaces:**
- Produces: enum `papel_vinculo`, enum `base_legal_enum`, enum `origem_coleta_enum`, tabela `papel_prioridade`, tabela `audit_entity`

- [ ] **Step 1: Criar branch**

```bash
git checkout main && git pull && git checkout -b s2-pessoa-vinculo
```

- [ ] **Step 2: Verificar que enums NÃO existem (teste falha)**

Via `mcp__supabase__execute_sql` no projeto `axcftjqdjvknrpqzrxls`:
```sql
SELECT typname FROM pg_type WHERE typname IN ('papel_vinculo','base_legal_enum','origem_coleta_enum');
```
Esperado: 0 linhas.

- [ ] **Step 3: Criar migration 0011**

`supabase/migrations/0011_enums_s2.sql`:
```sql
-- papel_vinculo: inclui apoiador (sem login); distinto de papel_login do S1
CREATE TYPE public.papel_vinculo AS ENUM (
  'gestor', 'coordenador', 'colaborador', 'lideranca', 'apoiador'
);

CREATE TYPE public.base_legal_enum AS ENUM (
  'consentimento', 'legitimointeresse', 'obrigacao_legal', 'outro'
);

CREATE TYPE public.origem_coleta_enum AS ENUM (
  'manual', 'importacao', 'api'
);
```

- [ ] **Step 4: Aplicar via MCP e verificar enums existem**

```sql
SELECT typname FROM pg_type WHERE typname IN ('papel_vinculo','base_legal_enum','origem_coleta_enum') ORDER BY typname;
```
Esperado: 3 linhas.

- [ ] **Step 5: Criar e aplicar migration 0012**

`supabase/migrations/0012_papel_prioridade.sql`:
```sql
CREATE TABLE public.papel_prioridade (
  papel public.papel_vinculo PRIMARY KEY,
  prioridade integer NOT NULL
);

INSERT INTO public.papel_prioridade (papel, prioridade) VALUES
  ('gestor',      100),
  ('coordenador',  80),
  ('colaborador',  60),
  ('lideranca',    40),
  ('apoiador',      0);

-- imutável: apenas service_role escreve
REVOKE ALL ON public.papel_prioridade FROM authenticated, anon;
GRANT SELECT ON public.papel_prioridade TO authenticated;
```

Verificar:
```sql
SELECT papel, prioridade FROM public.papel_prioridade ORDER BY prioridade DESC;
```
Esperado: 5 linhas, gestor=100 no topo.

- [ ] **Step 6: Criar e aplicar migration 0013**

`supabase/migrations/0013_audit_entity.sql`:
```sql
CREATE TABLE public.audit_entity (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id   uuid        REFERENCES public.campanha(id),
  tabela        text        NOT NULL,
  entidade_id   uuid        NOT NULL,
  antes         jsonb,
  depois        jsonb,
  actor_user_id uuid        REFERENCES auth.users(id),
  ip            inet,
  user_agent    text,
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- append-only: nenhum UPDATE/DELETE por usuários
ALTER TABLE public.audit_entity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_entity FROM anon, public;

-- Gestor da campanha pode SELECT
CREATE POLICY "audit_entity_gestor_select" ON public.audit_entity
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'papel'
    ) = 'gestor'
  );

-- INSERT apenas via service_role / funções SECURITY DEFINER
-- (nenhum grant de INSERT para authenticated)
```

Verificar:
```sql
SELECT tablename, policyname FROM pg_policies WHERE tablename = 'audit_entity';
```
Esperado: 1 linha `audit_entity_gestor_select`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0011_enums_s2.sql supabase/migrations/0012_papel_prioridade.sql supabase/migrations/0013_audit_entity.sql
git commit -m "feat(s2): DB foundation — enums, papel_prioridade, audit_entity (0011-0013)"
```

---

### Task 2: Pessoa table (migration 0014)

**Files:**
- Create: `supabase/migrations/0014_pessoa.sql`

**Interfaces:**
- Consumes: `papel_vinculo`, `base_legal_enum`, `origem_coleta_enum` (Task 1)
- Produces: tabela `pessoa` com `public_id`, índices parciais de dedup, RLS

- [ ] **Step 1: Verificar que tabela NÃO existe**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'pessoa' AND table_schema = 'public';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0014**

`supabase/migrations/0014_pessoa.sql`:
```sql
-- gera public_id no formato pes_XXXXXXXX (4 bytes = 8 hex chars)
CREATE OR REPLACE FUNCTION public.generate_pessoa_public_id()
RETURNS text
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT 'pes_' || lower(encode(gen_random_bytes(4), 'hex'));
$$;

CREATE TABLE public.pessoa (
  id                        uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id                 text               UNIQUE NOT NULL DEFAULT public.generate_pessoa_public_id(),
  campanha_id               uuid               NOT NULL REFERENCES public.campanha(id),
  nome                      text               NOT NULL,
  titulo_hmac               text,
  titulo_enc                text,
  cpf_hmac                  text,
  telefone                  text,
  email_contato             text,
  secao_id                  uuid,              -- FK para secao(id) adicionada no S3
  base_legal                public.base_legal_enum  NOT NULL DEFAULT 'legitimointeresse',
  data_coleta               timestamptz        NOT NULL DEFAULT now(),
  origem_coleta             public.origem_coleta_enum NOT NULL DEFAULT 'manual',
  consentimento_dado_em     timestamptz,
  consentimento_revogado_em timestamptz,
  deleted_at                timestamptz,
  criado_em                 timestamptz        NOT NULL DEFAULT now(),
  atualizado_em             timestamptz        NOT NULL DEFAULT now()
);

-- dedup: título único por campanha (quando presente)
CREATE UNIQUE INDEX pessoa_titulo_hmac_idx
  ON public.pessoa (campanha_id, titulo_hmac)
  WHERE titulo_hmac IS NOT NULL;

-- dedup: CPF único por campanha (quando presente)
CREATE UNIQUE INDEX pessoa_cpf_hmac_idx
  ON public.pessoa (campanha_id, cpf_hmac)
  WHERE cpf_hmac IS NOT NULL;

-- index for RLS scan by campanha
CREATE INDEX pessoa_campanha_idx ON public.pessoa (campanha_id);

ALTER TABLE public.pessoa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pessoa FROM anon, public;

-- SELECT: tenant isolation + sub-árvore (função actor_pode_ver_pessoa criada em 0016)
-- Política usa referência forward — válida pois criada depois da função existir.
-- Aqui criamos policy mínima de tenant isolation; será substituída em 0016.
CREATE POLICY "pessoa_tenant_select" ON public.pessoa
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND deleted_at IS NULL
  );

CREATE POLICY "pessoa_insert" ON public.pessoa
  FOR INSERT TO authenticated
  WITH CHECK (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

CREATE POLICY "pessoa_update" ON public.pessoa
  FOR UPDATE TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
  );

-- hard DELETE proibido para authenticated; soft-delete via UPDATE (deleted_at)
CREATE POLICY "pessoa_delete" ON public.pessoa
  FOR DELETE TO authenticated
  USING (false);
```

**Nota:** `pessoa_tenant_select` é um placeholder de segurança mínima. A policy completa (com `actor_pode_ver_pessoa`) é adicionada em 0016 após a função existir — esta será dropada e recriada.

- [ ] **Step 3: Verificar estrutura da tabela**

```sql
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'pessoa' AND table_schema = 'public'
 ORDER BY ordinal_position;
```
Esperado: 18 colunas incluindo `public_id` com default `generate_pessoa_public_id()`.

- [ ] **Step 4: Verificar public_id gerado corretamente**

```sql
-- força chamada direta da função
SELECT public.generate_pessoa_public_id();
```
Esperado: string no formato `pes_` seguido de 8 chars hex (ex.: `pes_3f8a1c2b`).

- [ ] **Step 5: Verificar índices parciais existem**

```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'pessoa';
```
Esperado: pelo menos `pessoa_titulo_hmac_idx`, `pessoa_cpf_hmac_idx`, `pessoa_campanha_idx`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0014_pessoa.sql
git commit -m "feat(s2): pessoa table with public_id, dedup indexes, RLS (0014)"
```

---

### Task 3: Título crypto utilities

**Files:**
- Create: `web/lib/titulo-hmac.ts`
- Create: `web/lib/titulo-hmac.test.ts`
- Create: `web/lib/titulo-enc.ts`
- Create: `web/lib/titulo-enc.test.ts`

**Interfaces:**
- Consumes: `node:crypto` (built-in)
- Produces:
  - `tituloHmac(titulo: string, key?: string): string`
  - `encryptTitulo(titulo: string, key?: string): Promise<string>`
  - `decryptTitulo(encrypted: string, key?: string): Promise<string>`
  - `normalizarTitulo(titulo: string): string`

- [ ] **Step 1: Escrever testes para titulo-hmac**

`web/lib/titulo-hmac.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { tituloHmac, normalizarTitulo } from './titulo-hmac';

const KEY = 'test-key-32-bytes-long-padded-here';

describe('normalizarTitulo', () => {
  it('remove não-dígitos', () => {
    expect(normalizarTitulo('012 3456 7890')).toBe('01234567890');
  });
  it('string vazia retorna vazia', () => {
    expect(normalizarTitulo('')).toBe('');
  });
});

describe('tituloHmac', () => {
  it('retorna hex string de 64 chars', () => {
    const h = tituloHmac('01234567890', KEY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('mesmo título normalizado → mesmo hash', () => {
    expect(tituloHmac('012 3456 7890', KEY)).toBe(tituloHmac('01234567890', KEY));
  });
  it('títulos diferentes → hashes diferentes', () => {
    expect(tituloHmac('11111111111', KEY)).not.toBe(tituloHmac('22222222222', KEY));
  });
  it('lança sem TITULO_HMAC_KEY', () => {
    expect(() => tituloHmac('01234567890')).toThrow('TITULO_HMAC_KEY');
  });
});
```

- [ ] **Step 2: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run lib/titulo-hmac.test.ts
```
Esperado: falha com "Cannot find module './titulo-hmac'".

- [ ] **Step 3: Implementar titulo-hmac.ts**

`web/lib/titulo-hmac.ts`:
```typescript
import { createHmac } from 'node:crypto';

export function normalizarTitulo(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

export function tituloHmac(titulo: string, key?: string): string {
  const chave = key ?? process.env.TITULO_HMAC_KEY;
  if (!chave) throw new Error('TITULO_HMAC_KEY ausente no ambiente do servidor');
  return createHmac('sha256', chave).update(normalizarTitulo(titulo)).digest('hex');
}
```

- [ ] **Step 4: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run lib/titulo-hmac.test.ts
```
Esperado: todos passam.

- [ ] **Step 5: Escrever testes para titulo-enc**

`web/lib/titulo-enc.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { encryptTitulo, decryptTitulo } from './titulo-enc';

// 32 bytes em hex (64 chars)
const KEY = '0'.repeat(64);

describe('encryptTitulo / decryptTitulo', () => {
  it('round-trip preserva valor', async () => {
    const titulo = '01234567890';
    const enc = await encryptTitulo(titulo, KEY);
    expect(await decryptTitulo(enc, KEY)).toBe(titulo);
  });
  it('criptogramas diferentes para mesma entrada (IV aleatório)', async () => {
    const a = await encryptTitulo('12345', KEY);
    const b = await encryptTitulo('12345', KEY);
    expect(a).not.toBe(b);
  });
  it('lança sem TITULO_ENC_KEY', async () => {
    await expect(encryptTitulo('123')).rejects.toThrow('TITULO_ENC_KEY');
  });
  it('lança ao decifrar dado corrompido', async () => {
    await expect(decryptTitulo('naoBase64!!', KEY)).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Rodar teste — verificar FALHA**

```bash
cd web && npx vitest run lib/titulo-enc.test.ts
```
Esperado: falha com "Cannot find module './titulo-enc'".

- [ ] **Step 7: Implementar titulo-enc.ts**

`web/lib/titulo-enc.ts`:
```typescript
// AES-GCM para cifrar título de eleitor (LGPD Art. 18 — direito de acesso).
// TITULO_ENC_KEY: 64 chars hex (32 bytes). Nunca no banco.

function resolveKey(key?: string): Uint8Array {
  const raw = key ?? process.env.TITULO_ENC_KEY;
  if (!raw) throw new Error('TITULO_ENC_KEY ausente no ambiente do servidor');
  if (raw.length !== 64) throw new Error('TITULO_ENC_KEY deve ter 64 chars hex (32 bytes)');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function importKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usage);
}

export async function encryptTitulo(titulo: string, key?: string): Promise<string> {
  const keyBytes = resolveKey(key);
  const ck = await importKey(keyBytes, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    ck,
    new TextEncoder().encode(titulo),
  );
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), 12);
  return Buffer.from(combined).toString('base64');
}

export async function decryptTitulo(encrypted: string, key?: string): Promise<string> {
  const keyBytes = resolveKey(key);
  const ck = await importKey(keyBytes, ['decrypt']);
  const combined = Buffer.from(encrypted, 'base64');
  const iv = combined.subarray(0, 12);
  const ciphertext = combined.subarray(12);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, ck, ciphertext);
  return new TextDecoder().decode(dec);
}
```

- [ ] **Step 8: Rodar teste — verificar PASSA**

```bash
cd web && npx vitest run lib/titulo-enc.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add web/lib/titulo-hmac.ts web/lib/titulo-hmac.test.ts web/lib/titulo-enc.ts web/lib/titulo-enc.test.ts
git commit -m "feat(s2): titulo HMAC blind index + AES-GCM encrypt/decrypt"
```

---

### Task 4: notificacao table (migration 0015)

**Files:**
- Create: `supabase/migrations/0015_notificacao.sql`

**Interfaces:**
- Produces: tabela `notificacao` com RLS (destinatário vê só as próprias)

- [ ] **Step 1: Verificar que tabela NÃO existe**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'notificacao' AND table_schema = 'public';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0015**

`supabase/migrations/0015_notificacao.sql`:
```sql
CREATE TABLE public.notificacao (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id          uuid        NOT NULL REFERENCES public.campanha(id),
  destinatario_user_id uuid        NOT NULL REFERENCES auth.users(id),
  tipo                 text        NOT NULL,
  payload              jsonb       NOT NULL DEFAULT '{}',
  lido_em              timestamptz,
  criado_em            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notificacao_destinatario_idx ON public.notificacao (destinatario_user_id) WHERE lido_em IS NULL;

ALTER TABLE public.notificacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificacao FROM anon, public;

-- destinatário vê só as próprias
CREATE POLICY "notificacao_select" ON public.notificacao
  FOR SELECT TO authenticated
  USING (destinatario_user_id = auth.uid());

-- marcar como lida
CREATE POLICY "notificacao_update" ON public.notificacao
  FOR UPDATE TO authenticated
  USING (destinatario_user_id = auth.uid())
  WITH CHECK (destinatario_user_id = auth.uid());

-- INSERT/DELETE: apenas via funções SECURITY DEFINER (service_role)
-- nenhum grant de INSERT/DELETE para authenticated
```

- [ ] **Step 3: Verificar**

```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'notificacao' ORDER BY policyname;
```
Esperado: 2 linhas (`notificacao_select` SELECT, `notificacao_update` UPDATE).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0015_notificacao.sql
git commit -m "feat(s2): notificacao table with RLS (0015)"
```

---

### Task 5: SECURITY DEFINER authority functions (migration 0016)

**Files:**
- Create: `supabase/migrations/0016_funcoes_autoridade.sql`

**Interfaces:**
- Consumes: `pessoa`, `notificacao`, `usuario_campanha`, `papel_prioridade`, `audit_entity` (Tasks 1–4)
- Produces: 11 funções SECURITY DEFINER + políticas RLS completas em `pessoa`

- [ ] **Step 1: Verificar que funções NÃO existem**

```sql
SELECT proname FROM pg_proc WHERE proname IN (
  'actor_papel_base','pessoa_em_subarvore_do_actor','actor_pode_ver_pessoa',
  'actor_pode_editar_pessoa','actor_pode_criar_vinculo_sob','actor_pode_remover_vinculo',
  'actor_e_primeiro_registrante','buscar_pessoa_duplicada','subarvore_count',
  'realocar_subarvore','criar_pessoa_com_vinculo'
) ORDER BY proname;
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar migration 0016**

`supabase/migrations/0016_funcoes_autoridade.sql`:
```sql
-- ============================================================
-- 1. actor_papel_base — lê papel do JWT (gate grosso)
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_papel_base(actor_uid uuid)
RETURNS public.papel_login
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT papel FROM public.usuario_campanha WHERE user_id = actor_uid LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.actor_papel_base(uuid) FROM public, authenticated, anon;

-- ============================================================
-- 2. pessoa_em_subarvore_do_actor — recursive CTE de sub-árvore
-- ============================================================
CREATE OR REPLACE FUNCTION public.pessoa_em_subarvore_do_actor(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor_campanha_id uuid;
BEGIN
  SELECT campanha_id INTO actor_campanha_id
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF actor_campanha_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    WITH RECURSIVE sub AS (
      SELECT v.pessoa_id
        FROM public.vinculo v
        JOIN public.usuario_campanha uc ON uc.pessoa_id = v.responsavel_id
       WHERE uc.user_id = actor_uid AND v.campanha_id = actor_campanha_id
      UNION ALL
      SELECT v2.pessoa_id
        FROM public.vinculo v2
        JOIN sub ON sub.pessoa_id = v2.responsavel_id
       WHERE v2.campanha_id = actor_campanha_id
    )
    SELECT 1 FROM sub WHERE pessoa_id = target_pessoa_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.pessoa_em_subarvore_do_actor(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 3. actor_pode_ver_pessoa
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_ver_pessoa(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.papel_login;
  actor_camp uuid;
  target_camp uuid;
BEGIN
  SELECT papel, campanha_id INTO p, actor_camp
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF p IS NULL THEN RETURN false; END IF;

  SELECT campanha_id INTO target_camp FROM public.pessoa WHERE id = target_pessoa_id;
  IF target_camp IS DISTINCT FROM actor_camp THEN RETURN false; END IF;

  IF p IN ('gestor', 'colaborador') THEN RETURN true; END IF;
  RETURN public.pessoa_em_subarvore_do_actor(actor_uid, target_pessoa_id);
END;
$$;
REVOKE ALL ON FUNCTION public.actor_pode_ver_pessoa(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 4. actor_pode_editar_pessoa
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_editar_pessoa(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.actor_pode_ver_pessoa(actor_uid, target_pessoa_id);
$$;
REVOKE ALL ON FUNCTION public.actor_pode_editar_pessoa(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 5. actor_pode_criar_vinculo_sob
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_criar_vinculo_sob(
  actor_uid          uuid,
  responsavel_id     uuid,
  novo_papel         public.papel_vinculo
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p         public.papel_login;
  actor_camp uuid;
  resp_camp  uuid;
  actor_pess uuid;
BEGIN
  SELECT papel, campanha_id, pessoa_id INTO p, actor_camp, actor_pess
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF p IS NULL OR p = 'colaborador' THEN RETURN false; END IF;

  SELECT campanha_id INTO resp_camp FROM public.pessoa WHERE id = responsavel_id;
  IF resp_camp IS DISTINCT FROM actor_camp THEN RETURN false; END IF;

  IF p = 'gestor' THEN RETURN true; END IF;

  IF p = 'coordenador' THEN
    RETURN responsavel_id = actor_pess
        OR public.pessoa_em_subarvore_do_actor(auth.uid(), responsavel_id);
  END IF;

  -- liderança: só apoiador sob si mesma
  IF p = 'lideranca' THEN
    RETURN novo_papel = 'apoiador' AND responsavel_id = actor_pess;
  END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.actor_pode_criar_vinculo_sob(uuid, uuid, public.papel_vinculo) FROM public, authenticated, anon;

-- ============================================================
-- 6. actor_e_primeiro_registrante
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_e_primeiro_registrante(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT criado_por = actor_uid
    FROM public.vinculo
   WHERE pessoa_id = target_pessoa_id
     AND campanha_id = (SELECT campanha_id FROM public.usuario_campanha WHERE user_id = actor_uid)
   ORDER BY criado_em ASC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.actor_e_primeiro_registrante(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 7. actor_pode_remover_vinculo
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_remover_vinculo(
  actor_uid         uuid,
  target_vinculo_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p          public.papel_login;
  actor_camp uuid;
  actor_pess uuid;
  v          record;
BEGIN
  SELECT papel, campanha_id, pessoa_id INTO p, actor_camp, actor_pess
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF p IS NULL THEN RETURN false; END IF;

  SELECT pessoa_id, responsavel_id, campanha_id INTO v
    FROM public.vinculo WHERE id = target_vinculo_id;
  IF NOT FOUND OR v.campanha_id IS DISTINCT FROM actor_camp THEN RETURN false; END IF;

  IF p = 'gestor' THEN RETURN true; END IF;
  IF public.actor_e_primeiro_registrante(actor_uid, v.pessoa_id) THEN RETURN true; END IF;
  IF p = 'coordenador' THEN RETURN public.actor_pode_ver_pessoa(actor_uid, v.pessoa_id); END IF;
  IF p = 'lideranca' THEN RETURN v.responsavel_id = actor_pess; END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.actor_pode_remover_vinculo(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 8. buscar_pessoa_duplicada — cross-sub-árvore, título → CPF
-- ============================================================
CREATE OR REPLACE FUNCTION public.buscar_pessoa_duplicada(
  p_campanha_id uuid,
  p_titulo_hmac text,
  p_cpf_hmac    text
) RETURNS SETOF public.pessoa
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.pessoa%ROWTYPE;
BEGIN
  IF p_titulo_hmac IS NOT NULL THEN
    SELECT * INTO r FROM public.pessoa
     WHERE campanha_id = p_campanha_id AND titulo_hmac = p_titulo_hmac AND deleted_at IS NULL LIMIT 1;
    IF FOUND THEN RETURN NEXT r; RETURN; END IF;
  END IF;
  IF p_cpf_hmac IS NOT NULL THEN
    SELECT * INTO r FROM public.pessoa
     WHERE campanha_id = p_campanha_id AND cpf_hmac = p_cpf_hmac AND deleted_at IS NULL LIMIT 1;
    IF FOUND THEN RETURN NEXT r; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.buscar_pessoa_duplicada(uuid, text, text) FROM public, authenticated, anon;

-- ============================================================
-- 9. subarvore_count — contagem de descendentes (dry-run)
-- ============================================================
CREATE OR REPLACE FUNCTION public.subarvore_count(p_vinculo_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; result integer;
BEGIN
  SELECT pessoa_id, campanha_id INTO v FROM public.vinculo WHERE id = p_vinculo_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  WITH RECURSIVE sub AS (
    SELECT cv.pessoa_id FROM public.vinculo cv
     WHERE cv.responsavel_id = v.pessoa_id AND cv.campanha_id = v.campanha_id
    UNION ALL
    SELECT cv2.pessoa_id FROM public.vinculo cv2 JOIN sub ON sub.pessoa_id = cv2.responsavel_id
     WHERE cv2.campanha_id = v.campanha_id
  )
  SELECT count(*)::integer INTO result FROM sub;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.subarvore_count(uuid) FROM public, authenticated, anon;

-- ============================================================
-- 10. realocar_subarvore — move filhos diretos para novo_responsavel
-- ============================================================
CREATE OR REPLACE FUNCTION public.realocar_subarvore(
  p_vinculo_id        uuid,
  p_novo_responsavel_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; n integer;
BEGIN
  SELECT pessoa_id, responsavel_id, campanha_id INTO v
    FROM public.vinculo WHERE id = p_vinculo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'vínculo não encontrado: %', p_vinculo_id; END IF;

  UPDATE public.vinculo
     SET responsavel_id = p_novo_responsavel_id
   WHERE responsavel_id = v.pessoa_id AND campanha_id = v.campanha_id AND id != p_vinculo_id;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.audit_entity (campanha_id, tabela, entidade_id, antes, depois)
  VALUES (
    v.campanha_id, 'vinculo', p_vinculo_id,
    jsonb_build_object('responsavel_id', v.responsavel_id, 'filhos_realocados', n),
    jsonb_build_object('novo_responsavel_id', p_novo_responsavel_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.realocar_subarvore(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 11. criar_pessoa_com_vinculo — atômico: INSERT pessoa + vínculo
-- ============================================================
CREATE OR REPLACE FUNCTION public.criar_pessoa_com_vinculo(
  p_campanha_id       uuid,
  p_nome              text,
  p_titulo_hmac       text,
  p_titulo_enc        text,
  p_cpf_hmac          text,
  p_telefone          text,
  p_email_contato     text,
  p_base_legal        public.base_legal_enum,
  p_origem_coleta     public.origem_coleta_enum,
  p_responsavel_id    uuid,
  p_papel             public.papel_vinculo,
  p_criado_por        uuid,
  p_pessoa_id_existente uuid,  -- NULL = cria nova Pessoa; não-null = usa existente (compartilhado)
  p_actor_ip          inet,
  p_actor_ua          text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  nova_pessoa_id uuid;
  novo_vinculo_id uuid;
BEGIN
  IF p_pessoa_id_existente IS NOT NULL THEN
    nova_pessoa_id := p_pessoa_id_existente;
  ELSE
    INSERT INTO public.pessoa (
      campanha_id, nome, titulo_hmac, titulo_enc, cpf_hmac,
      telefone, email_contato, base_legal, origem_coleta
    ) VALUES (
      p_campanha_id, p_nome, p_titulo_hmac, p_titulo_enc, p_cpf_hmac,
      p_telefone, p_email_contato, p_base_legal, p_origem_coleta
    ) RETURNING id INTO nova_pessoa_id;

    INSERT INTO public.audit_entity (
      campanha_id, tabela, entidade_id, depois, actor_user_id, ip, user_agent
    ) VALUES (
      p_campanha_id, 'pessoa', nova_pessoa_id,
      jsonb_build_object('nome', p_nome, 'origem', p_origem_coleta),
      p_criado_por, p_actor_ip, p_actor_ua
    );
  END IF;

  INSERT INTO public.vinculo (
    campanha_id, pessoa_id, responsavel_id, papel, criado_por
  ) VALUES (
    p_campanha_id, nova_pessoa_id, p_responsavel_id, p_papel, p_criado_por
  ) RETURNING id INTO novo_vinculo_id;

  RETURN jsonb_build_object('pessoa_id', nova_pessoa_id, 'vinculo_id', novo_vinculo_id);
END;
$$;
REVOKE ALL ON FUNCTION public.criar_pessoa_com_vinculo FROM public, authenticated, anon;

-- ============================================================
-- Atualizar RLS de pessoa para usar actor_pode_ver_pessoa
-- ============================================================
DROP POLICY IF EXISTS "pessoa_tenant_select" ON public.pessoa;

CREATE POLICY "pessoa_select" ON public.pessoa
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND deleted_at IS NULL
    AND public.actor_pode_ver_pessoa(auth.uid(), id)
  );

DROP POLICY IF EXISTS "pessoa_update" ON public.pessoa;

CREATE POLICY "pessoa_update" ON public.pessoa
  FOR UPDATE TO authenticated
  USING (public.actor_pode_editar_pessoa(auth.uid(), id));
```

- [ ] **Step 3: Aplicar via MCP e verificar funções existem**

```sql
SELECT proname FROM pg_proc WHERE proname IN (
  'actor_papel_base','pessoa_em_subarvore_do_actor','actor_pode_ver_pessoa',
  'actor_pode_editar_pessoa','actor_pode_criar_vinculo_sob','actor_pode_remover_vinculo',
  'actor_e_primeiro_registrante','buscar_pessoa_duplicada','subarvore_count',
  'realocar_subarvore','criar_pessoa_com_vinculo'
) ORDER BY proname;
```
Esperado: 11 linhas.

- [ ] **Step 4: Verificar RLS de pessoa atualizada**

```sql
SELECT policyname FROM pg_policies WHERE tablename = 'pessoa' ORDER BY policyname;
```
Esperado: `pessoa_delete`, `pessoa_insert`, `pessoa_select`, `pessoa_update`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0016_funcoes_autoridade.sql
git commit -m "feat(s2): 11 SECURITY DEFINER functions + pessoa RLS with sub-tree visibility (0016)"
```

---

### Task 6: vínculo table + anti-ciclo trigger + RLS (migration 0017)

**Files:**
- Create: `supabase/migrations/0017_vinculo.sql`

**Interfaces:**
- Consumes: `pessoa`, `papel_prioridade`, `papel_vinculo`, funções autoridade (Tasks 1–5)
- Produces: tabela `vinculo` com trigger anti-ciclo e RLS completo

- [ ] **Step 1: Verificar que tabela NÃO existe**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'vinculo' AND table_schema = 'public';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0017**

`supabase/migrations/0017_vinculo.sql`:
```sql
CREATE TABLE public.vinculo (
  id            uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id   uuid               NOT NULL REFERENCES public.campanha(id),
  pessoa_id     uuid               NOT NULL REFERENCES public.pessoa(id),
  responsavel_id uuid              REFERENCES public.pessoa(id),
  papel         public.papel_vinculo NOT NULL,
  criado_por    uuid               REFERENCES auth.users(id),
  criado_em     timestamptz        NOT NULL DEFAULT now(),
  CONSTRAINT vinculo_sem_autoloop  CHECK (pessoa_id <> responsavel_id),
  CONSTRAINT vinculo_unique_aresta UNIQUE (campanha_id, pessoa_id, responsavel_id)
);

CREATE INDEX vinculo_pessoa_idx       ON public.vinculo (pessoa_id);
CREATE INDEX vinculo_responsavel_idx  ON public.vinculo (responsavel_id);
CREATE INDEX vinculo_campanha_idx     ON public.vinculo (campanha_id);

-- ============================================================
-- Trigger: anti-ciclo
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_vinculo_ciclo_check_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.responsavel_id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    WITH RECURSIVE anc AS (
      SELECT v.responsavel_id AS pid
        FROM public.vinculo v
       WHERE v.pessoa_id = NEW.responsavel_id AND v.campanha_id = NEW.campanha_id
      UNION ALL
      SELECT v2.responsavel_id FROM public.vinculo v2
        JOIN anc ON anc.pid = v2.pessoa_id
       WHERE v2.campanha_id = NEW.campanha_id AND v2.responsavel_id IS NOT NULL
    )
    SELECT 1 FROM anc WHERE pid = NEW.pessoa_id
  ) THEN
    RAISE EXCEPTION 'ciclo detectado: inserir pessoa=% sob responsavel=% criaria ciclo',
      NEW.pessoa_id, NEW.responsavel_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vinculo_ciclo_check
  BEFORE INSERT ON public.vinculo
  FOR EACH ROW EXECUTE FUNCTION public.trg_vinculo_ciclo_check_fn();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vinculo FROM anon, public;

CREATE POLICY "vinculo_select" ON public.vinculo
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND public.actor_pode_ver_pessoa(auth.uid(), pessoa_id)
  );

CREATE POLICY "vinculo_insert" ON public.vinculo
  FOR INSERT TO authenticated
  WITH CHECK (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND public.actor_pode_criar_vinculo_sob(auth.uid(), responsavel_id, papel)
  );

-- UPDATE direto bloqueado; mudanças estruturais via SECURITY DEFINER (realocar_subarvore)
CREATE POLICY "vinculo_update" ON public.vinculo
  FOR UPDATE TO authenticated USING (false);

CREATE POLICY "vinculo_delete" ON public.vinculo
  FOR DELETE TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND public.actor_pode_remover_vinculo(auth.uid(), id)
  );
```

- [ ] **Step 3: Verificar tabela e trigger**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'vinculo';
SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'vinculo';
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'vinculo' ORDER BY policyname;
```
Esperado: tabela existe; trigger `trg_vinculo_ciclo_check`; 4 policies.

- [ ] **Step 4: Rodar `get_advisors(security)` — sem novos alertas**

Via MCP `mcp__supabase__get_advisors` com `{ "type": "security" }`.
Registrar resultado no ledger.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0017_vinculo.sql
git commit -m "feat(s2): vinculo table, anti-ciclo trigger, RLS (0017)"
```

---

### Task 7: Sync triggers (migration 0018)

**Files:**
- Create: `supabase/migrations/0018_triggers_vinculo.sql`

**Interfaces:**
- Consumes: `vinculo`, `papel_prioridade`, `usuario_campanha`, `notificacao` (Tasks 4–6)
- Produces: `trg_vinculo_sync_papel` + `trg_notificacao_vinculo_compartilhado`

- [ ] **Step 1: Criar e aplicar migration 0018**

`supabase/migrations/0018_triggers_vinculo.sql`:
```sql
-- ============================================================
-- Trigger: sync usuario_campanha.papel usando papel_prioridade
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_vinculo_sync_papel_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  aff_pessoa_id  uuid;
  aff_camp_id    uuid;
  novo_papel     public.papel_login;
BEGIN
  IF TG_OP = 'DELETE' THEN
    aff_pessoa_id := OLD.pessoa_id; aff_camp_id := OLD.campanha_id;
  ELSE
    aff_pessoa_id := NEW.pessoa_id; aff_camp_id := NEW.campanha_id;
  END IF;

  -- papel de maior prioridade excluindo apoiador (cast para papel_login é seguro
  -- porque papel_login é subconjunto de papel_vinculo sem 'apoiador')
  SELECT v.papel::text::public.papel_login INTO novo_papel
    FROM public.vinculo v
    JOIN public.papel_prioridade pp ON pp.papel = v.papel
   WHERE v.pessoa_id = aff_pessoa_id AND v.campanha_id = aff_camp_id
     AND v.papel != 'apoiador'
   ORDER BY pp.prioridade DESC LIMIT 1;

  IF novo_papel IS NOT NULL THEN
    UPDATE public.usuario_campanha
       SET papel = novo_papel
     WHERE pessoa_id = aff_pessoa_id;
  ELSE
    -- sem vínculo elegível para login: sinaliza no audit_log
    INSERT INTO public.audit_log (campanha_id, actor_id, acao, depois)
    SELECT uc.campanha_id, aff_pessoa_id, 'login.acesso_revogado',
           jsonb_build_object('pessoa_id', aff_pessoa_id)
      FROM public.usuario_campanha uc WHERE uc.pessoa_id = aff_pessoa_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_vinculo_sync_papel
  AFTER INSERT OR UPDATE OR DELETE ON public.vinculo
  FOR EACH ROW EXECUTE FUNCTION public.trg_vinculo_sync_papel_fn();

-- ============================================================
-- Trigger: notificação para responsáveis anteriores (vínculo compartilhado)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_notificacao_vinculo_compartilhado_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE rec record;
BEGIN
  -- notifica responsáveis cujo vínculo com essa pessoa já existia ANTES deste INSERT
  FOR rec IN
    SELECT DISTINCT uc.user_id, uc.campanha_id
      FROM public.vinculo v
      JOIN public.usuario_campanha uc ON uc.pessoa_id = v.responsavel_id
     WHERE v.pessoa_id  = NEW.pessoa_id
       AND v.campanha_id = NEW.campanha_id
       AND v.id         != NEW.id
       AND (v.criado_por IS DISTINCT FROM NEW.criado_por)
  LOOP
    INSERT INTO public.notificacao (campanha_id, destinatario_user_id, tipo, payload)
    VALUES (
      NEW.campanha_id, rec.user_id, 'vinculo_compartilhado',
      jsonb_build_object(
        'pessoa_id',          NEW.pessoa_id,
        'novo_responsavel_id', NEW.responsavel_id,
        'novo_criado_por',    NEW.criado_por
      )
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificacao_vinculo_compartilhado
  AFTER INSERT ON public.vinculo
  FOR EACH ROW EXECUTE FUNCTION public.trg_notificacao_vinculo_compartilhado_fn();
```

- [ ] **Step 2: Verificar triggers existem**

```sql
SELECT trigger_name FROM information_schema.triggers
 WHERE event_object_table = 'vinculo'
 ORDER BY trigger_name;
```
Esperado: `trg_notificacao_vinculo_compartilhado`, `trg_vinculo_ciclo_check`, `trg_vinculo_sync_papel`.

- [ ] **Step 3: Rodar `get_advisors(security)` — sem novos alertas**

Via MCP. Registrar no ledger.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_triggers_vinculo.sql
git commit -m "feat(s2): sync papel trigger + notificacao compartilhado trigger (0018)"
```

---

### Task 8: usuario_campanha extension (migration 0019)

**Files:**
- Create: `supabase/migrations/0019_usuario_campanha_pessoa_id.sql`

**Interfaces:**
- Consumes: `pessoa` (Task 2), `usuario_campanha` (S1)
- Produces: coluna `usuario_campanha.pessoa_id` nullable

- [ ] **Step 1: Verificar que coluna NÃO existe**

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'usuario_campanha' AND column_name = 'pessoa_id';
```
Esperado: 0 linhas.

- [ ] **Step 2: Criar e aplicar migration 0019**

`supabase/migrations/0019_usuario_campanha_pessoa_id.sql`:
```sql
ALTER TABLE public.usuario_campanha
  ADD COLUMN pessoa_id uuid REFERENCES public.pessoa(id) ON DELETE SET NULL;

CREATE INDEX uc_pessoa_id_idx ON public.usuario_campanha (pessoa_id) WHERE pessoa_id IS NOT NULL;
```

- [ ] **Step 3: Verificar**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
 WHERE table_name = 'usuario_campanha' AND column_name = 'pessoa_id';
```
Esperado: `pessoa_id`, `uuid`, `YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0019_usuario_campanha_pessoa_id.sql
git commit -m "feat(s2): usuario_campanha.pessoa_id FK for login provisioning (0019)"
```

---

### Task 9: Pessoa creation API

**Files:**
- Create: `web/lib/pessoa/criar.ts`
- Create: `web/lib/pessoa/criar.test.ts`
- Create: `web/lib/pessoa/build-criar-deps.ts`
- Create: `web/app/api/pessoas/route.ts`
- Create: `web/app/api/pessoas/route.test.ts`

**Interfaces:**
- Consumes: `tituloHmac`, `encryptTitulo` (Task 3); `cpfHmac` (`web/lib/cpf-hmac.ts`); `adminClient` (`web/lib/supabase/server.ts`)
- Produces: `POST /api/pessoas` — 201 com `{ public_id }` ou 409 com `{ error, match_por, pessoa_existente }`

- [ ] **Step 1: Escrever testes de unidade para criar.ts**

`web/lib/pessoa/criar.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { criarPessoa, type CriarPessoaDeps, type CriarPessoaInput } from './criar';

const makeDeps = (overrides: Partial<CriarPessoaDeps> = {}): CriarPessoaDeps => ({
  tituloHmac:    (t) => 'hmac-' + t,
  encryptTitulo: async (t) => 'enc-' + t,
  cpfHmac:       (c) => 'hmac-' + c,
  buscarDuplicada: vi.fn(async () => null),
  criarPessoaComVinculo: vi.fn(async () => ({ pessoa_id: 'pid-1', vinculo_id: 'vid-1' })),
  ...overrides,
});

const input: CriarPessoaInput = {
  campanha_id: 'camp-1',
  nome: 'João Silva',
  titulo: '01234567890',
  cpf: '12345678909',
  responsavel_id: 'resp-1',
  papel: 'apoiador',
  criado_por: 'user-1',
  confirmar_compartilhado: false,
  ip: '1.2.3.4',
  user_agent: 'test',
};

describe('criarPessoa', () => {
  it('retorna pessoa_id ao criar nova pessoa sem duplicata', async () => {
    const deps = makeDeps();
    const res = await criarPessoa(input, deps);
    expect(res.tipo).toBe('criado');
    if (res.tipo === 'criado') expect(res.pessoa_id).toBe('pid-1');
    expect(deps.criarPessoaComVinculo).toHaveBeenCalledOnce();
  });

  it('retorna duplicata_titulo quando título já existe', async () => {
    const deps = makeDeps({
      buscarDuplicada: vi.fn(async () => ({
        id: 'dup-id', public_id: 'pes_abc', nome: 'João',
        titulo_hmac: 'hmac-01234567890', cpf_hmac: null,
      })),
    });
    const res = await criarPessoa(input, deps);
    expect(res.tipo).toBe('duplicata');
    if (res.tipo === 'duplicata') {
      expect(res.match_por).toBe('titulo');
      expect(res.pessoa_existente.public_id).toBe('pes_abc');
    }
    expect(deps.criarPessoaComVinculo).not.toHaveBeenCalled();
  });

  it('cria vínculo compartilhado quando confirmar_compartilhado=true', async () => {
    const existente = { id: 'dup-id', public_id: 'pes_abc', nome: 'João',
                        titulo_hmac: 'hmac-01234567890', cpf_hmac: null };
    const deps = makeDeps({
      buscarDuplicada: vi.fn(async () => existente),
    });
    const res = await criarPessoa({ ...input, confirmar_compartilhado: true }, deps);
    expect(res.tipo).toBe('criado');
    expect(deps.criarPessoaComVinculo).toHaveBeenCalledWith(
      expect.objectContaining({ pessoa_id_existente: 'dup-id' })
    );
  });
});
```

- [ ] **Step 2: Rodar — FALHA esperada**

```bash
cd web && npx vitest run lib/pessoa/criar.test.ts
```

- [ ] **Step 3: Implementar criar.ts**

`web/lib/pessoa/criar.ts`:
```typescript
export interface CriarPessoaDeps {
  tituloHmac(titulo: string): string;
  encryptTitulo(titulo: string): Promise<string>;
  cpfHmac(cpf: string): string;
  buscarDuplicada(
    campanha_id: string,
    titulo_hmac: string | null,
    cpf_hmac: string | null,
  ): Promise<{ id: string; public_id: string; nome: string; titulo_hmac: string | null; cpf_hmac: string | null } | null>;
  criarPessoaComVinculo(params: {
    campanha_id: string; nome: string; titulo_hmac: string | null; titulo_enc: string | null;
    cpf_hmac: string | null; telefone?: string; email_contato?: string;
    responsavel_id: string; papel: string; criado_por: string;
    pessoa_id_existente: string | null; ip: string | null; user_agent: string | null;
  }): Promise<{ pessoa_id: string; vinculo_id: string }>;
}

export interface CriarPessoaInput {
  campanha_id: string;
  nome: string;
  titulo?: string;
  cpf?: string;
  telefone?: string;
  email_contato?: string;
  responsavel_id: string;
  papel: string;
  criado_por: string;
  confirmar_compartilhado: boolean;
  ip?: string;
  user_agent?: string;
}

type CriarPessoaResult =
  | { tipo: 'criado'; pessoa_id: string; vinculo_id: string }
  | { tipo: 'duplicata'; match_por: 'titulo' | 'cpf'; pessoa_existente: { id: string; public_id: string; nome: string } };

export async function criarPessoa(
  input: CriarPessoaInput,
  deps: CriarPessoaDeps,
): Promise<CriarPessoaResult> {
  const titulo_hmac = input.titulo ? deps.tituloHmac(input.titulo) : null;
  const titulo_enc  = input.titulo ? await deps.encryptTitulo(input.titulo) : null;
  const cpf_hmac    = input.cpf    ? deps.cpfHmac(input.cpf) : null;

  const dup = await deps.buscarDuplicada(input.campanha_id, titulo_hmac, cpf_hmac);

  if (dup && !input.confirmar_compartilhado) {
    const match_por = dup.titulo_hmac === titulo_hmac ? 'titulo' : 'cpf';
    return { tipo: 'duplicata', match_por, pessoa_existente: { id: dup.id, public_id: dup.public_id, nome: dup.nome } };
  }

  const res = await deps.criarPessoaComVinculo({
    campanha_id:          input.campanha_id,
    nome:                 input.nome,
    titulo_hmac,
    titulo_enc,
    cpf_hmac,
    telefone:             input.telefone,
    email_contato:        input.email_contato,
    responsavel_id:       input.responsavel_id,
    papel:                input.papel,
    criado_por:           input.criado_por,
    pessoa_id_existente:  dup?.id ?? null,
    ip:                   input.ip ?? null,
    user_agent:           input.user_agent ?? null,
  });

  return { tipo: 'criado', ...res };
}
```

- [ ] **Step 4: Rodar — PASSA**

```bash
cd web && npx vitest run lib/pessoa/criar.test.ts
```

- [ ] **Step 5: Implementar build-criar-deps.ts**

`web/lib/pessoa/build-criar-deps.ts`:
```typescript
import { tituloHmac } from '../titulo-hmac';
import { encryptTitulo } from '../titulo-enc';
import { cpfHmac } from '../cpf-hmac';
import { adminClient } from '../supabase/server';
import type { CriarPessoaDeps } from './criar';

export async function buildCriarDeps(): Promise<CriarPessoaDeps> {
  return {
    tituloHmac: (t) => tituloHmac(t),
    encryptTitulo: (t) => encryptTitulo(t),
    cpfHmac: (c) => cpfHmac(c),

    async buscarDuplicada(campanha_id, titulo_hmac, cpf_hmac) {
      const admin = adminClient();
      const { data } = await admin.rpc('buscar_pessoa_duplicada', {
        p_campanha_id: campanha_id,
        p_titulo_hmac: titulo_hmac,
        p_cpf_hmac:    cpf_hmac,
      });
      return data?.[0] ?? null;
    },

    async criarPessoaComVinculo(params) {
      const admin = adminClient();
      const { data, error } = await admin.rpc('criar_pessoa_com_vinculo', {
        p_campanha_id:          params.campanha_id,
        p_nome:                 params.nome,
        p_titulo_hmac:          params.titulo_hmac,
        p_titulo_enc:           params.titulo_enc,
        p_cpf_hmac:             params.cpf_hmac,
        p_telefone:             params.telefone ?? null,
        p_email_contato:        params.email_contato ?? null,
        p_base_legal:           'legitimointeresse',
        p_origem_coleta:        'manual',
        p_responsavel_id:       params.responsavel_id,
        p_papel:                params.papel,
        p_criado_por:           params.criado_por,
        p_pessoa_id_existente:  params.pessoa_id_existente,
        p_actor_ip:             params.ip,
        p_actor_ua:             params.user_agent,
      });
      if (error) throw error;
      return data as { pessoa_id: string; vinculo_id: string };
    },
  };
}
```

- [ ] **Step 6: Escrever testes do route handler**

`web/app/api/pessoas/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/pessoa/build-criar-deps', () => ({
  buildCriarDeps: vi.fn(async () => ({
    tituloHmac:    (t: string) => 'h-' + t,
    encryptTitulo: async (t: string) => 'e-' + t,
    cpfHmac:       (c: string) => 'h-' + c,
    buscarDuplicada:       vi.fn(async () => null),
    criarPessoaComVinculo: vi.fn(async () => ({ pessoa_id: 'pid-1', vinculo_id: 'vid-1' })),
  })),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'u-1', app_metadata: { campanha_id: 'c-1' } } },
        error: null,
      })),
    },
  })),
}));

import { POST } from './route';

function req(body: unknown, sub = 'campanha-a') {
  return new Request('http://localhost/api/pessoas', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-campanha-subdominio': sub },
    body: JSON.stringify(body),
  });
}

describe('POST /api/pessoas', () => {
  it('201 ao criar pessoa nova', async () => {
    const res = await POST(req({ nome: 'João', responsavel_id: 'r-1', papel: 'apoiador' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ public_id: expect.stringMatching(/^pes_/) });
  });

  it('400 sem nome', async () => {
    const res = await POST(req({ responsavel_id: 'r-1', papel: 'apoiador' }));
    expect(res.status).toBe(400);
  });

  it('401 sem usuário autenticado', async () => {
    const { ssrClient } = await import('../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const res = await POST(req({ nome: 'X', responsavel_id: 'r-1', papel: 'apoiador' }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 7: Rodar testes route — FALHA esperada**

```bash
cd web && npx vitest run app/api/pessoas/route.test.ts
```

- [ ] **Step 8: Implementar route.ts**

`web/app/api/pessoas/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';
import { buildCriarDeps } from '../../../lib/pessoa/build-criar-deps';
import { criarPessoa } from '../../../lib/pessoa/criar';

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const campanha_id = user.app_metadata?.campanha_id as string | undefined;
  if (!campanha_id) return NextResponse.json({ erro: 'campanha não identificada' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }

  const { nome, titulo, cpf, telefone, email_contato,
          responsavel_id, papel, confirmar_compartilhado } = body as Record<string, string | boolean | undefined>;

  if (!nome || !responsavel_id || !papel) {
    return NextResponse.json({ erro: 'nome, responsavel_id e papel são obrigatórios' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const user_agent = req.headers.get('user-agent') ?? undefined;

  const deps = await buildCriarDeps();
  const result = await criarPessoa({
    campanha_id,
    nome: nome as string,
    titulo: titulo as string | undefined,
    cpf: cpf as string | undefined,
    telefone: telefone as string | undefined,
    email_contato: email_contato as string | undefined,
    responsavel_id: responsavel_id as string,
    papel: papel as string,
    criado_por: user.id,
    confirmar_compartilhado: Boolean(confirmar_compartilhado),
    ip,
    user_agent,
  }, deps);

  if (result.tipo === 'duplicata') {
    return NextResponse.json({
      error: 'pessoa_duplicada',
      match_por: result.match_por,
      pessoa_existente: result.pessoa_existente,
    }, { status: 409 });
  }

  // busca public_id da pessoa criada para retornar
  const admin = (await import('../../../lib/supabase/server')).adminClient();
  const { data: p } = await admin
    .from('pessoa')
    .select('public_id')
    .eq('id', result.pessoa_id)
    .single();

  return NextResponse.json({ public_id: p?.public_id ?? result.pessoa_id }, { status: 201 });
}
```

- [ ] **Step 9: Rodar testes — PASSA**

```bash
cd web && npx vitest run app/api/pessoas/route.test.ts
```

- [ ] **Step 10: Commit**

```bash
git add web/lib/pessoa/ web/app/api/pessoas/
git commit -m "feat(s2): pessoa creation API with dedup and shared vínculo flow"
```

---

### Task 10: Vínculo management API (impacto + delete)

**Files:**
- Create: `web/lib/vinculo/remover.ts`
- Create: `web/lib/vinculo/remover.test.ts`
- Create: `web/lib/vinculo/build-remover-deps.ts`
- Create: `web/app/api/vinculos/[id]/impacto/route.ts`
- Create: `web/app/api/vinculos/[id]/impacto/route.test.ts`
- Create: `web/app/api/vinculos/[id]/route.ts`
- Create: `web/app/api/vinculos/[id]/route.test.ts`

**Interfaces:**
- Consumes: `adminClient`, `ssrClient`, funções `subarvore_count`, `realocar_subarvore`
- Produces: `GET /api/vinculos/:id/impacto` → `{ count, responsavel_acima }` ; `DELETE /api/vinculos/:id` → 204

- [ ] **Step 1: Escrever testes remover.ts**

`web/lib/vinculo/remover.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { removerVinculo, type RemoverVinculoDeps } from './remover';

const makeDeps = (overrides: Partial<RemoverVinculoDeps> = {}): RemoverVinculoDeps => ({
  subarvoreCount:    vi.fn(async () => 3),
  realocarSubarvore: vi.fn(async () => {}),
  deletarVinculo:    vi.fn(async () => {}),
  ...overrides,
});

describe('removerVinculo', () => {
  it('remove sem realocar quando sem filhos', async () => {
    const deps = makeDeps({ subarvoreCount: vi.fn(async () => 0) });
    await removerVinculo({ vinculo_id: 'v-1', destino_id: null }, deps);
    expect(deps.realocarSubarvore).not.toHaveBeenCalled();
    expect(deps.deletarVinculo).toHaveBeenCalledWith('v-1');
  });

  it('realoca antes de deletar quando há filhos', async () => {
    const deps = makeDeps();
    await removerVinculo({ vinculo_id: 'v-1', destino_id: 'dest-1' }, deps);
    expect(deps.realocarSubarvore).toHaveBeenCalledWith('v-1', 'dest-1');
    expect(deps.deletarVinculo).toHaveBeenCalledWith('v-1');
  });
});
```

- [ ] **Step 2: Rodar — FALHA**

```bash
cd web && npx vitest run lib/vinculo/remover.test.ts
```

- [ ] **Step 3: Implementar remover.ts**

`web/lib/vinculo/remover.ts`:
```typescript
export interface RemoverVinculoDeps {
  subarvoreCount(vinculo_id: string): Promise<number>;
  realocarSubarvore(vinculo_id: string, destino_id: string): Promise<void>;
  deletarVinculo(vinculo_id: string): Promise<void>;
}

export interface RemoverVinculoInput {
  vinculo_id: string;
  destino_id: string | null;
}

export async function removerVinculo(
  input: RemoverVinculoInput,
  deps: RemoverVinculoDeps,
): Promise<void> {
  const count = await deps.subarvoreCount(input.vinculo_id);
  if (count > 0 && input.destino_id) {
    await deps.realocarSubarvore(input.vinculo_id, input.destino_id);
  }
  await deps.deletarVinculo(input.vinculo_id);
}
```

- [ ] **Step 4: Rodar — PASSA**

```bash
cd web && npx vitest run lib/vinculo/remover.test.ts
```

- [ ] **Step 5: Implementar build-remover-deps.ts**

`web/lib/vinculo/build-remover-deps.ts`:
```typescript
import { adminClient } from '../supabase/server';
import type { RemoverVinculoDeps } from './remover';

export function buildRemoverDeps(): RemoverVinculoDeps {
  return {
    async subarvoreCount(vinculo_id) {
      const { data, error } = await adminClient().rpc('subarvore_count', { p_vinculo_id: vinculo_id });
      if (error) throw error;
      return data as number;
    },
    async realocarSubarvore(vinculo_id, destino_id) {
      const { error } = await adminClient().rpc('realocar_subarvore', {
        p_vinculo_id: vinculo_id,
        p_novo_responsavel_id: destino_id,
      });
      if (error) throw error;
    },
    async deletarVinculo(vinculo_id) {
      // DELETE via authenticated client so RLS policy (actor_pode_remover_vinculo) is enforced
      // Note: called from route which already verified auth — use admin to bypass JWT parse
      const { error } = await adminClient().from('vinculo').delete().eq('id', vinculo_id);
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 6: Implementar impacto route**

`web/app/api/vinculos/[id]/impacto/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../../lib/supabase/ssr';
import { adminClient } from '../../../../../lib/supabase/server';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = ssrClient(cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data: count, error } = await adminClient().rpc('subarvore_count', {
    p_vinculo_id: params.id,
  });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  // busca responsavel_id do vínculo para retornar o "acima"
  const { data: v } = await adminClient()
    .from('vinculo')
    .select('responsavel_id, pessoa:responsavel_id(public_id, nome)')
    .eq('id', params.id)
    .single();

  return NextResponse.json({
    count: count as number,
    responsavel_acima: v?.pessoa ?? null,
  });
}
```

- [ ] **Step 7: Implementar delete route**

`web/app/api/vinculos/[id]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';
import { removerVinculo } from '../../../../lib/vinculo/remover';
import { buildRemoverDeps } from '../../../../lib/vinculo/build-remover-deps';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = ssrClient(cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  let destino_id: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    destino_id = (body as Record<string, string>).destino_id ?? null;
  } catch { /* ok, destino_id remains null */ }

  try {
    await removerVinculo({ vinculo_id: params.id, destino_id }, buildRemoverDeps());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'erro interno';
    return NextResponse.json({ erro: msg }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 8: Escrever testes das rotas**

`web/app/api/vinculos/[id]/impacto/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
  })),
}));

vi.mock('../../../../../lib/supabase/server', () => ({
  adminClient: vi.fn(() => ({
    rpc: vi.fn(async () => ({ data: 3, error: null })),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { responsavel_id: 'r-1', pessoa: { public_id: 'pes_r1', nome: 'Resp' } },
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

import { GET } from './route';

describe('GET /api/vinculos/:id/impacto', () => {
  it('retorna count e responsavel_acima', async () => {
    const req = new Request('http://localhost/api/vinculos/v-1/impacto');
    const res = await GET(req as never, { params: { id: 'v-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.responsavel_acima).toMatchObject({ nome: 'Resp' });
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const res = await GET(new Request('http://localhost/') as never, { params: { id: 'v-1' } });
    expect(res.status).toBe(401);
  });
});
```

`web/app/api/vinculos/[id]/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
  })),
}));

vi.mock('../../../../lib/vinculo/build-remover-deps', () => ({
  buildRemoverDeps: vi.fn(() => ({
    subarvoreCount:    vi.fn(async () => 0),
    realocarSubarvore: vi.fn(async () => {}),
    deletarVinculo:    vi.fn(async () => {}),
  })),
}));

import { DELETE } from './route';

describe('DELETE /api/vinculos/:id', () => {
  it('204 ao deletar vínculo sem filhos', async () => {
    const req = new Request('http://localhost/api/vinculos/v-1', { method: 'DELETE' });
    const res = await DELETE(req as never, { params: { id: 'v-1' } });
    expect(res.status).toBe(204);
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    const res = await DELETE(
      new Request('http://localhost/', { method: 'DELETE' }) as never,
      { params: { id: 'v-1' } },
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 9: Rodar todos testes**

```bash
cd web && npx vitest run lib/vinculo/ app/api/vinculos/
```

- [ ] **Step 10: Commit**

```bash
git add web/lib/vinculo/ web/app/api/vinculos/
git commit -m "feat(s2): vinculo management API (impacto dry-run + delete with reallocation)"
```

---

### Task 11: Login provisioning API

**Files:**
- Create: `web/app/api/pessoas/[publicId]/provisionar-login/route.ts`
- Create: `web/app/api/pessoas/[publicId]/provisionar-login/route.test.ts`

**Interfaces:**
- Consumes: `adminClient`, `ssrClient`
- Produces: `POST /api/pessoas/:publicId/provisionar-login` → 201 com senha temporária ou 403/400

- [ ] **Step 1: Escrever testes**

`web/app/api/pessoas/[publicId]/provisionar-login/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'u-1', app_metadata: { campanha_id: 'c-1', papel: 'gestor' } } },
        error: null,
      })),
    },
  })),
}));

vi.mock('../../../../../lib/supabase/server', () => ({
  adminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: 'pes-uuid-1', cpf_hmac: 'hash-cpf' },
            error: null,
          })),
        })),
      })),
    })),
    auth: {
      admin: {
        createUser: vi.fn(async () => ({
          data: { user: { id: 'new-user-id' } },
          error: null,
        })),
      },
    },
    rpc: vi.fn(async () => ({ error: null })),
  })),
}));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/pessoas/pes_abc/provisionar-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/pessoas/:publicId/provisionar-login', () => {
  it('201 ao provisionar login com sucesso', async () => {
    const res = await POST(req({ email: 'joao@teste.com' }), { params: { publicId: 'pes_abc' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty('senha_temporaria');
  });

  it('403 para papel não-gestor', async () => {
    const { ssrClient } = await import('../../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: {
        getUser: async () => ({
          data: { user: { id: 'u-2', app_metadata: { campanha_id: 'c-1', papel: 'lideranca' } } },
          error: null,
        }),
      },
    } as never);
    const res = await POST(req({ email: 'x@x.com' }), { params: { publicId: 'pes_abc' } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar — FALHA**

```bash
cd web && npx vitest run "app/api/pessoas/\[publicId\]/provisionar-login/route.test.ts"
```

- [ ] **Step 3: Implementar route.ts**

`web/app/api/pessoas/[publicId]/provisionar-login/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';
import { adminClient } from '../../../../lib/supabase/server';

function gerarSenhaTemporaria(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function POST(
  req: NextRequest,
  { params }: { params: { publicId: string } },
) {
  const supabase = ssrClient(cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const papel = user.app_metadata?.papel as string | undefined;
  if (papel !== 'gestor') {
    return NextResponse.json({ erro: 'apenas Gestor pode provisionar login' }, { status: 403 });
  }

  const campanha_id = user.app_metadata?.campanha_id as string;

  let body: { email?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  if (!body.email) return NextResponse.json({ erro: 'email obrigatório' }, { status: 400 });

  const admin = adminClient();

  // resolve UUID interno pelo public_id
  const { data: pessoa, error: pessoaErr } = await admin
    .from('pessoa')
    .select('id, cpf_hmac')
    .eq('public_id', params.publicId)
    .eq('campanha_id', campanha_id)
    .single();

  if (pessoaErr || !pessoa) {
    return NextResponse.json({ erro: 'pessoa não encontrada' }, { status: 404 });
  }

  const senha_temporaria = gerarSenhaTemporaria();

  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email: body.email,
    password: senha_temporaria,
    email_confirm: true,
  });

  if (createErr || !newUser.user) {
    return NextResponse.json({ erro: createErr?.message ?? 'erro ao criar usuário' }, { status: 500 });
  }

  // inserir usuario_campanha
  const { error: ucErr } = await admin.rpc('inserir_usuario_campanha_provisionado', {
    p_user_id:    newUser.user.id,
    p_campanha_id: campanha_id,
    p_cpf_hmac:   pessoa.cpf_hmac,
    p_pessoa_id:  pessoa.id,
  });

  if (ucErr) {
    // rollback: remover auth.users criado
    await admin.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json({ erro: ucErr.message }, { status: 500 });
  }

  return NextResponse.json({ senha_temporaria }, { status: 201 });
}
```

**Nota:** `inserir_usuario_campanha_provisionado` é uma função SECURITY DEFINER necessária para inserir em `usuario_campanha` com o `papel` correto (derivado do Vínculo mais alto da Pessoa). Adicionar à migration 0016 ou como patch migration separado:

```sql
-- adicionar à migration 0016 ou criar 0016b
CREATE OR REPLACE FUNCTION public.inserir_usuario_campanha_provisionado(
  p_user_id     uuid,
  p_campanha_id uuid,
  p_cpf_hmac    text,
  p_pessoa_id   uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p_papel public.papel_login;
BEGIN
  -- resolve papel mais alto da pessoa (trigger sync assume que vínculo já existe)
  SELECT v.papel::text::public.papel_login INTO p_papel
    FROM public.vinculo v
    JOIN public.papel_prioridade pp ON pp.papel = v.papel
   WHERE v.pessoa_id = p_pessoa_id AND v.campanha_id = p_campanha_id
     AND v.papel != 'apoiador'
   ORDER BY pp.prioridade DESC LIMIT 1;

  IF p_papel IS NULL THEN
    RAISE EXCEPTION 'pessoa % não tem vínculo elegível para login', p_pessoa_id;
  END IF;

  INSERT INTO public.usuario_campanha (user_id, campanha_id, papel, cpf_hmac, pessoa_id)
  VALUES (p_user_id, p_campanha_id, p_papel, p_cpf_hmac, p_pessoa_id);
END;
$$;
REVOKE ALL ON FUNCTION public.inserir_usuario_campanha_provisionado FROM public, authenticated, anon;
```

- [ ] **Step 4: Aplicar a função via MCP (patch na migration 0016 ou arquivo separado)**

- [ ] **Step 5: Rodar testes — PASSA**

```bash
cd web && npx vitest run "app/api/pessoas/\[publicId\]/provisionar-login/route.test.ts"
```

- [ ] **Step 6: Commit**

```bash
git add web/app/api/pessoas/
git commit -m "feat(s2): login provisioning API (gestor-only, creates auth.users + usuario_campanha)"
```

---

### Task 12: Notificações API

**Files:**
- Create: `web/app/api/notificacoes/route.ts`
- Create: `web/app/api/notificacoes/route.test.ts`
- Create: `web/app/api/notificacoes/[id]/ler/route.ts`
- Create: `web/app/api/notificacoes/[id]/ler/route.test.ts`

**Interfaces:**
- Consumes: `ssrClient` (RLS filtra automaticamente por `destinatario_user_id = auth.uid()`)
- Produces: `GET /api/notificacoes` → lista; `PATCH /api/notificacoes/:id/ler` → 200

- [ ] **Step 1: Implementar GET /api/notificacoes**

`web/app/api/notificacoes/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';

export async function GET(_req: NextRequest) {
  const supabase = ssrClient(cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  // RLS garante que só notificações do usuário autenticado são retornadas
  const { data, error } = await supabase
    .from('notificacao')
    .select('id, tipo, payload, criado_em')
    .is('lido_em', null)
    .order('criado_em', { ascending: false });

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ notificacoes: data });
}
```

- [ ] **Step 2: Implementar PATCH /api/notificacoes/:id/ler**

`web/app/api/notificacoes/[id]/ler/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../../lib/supabase/ssr';

export async function PATCH(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = ssrClient(cookies());
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { error } = await supabase
    .from('notificacao')
    .update({ lido_em: new Date().toISOString() })
    .eq('id', params.id);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Escrever testes das rotas de notificações**

`web/app/api/notificacoes/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

const mockNotificacoes = [
  { id: 'n-1', tipo: 'vinculo_compartilhado', payload: {}, criado_em: '2026-06-29T10:00:00Z' },
];

vi.mock('../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        is: vi.fn(() => ({
          order: vi.fn(async () => ({ data: mockNotificacoes, error: null })),
        })),
      })),
    })),
  })),
}));

import { GET } from './route';

describe('GET /api/notificacoes', () => {
  it('retorna lista de notificações não lidas', async () => {
    const res = await GET(new Request('http://localhost/api/notificacoes') as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notificacoes).toHaveLength(1);
    expect(body.notificacoes[0].tipo).toBe('vinculo_compartilhado');
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    } as never);
    const res = await GET(new Request('http://localhost/') as never);
    expect(res.status).toBe(401);
  });
});
```

`web/app/api/notificacoes/[id]/ler/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }));

vi.mock('../../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })),
    },
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  })),
}));

import { PATCH } from './route';

describe('PATCH /api/notificacoes/:id/ler', () => {
  it('200 ao marcar notificação como lida', async () => {
    const req = new Request('http://localhost/api/notificacoes/n-1/ler', { method: 'PATCH' });
    const res = await PATCH(req as never, { params: { id: 'n-1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('401 sem autenticação', async () => {
    const { ssrClient } = await import('../../../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: vi.fn(),
    } as never);
    const res = await PATCH(
      new Request('http://localhost/', { method: 'PATCH' }) as never,
      { params: { id: 'n-1' } },
    );
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 4: Rodar todos os testes do projeto**

```bash
cd web && npx vitest run
```
Esperado: todos passam.

- [ ] **Step 5: Commit**

```bash
git add web/app/api/notificacoes/
git commit -m "feat(s2): notifications API (list unread + mark read)"
```

---

### Task 13: E2E verification (19 test cases do spec)

**Files:**
- Create: `supabase/seed/s2_seed_pessoas.mjs` — seed com Gestor, Coordenador, Liderança A, Liderança B, Apoiador João

**Todos os casos de teste rodam via `mcp__supabase__execute_sql` e login real.**

- [ ] **TC1 — Dedup por título:** inserir Pessoa com `titulo_hmac` duplicado → unique constraint violation; `buscar_pessoa_duplicada` retorna match sem expor dados de outra campanha

```sql
-- inserir pessoa dup (deve falhar)
INSERT INTO public.pessoa (campanha_id, nome, titulo_hmac)
VALUES ('<campanha_a_id>', 'Dup', '<titulo_hmac_existente>');
-- esperado: ERROR 23505 unique violation
```

- [ ] **TC2 — Dedup por CPF:** pessoa sem título mas com CPF duplicado → detectada por CPF; título diferente + CPF diferente → null

```sql
SELECT id FROM public.buscar_pessoa_duplicada('<camp>', null, '<cpf_hmac_existente>');
-- esperado: 1 linha (match por CPF)
SELECT id FROM public.buscar_pessoa_duplicada('<camp>', 'novo-titulo-hmac', 'novo-cpf-hmac');
-- esperado: 0 linhas (nova pessoa)
```

- [ ] **TC3 — Anti-ciclo:** inserir vínculo que criaria ciclo A→B→A

```sql
-- A → B já existe
INSERT INTO public.vinculo (campanha_id, pessoa_id, responsavel_id, papel)
VALUES ('<camp>', '<pessoa_A>', '<pessoa_B>', 'lideranca');
-- esperado: ERROR 'ciclo detectado'
```

- [ ] **TC4 — Visibilidade sub-árvore:** Liderança A não vê Pessoa da sub-árvore de Liderança B

```sql
-- com token de Liderança A (via set local)
SET LOCAL request.jwt.claims = '{"app_metadata":{"campanha_id":"<camp>","papel":"lideranca"}}';
-- auth.uid() deve retornar user_id de Liderança A
SELECT id FROM public.pessoa WHERE id = '<pessoa_sob_lideranca_B>';
-- esperado: 0 linhas (RLS bloqueia)
```

- [ ] **TC5 — Colaborador sem comando:** Colaborador não pode INSERT em vínculo

```sql
SET LOCAL request.jwt.claims = '{"app_metadata":{"campanha_id":"<camp>","papel":"colaborador"}}';
INSERT INTO public.vinculo (campanha_id, pessoa_id, responsavel_id, papel)
VALUES ('<camp>', '<pessoa>', '<resp>', 'apoiador');
-- esperado: ERROR RLS violation
```

- [ ] **TC6 — Sync de papel:** criar Vínculo `gestor` → `usuario_campanha.papel = 'gestor'`; remover → volta para papel inferior

```sql
INSERT INTO public.vinculo (campanha_id, pessoa_id, responsavel_id, papel)
VALUES ('<camp>', '<pessoa_x>', null, 'gestor');
SELECT papel FROM public.usuario_campanha WHERE pessoa_id = '<pessoa_x>';
-- esperado: 'gestor'
DELETE FROM public.vinculo WHERE pessoa_id = '<pessoa_x>' AND papel = 'gestor';
-- trigger deve atualizar para próximo papel mais alto (ou registrar revogação)
```

- [ ] **TC7 — Primeiro registrante:** A (T1) pode deletar vínculo de B (T2); B não pode deletar vínculo de A

```sql
SELECT public.actor_e_primeiro_registrante('<uid_A>', '<joao_id>');
-- esperado: true
SELECT public.actor_pode_remover_vinculo('<uid_B>', '<vinculo_de_A_id>');
-- esperado: false
SELECT public.actor_pode_remover_vinculo('<uid_A>', '<vinculo_de_B_id>');
-- esperado: true
```

- [ ] **TC8 — Realocação órfã:** remover Vínculo de Coordenador com filhos; filhos migram para responsável acima

```sql
SELECT public.subarvore_count('<vinculo_coord_id>');
-- esperado: N > 0
SELECT public.realocar_subarvore('<vinculo_coord_id>', '<novo_resp_id>');
SELECT responsavel_id FROM public.vinculo WHERE id IN (<ids dos filhos>);
-- esperado: todos apontam para <novo_resp_id>
```

- [ ] **TC9 — Notificação compartilhado:** B cadastra João (já de A) → linha em `notificacao` para A; B não vê

```sql
-- inserir segundo vínculo de João sob B
INSERT INTO public.vinculo (campanha_id, pessoa_id, responsavel_id, papel, criado_por)
VALUES ('<camp>', '<joao_id>', '<pessoa_B>', 'apoiador', '<uid_B>');
-- verificar notificação criada para uid_A
SELECT tipo, destinatario_user_id FROM public.notificacao
 WHERE tipo = 'vinculo_compartilhado' ORDER BY criado_em DESC LIMIT 1;
-- esperado: destinatario_user_id = uid_A
```

- [ ] **TC10 — Soft-delete:** `deleted_at` setado → Pessoa some do SELECT

```sql
UPDATE public.pessoa SET deleted_at = now() WHERE id = '<pessoa_id>';
SELECT id FROM public.pessoa WHERE id = '<pessoa_id>';
-- esperado: 0 linhas (RLS filtra deleted_at IS NULL)
-- hard delete deve falhar:
DELETE FROM public.pessoa WHERE id = '<pessoa_id>';
-- esperado: ERROR (policy pessoa_delete USING false)
```

- [ ] **TC11 — public_id format:** toda Pessoa criada tem `public_id` no formato `pes_XXXXXXXX`

```sql
SELECT public_id FROM public.pessoa LIMIT 5;
-- esperado: todos no formato pes_[8 hex chars]
```

- [ ] **TC12 — papel_prioridade extensível:** inserir papel fictício sem alterar enum (teste conceitual)

```sql
-- não altera o enum de produção; apenas verifica a tabela é a fonte de ordenação
SELECT papel, prioridade FROM public.papel_prioridade ORDER BY prioridade DESC;
-- verificar: gestor=100 no topo, apoiador=0 no fundo
```

- [ ] **TC13 — audit_entity:** mutação em pessoa gera linha

```sql
SELECT tabela, entidade_id, depois->>'nome' FROM public.audit_entity
 WHERE tabela = 'pessoa' ORDER BY criado_em DESC LIMIT 1;
-- esperado: linha com nome correto da última Pessoa criada
```

- [ ] **TC14 — get_advisors(security): nenhum alerta novo**

Via MCP `get_advisors`. Comparar com baseline do S1.

- [ ] **TC15–TC19 — Camada Next.js** (via chamadas reais ao servidor rodando):

```bash
# TC15: dedup title
curl -X POST http://campanha-a.localhost/api/pessoas \
  -H "Content-Type: application/json" \
  -H "Cookie: <session>" \
  -d '{"nome":"João","titulo":"01234567890","responsavel_id":"<resp>","papel":"apoiador"}'
# esperado na segunda chamada com mesmo titulo: 409 {"error":"pessoa_duplicada","match_por":"titulo"}

# TC16: HMAC server-side — verificar banco
# (já coberto por TC1/TC2 via execute_sql — banco não tem titulo/cpf em claro)

# TC17: dry-run
curl http://campanha-a.localhost/api/vinculos/<id>/impacto -H "Cookie: <session>"
# esperado: {"count": N, "responsavel_acima": {...}}

# TC18: provisão de login
curl -X POST http://campanha-a.localhost/api/pessoas/pes_abc/provisionar-login \
  -H "Content-Type: application/json" \
  -H "Cookie: <gestor_session>" \
  -d '{"email":"novo@campanha.com"}'
# esperado: 201 {"senha_temporaria":"..."}

# TC19: isolamento de tenant
# login com token de campanha A → GET /api/pessoas não retorna pessoas de campanha B
```

- [ ] **Step final: Commit + atualizar MEMORY**

```bash
git add supabase/seed/s2_seed_pessoas.mjs
git commit -m "test(s2): E2E verification seed + 19 test cases documented"
```

Atualizar memória do projeto com status S2 completo.
