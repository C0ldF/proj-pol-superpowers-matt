# Fatia E — Cadastro de Pessoas e Vínculos (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first UI for the Pessoa+Vínculo graph (backend from S2, 2026-06-30) — cadastrar, listar, ver detalhe, remover vínculo — closing the gap where the product's core data has no way to be entered except manual SQL.

**Architecture:** 3 new read endpoints (`GET /api/pessoas`, `GET /api/pessoas/[publicId]`, `GET /api/secoes`) built on RLS policies that already exist (`pessoa_select`/`vinculo_select`), 1 small migration (`secao_id` added to the existing create RPC), and 3 new pages (`/pessoas`, `/pessoas/novo`, `/pessoas/[publicId]`) using the design system that's already complete project-wide. A new small `ResponsavelAutocomplete` component is shared by the create form and the remove-vínculo modal.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Supabase (Postgres + RLS + RPC), Vitest + Testing Library + jsdom.

## Global Constraints

- Design tokens only — reuse `Input`/`Button`/`Message` (`web/app/components/`), no new shared components beyond `ResponsavelAutocomplete` (justified: 2 uses).
- CPF is **never** displayed anywhere in this fatia — the `pessoa` table has no `cpf_enc` column, only `cpf_hmac` (irreversible). Título **is** displayed, decrypted server-side via `decryptTitulo()` (`web/lib/titulo-enc.ts`).
- `base_legal`/`origem_coleta` stay hardcoded (`legitimointeresse`/`manual`) — not exposed in any form this fatia builds.
- Nenhum endpoint novo usa `SECURITY DEFINER` pra ler `pessoa`/`vinculo` — toda leitura passa por `ssrClient` (RLS do usuário), nunca `adminClient`, pra herdar `pessoa_select`/`vinculo_select` automaticamente.
- `DELETE /api/vinculos/[id]` (já existe, não muda nesta fatia) só realoca a sub-árvore se o body trouxer `destino_id` — toda chamada desta fatia **sempre** envia esse campo (nunca omite).
- Autocomplete de "Responsável" só mostra Pessoas com vínculo de papel `gestor`, `coordenador` ou `lideranca` — filtro client-side, não imposto pelo backend (débito técnico documentado no spec, não corrigido nesta fatia).
- Botão "Remover vínculo" fica desabilitado quando `responsavel_acima` vem `null` no `GET .../impacto` (vínculo raiz do Gestor) **ou** quando é o único vínculo da Pessoa (`vinculos.length === 1` — remover deixaria a Pessoa sem vínculo nenhum, invisível pra RLS mas não apagada, ver spec decisão 14).
- Busca de pessoa usa `public.normalizar_texto()` (já existe, `lower(trim(unaccent(...)))`) — case-insensitive e acento-insensitive, **substring sobre `nome` apenas** (spec decisão 3). CPF não é buscável por design (só existe como hash irreversível, `cpf_hmac`); título não é buscável nesta fatia.
- **Sem paginação em `GET /api/pessoas`** (spec decisão 3) — lista tudo que a RLS libera, `ORDER BY nome ASC`. Débito documentado: vira requisito se o volume passar de algumas centenas de pessoas por campanha.
- Todas as páginas novas seguem o padrão `redirect('/login')` já usado em `/dashboard`/`/mapa-calor` (não o padrão inline do namespace `/superadmin/*`).
- **Sem arquivo de tipos compartilhado** (`types/pessoa.ts` ou similar) — mesmo padrão já estabelecido em `DashboardSuperadminClient.tsx`/`MapaCalorClient.tsx`/`RankingTable.tsx`: cada componente define localmente o tipo que casa com a resposta do endpoint que ele consome. Nenhum arquivo de tipos central existe no projeto hoje; introduzir um agora seria mudança de convenção unilateral, fora do escopo desta fatia.
- Test runner: from `web/`, `npx vitest run <path>` for a single file, `npm test` for the whole suite.

---

## File Structure

- **Migration** (via Supabase MCP `apply_migration`, projeto `axcftjqdjvknrpqzrxls`): `criar_pessoa_com_vinculo` ganha `p_secao_id uuid DEFAULT NULL`; nova função `buscar_pessoas(p_q text DEFAULT NULL)`.
- **Modify** `web/lib/pessoa/criar.ts`, `web/lib/pessoa/build-criar-deps.ts`, `web/app/api/pessoas/route.ts` (ganha `secao_id` no `POST`, ganha `GET`).
- **Create** `web/app/api/pessoas/[publicId]/route.ts`, `web/app/api/secoes/route.ts`.
- **Modify** `web/app/components/NavShell.tsx` (+1 link).
- **Create** `web/app/pessoas/ResponsavelAutocomplete.tsx` (compartilhado).
- **Create** `web/app/pessoas/page.tsx` + `web/app/pessoas/PessoasListClient.tsx`.
- **Create** `web/app/pessoas/novo/page.tsx` + `web/app/pessoas/novo/NovaPessoaClient.tsx`.
- **Create** `web/app/pessoas/[publicId]/page.tsx` + `web/app/pessoas/[publicId]/PessoaDetalheClient.tsx`.

---

### Task 1: `secao_id` no fluxo de criação

**Files:**
- Modify: `web/lib/pessoa/criar.ts`, `web/lib/pessoa/build-criar-deps.ts`, `web/app/api/pessoas/route.ts`
- Test: `web/lib/pessoa/criar.test.ts`, `web/app/api/pessoas/route.test.ts`
- Migration: `criar_pessoa_com_vinculo` (Supabase MCP)

**Interfaces:**
- Produces: `CriarPessoaInput.secao_id?: string`, `CriarPessoaDeps.criarPessoaComVinculo(params: { ...; secao_id: string | null })`.

- [ ] **Step 1: Aplicar a migration**

Rodar via `apply_migration` (MCP Supabase, `project_id: axcftjqdjvknrpqzrxls`, `name: criar_pessoa_com_vinculo_secao`):

```sql
CREATE OR REPLACE FUNCTION public.criar_pessoa_com_vinculo(
  p_campanha_id uuid, p_nome text, p_titulo_hmac text, p_titulo_enc text, p_cpf_hmac text,
  p_telefone text, p_email_contato text, p_base_legal base_legal_enum, p_origem_coleta origem_coleta_enum,
  p_responsavel_id uuid, p_papel papel_vinculo, p_criado_por uuid, p_pessoa_id_existente uuid,
  p_actor_ip inet, p_actor_ua text, p_secao_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  nova_pessoa_id  uuid;
  novo_vinculo_id uuid;
  nova_public_id  text;
BEGIN
  IF NOT public.actor_pode_criar_vinculo_sob(p_criado_por, p_responsavel_id, p_papel) THEN
    RAISE EXCEPTION 'não autorizado: actor % não pode criar vínculo % sob %',
      p_criado_por, p_papel, p_responsavel_id;
  END IF;

  IF p_pessoa_id_existente IS NOT NULL THEN
    nova_pessoa_id := p_pessoa_id_existente;
    SELECT public_id INTO nova_public_id FROM public.pessoa WHERE id = nova_pessoa_id;
  ELSE
    INSERT INTO public.pessoa (
      campanha_id, nome, titulo_hmac, titulo_enc, cpf_hmac,
      telefone, email_contato, base_legal, origem_coleta, secao_id
    ) VALUES (
      p_campanha_id, p_nome, p_titulo_hmac, p_titulo_enc, p_cpf_hmac,
      p_telefone, p_email_contato, p_base_legal, p_origem_coleta, p_secao_id
    ) RETURNING id, public_id INTO nova_pessoa_id, nova_public_id;

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

  RETURN jsonb_build_object(
    'pessoa_id', nova_pessoa_id,
    'vinculo_id', novo_vinculo_id,
    'public_id', nova_public_id
  );
END;
$function$;
```

`p_secao_id` vai no **final** da lista de parâmetros (não junto dos outros campos de pessoa) porque o Postgres exige que todo parâmetro com `DEFAULT` venha depois de todos os sem default — é o único novo parâmetro opcional, os demais continuam obrigatórios.

Verificar com `execute_sql`:
```sql
select pg_get_functiondef(oid) from pg_proc where proname='criar_pessoa_com_vinculo';
```
Expected: a definição mostra `p_secao_id uuid DEFAULT NULL` no fim da assinatura e `secao_id` no `INSERT INTO public.pessoa`.

- [ ] **Step 2: Teste falhando em `criar.ts`**

Em `web/lib/pessoa/criar.test.ts`, adicionar dentro do `describe('criarPessoa', ...)`:

```ts
  it('propaga secao_id pro criarPessoaComVinculo quando informado', async () => {
    const deps = makeDeps();
    await criarPessoa({ ...input, secao_id: 'secao-1' }, deps);
    expect(deps.criarPessoaComVinculo).toHaveBeenCalledWith(
      expect.objectContaining({ secao_id: 'secao-1' })
    );
  });

  it('passa secao_id null quando não informado', async () => {
    const deps = makeDeps();
    await criarPessoa(input, deps);
    expect(deps.criarPessoaComVinculo).toHaveBeenCalledWith(
      expect.objectContaining({ secao_id: null })
    );
  });
```

- [ ] **Step 3: Rodar teste, ver falhar**

Run: `npx vitest run lib/pessoa/criar.test.ts`
Expected: FAIL — `CriarPessoaInput` ainda não tem `secao_id`, TypeScript não compila ou o mock recebe `undefined` em vez de `null`/`'secao-1'`.

- [ ] **Step 4: Implementar em `criar.ts`**

Em `web/lib/pessoa/criar.ts`, atualizar as 2 interfaces e o corpo de `criarPessoa`:

```ts
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
    secao_id: string | null;
  }): Promise<{ pessoa_id: string; vinculo_id: string; public_id?: string }>;
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
  secao_id?: string;
  ip?: string;
  user_agent?: string;
}

type CriarPessoaResult =
  | { tipo: 'criado'; pessoa_id: string; vinculo_id: string; public_id?: string }
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
    secao_id:             input.secao_id ?? null,
  });

  return { tipo: 'criado', ...res };
}
```

- [ ] **Step 5: Rodar teste, ver passar**

Run: `npx vitest run lib/pessoa/criar.test.ts`
Expected: PASS (todos os casos, incluindo os 2 novos).

- [ ] **Step 6: Propagar em `build-criar-deps.ts` e no `POST` de `route.ts`**

Em `web/lib/pessoa/build-criar-deps.ts`, dentro de `criarPessoaComVinculo`, adicionar o parâmetro no `rpc`:

```ts
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
        p_secao_id:             params.secao_id,
      });
      if (error) throw error;
      return data as { pessoa_id: string; vinculo_id: string; public_id: string };
    },
```

Em `web/app/api/pessoas/route.ts`, no `POST`, destructure `secao_id` do body e repasse:

```ts
  const { nome, titulo, cpf, telefone, email_contato,
          responsavel_id, papel, confirmar_compartilhado, secao_id } = body as Record<string, string | boolean | undefined>;

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
    secao_id: secao_id as string | undefined,
    ip,
    user_agent,
  }, deps);
```

(o resto do `POST` — tratamento de `duplicata`, resposta `201` — fica igual)

- [ ] **Step 7: Teste do `POST` aceitando `secao_id`**

Em `web/app/api/pessoas/route.test.ts`, dentro do mock de `buildCriarDeps`, o `criarPessoaComVinculo` já é um `vi.fn()` — adicionar um novo teste:

```ts
  it('repassa secao_id do body pro criarPessoa', async () => {
    const { buildCriarDeps } = await import('../../../lib/pessoa/build-criar-deps');
    const deps = await vi.mocked(buildCriarDeps)();
    await POST(req({ nome: 'Ana', responsavel_id: 'r-1', papel: 'apoiador', secao_id: 'secao-9' }));
    expect(deps.criarPessoaComVinculo).toHaveBeenCalledWith(
      expect.objectContaining({ secao_id: 'secao-9' })
    );
  });
```

- [ ] **Step 8: Rodar suite completa do arquivo**

Run: `npx vitest run app/api/pessoas/route.test.ts lib/pessoa/criar.test.ts`
Expected: PASS (todos os casos, novos e antigos).

- [ ] **Step 9: Commit**

```bash
git add web/lib/pessoa/criar.ts web/lib/pessoa/criar.test.ts web/lib/pessoa/build-criar-deps.ts web/app/api/pessoas/route.ts web/app/api/pessoas/route.test.ts
git commit -m "feat(pessoas): secao_id opcional no fluxo de criacao (ancora no mapa de calor)"
```

---

### Task 2: `GET /api/pessoas` (lista + busca)

**Files:**
- Modify: `web/app/api/pessoas/route.ts` (ganha `GET`)
- Test: `web/app/api/pessoas/route.test.ts`
- Migration: nova função `buscar_pessoas`

**Interfaces:**
- Produces: `GET /api/pessoas?q=<termo>` → `200 { pessoas: [{ public_id: string; nome: string; vinculos: [{ id: string; papel: string; responsavel: { public_id: string; nome: string } | null }] }] }`.

- [ ] **Step 1: Aplicar a migration**

Via `apply_migration` (`name: buscar_pessoas`):

```sql
CREATE OR REPLACE FUNCTION public.buscar_pessoas(p_q text DEFAULT NULL)
 RETURNS TABLE(
   pessoa_public_id text,
   pessoa_nome text,
   vinculo_id uuid,
   papel public.papel_vinculo,
   responsavel_public_id text,
   responsavel_nome text
 )
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT
    p.public_id,
    p.nome,
    v.id,
    v.papel,
    rp.public_id,
    rp.nome
  FROM public.pessoa p
  JOIN public.vinculo v ON v.pessoa_id = p.id
  LEFT JOIN public.pessoa rp ON rp.id = v.responsavel_id
  WHERE p.deleted_at IS NULL
    AND (p_q IS NULL OR public.normalizar_texto(p.nome) LIKE '%' || public.normalizar_texto(p_q) || '%')
  ORDER BY p.nome ASC;
$function$;
```

**Sem `SECURITY DEFINER`** — de propósito. É `SECURITY INVOKER` (o default quando a palavra-chave é omitida), então roda com o papel de quem chama; as policies `pessoa_select`/`vinculo_select` (já existentes, usam `actor_pode_ver_pessoa`) se aplicam automaticamente às 2 tabelas dentro da função, sem reimplementar a lógica de visibilidade. `public.normalizar_texto` (já existe desde o S3) faz `lower(trim(unaccent(...)))`.

Verificar:
```sql
select pg_get_functiondef(oid) from pg_proc where proname='buscar_pessoas';
```
Expected: sem `SECURITY DEFINER` na definição.

- [ ] **Step 2: Teste falhando pro `GET`**

Em `web/app/api/pessoas/route.test.ts`, adicionar (mockando `ssrClient` com um `rpc` que devolve linhas planas):

```ts
describe('GET /api/pessoas', () => {
  it('agrupa vínculos por pessoa e retorna 200', async () => {
    const { ssrClient } = await import('../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
      rpc: vi.fn(async () => ({
        data: [
          { pessoa_public_id: 'pes_a', pessoa_nome: 'Ana', vinculo_id: 'v-1', papel: 'apoiador', responsavel_public_id: 'pes_r', responsavel_nome: 'Resp' },
          { pessoa_public_id: 'pes_a', pessoa_nome: 'Ana', vinculo_id: 'v-2', papel: 'apoiador', responsavel_public_id: 'pes_r2', responsavel_nome: 'Resp2' },
        ],
        error: null,
      })),
    } as never);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/pessoas?q=an'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pessoas).toHaveLength(1);
    expect(body.pessoas[0].vinculos).toHaveLength(2);
    expect(body.pessoas[0].vinculos[0].responsavel).toEqual({ public_id: 'pes_r', nome: 'Resp' });
  });

  it('401 sem usuário autenticado', async () => {
    const { ssrClient } = await import('../../../lib/supabase/ssr');
    vi.mocked(ssrClient).mockReturnValueOnce({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    } as never);
    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/api/pessoas'));
    expect(res.status).toBe(401);
  });
});
```

Adicionar `import { NextRequest } from 'next/server';` no topo do arquivo de teste, junto dos imports já existentes.

- [ ] **Step 3: Rodar teste, ver falhar**

Run: `npx vitest run app/api/pessoas/route.test.ts`
Expected: FAIL — `route.ts` ainda não exporta `GET`.

- [ ] **Step 4: Implementar o `GET`**

Em `web/app/api/pessoas/route.ts`, adicionar (mantendo o `POST` já existente intacto):

```ts
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q');

  const { data, error } = await supabase.rpc('buscar_pessoas', { p_q: q });
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  type Linha = {
    pessoa_public_id: string;
    pessoa_nome: string;
    vinculo_id: string;
    papel: string;
    responsavel_public_id: string | null;
    responsavel_nome: string | null;
  };

  const porPessoa = new Map<string, {
    public_id: string;
    nome: string;
    vinculos: Array<{ id: string; papel: string; responsavel: { public_id: string; nome: string } | null }>;
  }>();

  for (const row of (data ?? []) as Linha[]) {
    if (!porPessoa.has(row.pessoa_public_id)) {
      porPessoa.set(row.pessoa_public_id, { public_id: row.pessoa_public_id, nome: row.pessoa_nome, vinculos: [] });
    }
    porPessoa.get(row.pessoa_public_id)!.vinculos.push({
      id: row.vinculo_id,
      papel: row.papel,
      responsavel: row.responsavel_public_id
        ? { public_id: row.responsavel_public_id, nome: row.responsavel_nome! }
        : null,
    });
  }

  return NextResponse.json({ pessoas: Array.from(porPessoa.values()) });
}
```

Adicionar `NextRequest` ao import já existente do `next/server` no topo do arquivo (`import { NextRequest, NextResponse } from 'next/server';`).

- [ ] **Step 5: Rodar teste, ver passar**

Run: `npx vitest run app/api/pessoas/route.test.ts`
Expected: PASS (todos os casos, `GET` e `POST`).

- [ ] **Step 6: Commit**

```bash
git add web/app/api/pessoas/route.ts web/app/api/pessoas/route.test.ts
git commit -m "feat(pessoas): GET /api/pessoas — lista com busca por nome (sem acento)"
```

---

### Task 3: `GET /api/pessoas/[publicId]` (detalhe)

**Files:**
- Create: `web/app/api/pessoas/[publicId]/route.ts`
- Test: `web/app/api/pessoas/[publicId]/route.test.ts`

**Interfaces:**
- Consumes: `decryptTitulo` de `web/lib/titulo-enc.ts` (já existe, Task 1 do S2).
- Produces: `GET /api/pessoas/[publicId]` → `200 { public_id, nome, telefone, email_contato, titulo: string|null, secao: {zona_numero,secao_numero}|null, base_legal, data_coleta, vinculos: [...] }` ou `404`.

- [ ] **Step 1: Escrever o teste**

Criar `web/app/api/pessoas/[publicId]/route.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('../../../../lib/titulo-enc', () => ({ decryptTitulo: vi.fn(async (enc: string) => 'titulo-' + enc) }));

import { ssrClient } from '../../../../lib/supabase/ssr';
import { GET } from './route';

function ctx(publicId: string) {
  return { params: Promise.resolve({ publicId }) };
}

describe('GET /api/pessoas/[publicId]', () => {
  it('200 com título decriptado e seção resolvida', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: {
                  public_id: 'pes_abc', nome: 'Ana', telefone: '999', email_contato: 'a@a.com',
                  titulo_enc: 'enc-1', base_legal: 'legitimointeresse', data_coleta: '2026-01-01',
                  secao: { numero: 12, local: { zona: { numero: 5 } } },
                  vinculos: [{ id: 'v-1', papel: 'apoiador', responsavel: { public_id: 'pes_r', nome: 'Resp' } }],
                },
                error: null,
              })),
            })),
          })),
        })),
      })),
    } as never);

    const res = await GET(new NextRequest('http://localhost/api/pessoas/pes_abc'), ctx('pes_abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.titulo).toBe('titulo-enc-1');
    expect(body.secao).toEqual({ zona_numero: 5, secao_numero: 12 });
  });

  it('404 quando não encontrada', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u-1' } }, error: null })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              single: vi.fn(async () => ({ data: null, error: { message: 'not found' } })),
            })),
          })),
        })),
      })),
    } as never);

    const res = await GET(new NextRequest('http://localhost/api/pessoas/pes_x'), ctx('pes_x'));
    expect(res.status).toBe(404);
  });

  it('401 sem usuário autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    } as never);
    const res = await GET(new NextRequest('http://localhost/api/pessoas/pes_x'), ctx('pes_x'));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar teste, ver falhar**

Run: `npx vitest run app/api/pessoas/[publicId]/route.test.ts`
Expected: FAIL — `web/app/api/pessoas/[publicId]/route.ts` não existe.

- [ ] **Step 3: Implementar**

Criar `web/app/api/pessoas/[publicId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../../lib/supabase/ssr';
import { decryptTitulo } from '../../../../lib/titulo-enc';

type PessoaDetalheRow = {
  public_id: string;
  nome: string;
  telefone: string | null;
  email_contato: string | null;
  titulo_enc: string | null;
  base_legal: string;
  data_coleta: string;
  secao: { numero: number; local: { zona: { numero: number } | null } | null } | null;
  vinculos: Array<{ id: string; papel: string; responsavel: { public_id: string; nome: string } | null }>;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { data, error } = await supabase
    .from('pessoa')
    .select(`
      public_id, nome, telefone, email_contato, titulo_enc, base_legal, data_coleta,
      secao:secao_id ( numero, local:local_id ( zona:zona_id ( numero ) ) ),
      vinculos:vinculo!vinculo_pessoa_id_fkey ( id, papel, responsavel:pessoa!vinculo_responsavel_id_fkey ( public_id, nome ) )
    `)
    .eq('public_id', publicId)
    .is('deleted_at', null)
    .single();

  if (error || !data) {
    return NextResponse.json({ erro: 'pessoa não encontrada' }, { status: 404 });
  }

  const pessoa = data as unknown as PessoaDetalheRow;
  const titulo = pessoa.titulo_enc ? await decryptTitulo(pessoa.titulo_enc) : null;

  return NextResponse.json({
    public_id: pessoa.public_id,
    nome: pessoa.nome,
    telefone: pessoa.telefone,
    email_contato: pessoa.email_contato,
    titulo,
    secao: pessoa.secao?.local?.zona
      ? { zona_numero: pessoa.secao.local.zona.numero, secao_numero: pessoa.secao.numero }
      : null,
    base_legal: pessoa.base_legal,
    data_coleta: pessoa.data_coleta,
    vinculos: pessoa.vinculos,
  });
}
```

- [ ] **Step 4: Rodar teste, ver passar**

Run: `npx vitest run app/api/pessoas/[publicId]/route.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/pessoas/[publicId]/route.ts web/app/api/pessoas/[publicId]/route.test.ts
git commit -m "feat(pessoas): GET /api/pessoas/[publicId] — detalhe com titulo decriptado"
```

---

### Task 4: `GET /api/secoes` (busca zona/seção)

**Files:**
- Create: `web/app/api/secoes/route.ts`
- Test: `web/app/api/secoes/route.test.ts`

**Interfaces:**
- Produces: `GET /api/secoes` → `{ zonas: [{id,numero}] }`; `GET /api/secoes?zona_id=X` → `{ secoes: [{id,numero,aptos}] }`.

- [ ] **Step 1: Escrever o teste**

Criar `web/app/api/secoes/route.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

import { ssrClient } from '../../../lib/supabase/ssr';
import { GET } from './route';

describe('GET /api/secoes', () => {
  it('sem zona_id: lista zonas do municipio da campanha (municipal)', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: vi.fn(async () => ({
        data: { user: { id: 'u-1', app_metadata: { campanha_id: 'c-1' } } }, error: null,
      })) },
      from: vi.fn((table: string) => {
        if (table === 'campanha') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { municipio_id: 2211001, uf: 'PI' }, error: null }) }) }) };
        }
        if (table === 'zona_eleitoral') {
          return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: 'z-1', numero: 1 }], error: null }) }) }) };
        }
        throw new Error('tabela inesperada: ' + table);
      }),
    } as never);

    const res = await GET(new NextRequest('http://localhost/api/secoes'));
    expect(res.status).toBe(200);
    expect((await res.json()).zonas).toEqual([{ id: 'z-1', numero: 1 }]);
  });

  it('com zona_id: lista seções dos locais daquela zona', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: vi.fn(async () => ({
        data: { user: { id: 'u-1', app_metadata: { campanha_id: 'c-1' } } }, error: null,
      })) },
      from: vi.fn((table: string) => {
        if (table === 'local_votacao') {
          return { select: () => ({ eq: async () => ({ data: [{ id: 'lv-1' }], error: null }) }) };
        }
        if (table === 'secao') {
          return { select: () => ({ in: () => ({ order: async () => ({ data: [{ id: 's-1', numero: 10, aptos: 300 }], error: null }) }) }) };
        }
        throw new Error('tabela inesperada: ' + table);
      }),
    } as never);

    const res = await GET(new NextRequest('http://localhost/api/secoes?zona_id=z-1'));
    expect(res.status).toBe(200);
    expect((await res.json()).secoes).toEqual([{ id: 's-1', numero: 10, aptos: 300 }]);
  });

  it('401 sem usuário autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
    } as never);
    const res = await GET(new NextRequest('http://localhost/api/secoes'));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Rodar teste, ver falhar**

Run: `npx vitest run app/api/secoes/route.test.ts`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Implementar**

Criar `web/app/api/secoes/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ssrClient } from '../../../lib/supabase/ssr';

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const zonaId = req.nextUrl.searchParams.get('zona_id');

  if (zonaId) {
    const { data: locais, error: locaisErr } = await supabase
      .from('local_votacao')
      .select('id')
      .eq('zona_id', zonaId);
    if (locaisErr) return NextResponse.json({ erro: locaisErr.message }, { status: 500 });

    const localIds = (locais ?? []).map((l: { id: string }) => l.id);
    if (localIds.length === 0) return NextResponse.json({ secoes: [] });

    const { data: secoes, error: secoesErr } = await supabase
      .from('secao')
      .select('id, numero, aptos')
      .in('local_id', localIds)
      .order('numero', { ascending: true });
    if (secoesErr) return NextResponse.json({ erro: secoesErr.message }, { status: 500 });
    return NextResponse.json({ secoes });
  }

  const campanha_id = user.app_metadata?.campanha_id as string | undefined;
  if (!campanha_id) return NextResponse.json({ erro: 'campanha não identificada' }, { status: 400 });

  const { data: campanha, error: campanhaErr } = await supabase
    .from('campanha')
    .select('municipio_id, uf')
    .eq('id', campanha_id)
    .single();
  if (campanhaErr || !campanha) {
    return NextResponse.json({ erro: 'campanha não encontrada' }, { status: 404 });
  }

  if (campanha.municipio_id) {
    const { data: zonas, error: zonasErr } = await supabase
      .from('zona_eleitoral')
      .select('id, numero')
      .eq('municipio_id', campanha.municipio_id)
      .order('numero', { ascending: true });
    if (zonasErr) return NextResponse.json({ erro: zonasErr.message }, { status: 500 });
    return NextResponse.json({ zonas });
  }

  // Campanha estadual: lista zonas de todos os municípios da UF (não agrupa
  // por município nesta fatia — ver spec, decisão 7).
  const { data: municipios, error: municipiosErr } = await supabase
    .from('municipio')
    .select('cod_ibge')
    .eq('uf', campanha.uf);
  if (municipiosErr) return NextResponse.json({ erro: municipiosErr.message }, { status: 500 });

  const municipioIds = (municipios ?? []).map((m: { cod_ibge: number }) => m.cod_ibge);
  if (municipioIds.length === 0) return NextResponse.json({ zonas: [] });

  const { data: zonas, error: zonasErr } = await supabase
    .from('zona_eleitoral')
    .select('id, numero')
    .in('municipio_id', municipioIds)
    .order('numero', { ascending: true });
  if (zonasErr) return NextResponse.json({ erro: zonasErr.message }, { status: 500 });
  return NextResponse.json({ zonas });
}
```

- [ ] **Step 4: Rodar teste, ver passar**

Run: `npx vitest run app/api/secoes/route.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add web/app/api/secoes/route.ts web/app/api/secoes/route.test.ts
git commit -m "feat(secoes): GET /api/secoes — zonas do municipio/UF + secoes por zona"
```

---

### Task 5: `NavShell` — link "Pessoas"

**Files:**
- Modify: `web/app/components/NavShell.tsx`
- Test: `web/app/components/NavShell.test.tsx`

- [ ] **Step 1: Atualizar o teste existente**

Em `web/app/components/NavShell.test.tsx`, trocar o teste `'renderiza os 2 links de navegação e o children'` por:

```ts
  it('renderiza os 3 links de navegação e o children', () => {
    renderNav();
    expect(screen.getByText('Mapa de Calor')).toHaveAttribute('href', '/mapa-calor');
    expect(screen.getByText('Dashboard')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('Pessoas')).toHaveAttribute('href', '/pessoas');
    expect(screen.getByText('conteudo-de-teste')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Rodar teste, ver falhar**

Run: `npx vitest run app/components/NavShell.test.tsx`
Expected: FAIL — `screen.getByText('Pessoas')` não encontra nada.

- [ ] **Step 3: Implementar**

Em `web/app/components/NavShell.tsx`, atualizar `LINKS`:

```ts
const LINKS = [
  { href: '/mapa-calor', label: 'Mapa de Calor' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pessoas', label: 'Pessoas' },
];
```

- [ ] **Step 4: Rodar teste, ver passar**

Run: `npx vitest run app/components/NavShell.test.tsx`
Expected: PASS (todos os casos).

- [ ] **Step 5: Commit**

```bash
git add web/app/components/NavShell.tsx web/app/components/NavShell.test.tsx
git commit -m "feat(nav): adiciona link Pessoas ao NavShell"
```

---

### Task 6: `ResponsavelAutocomplete` (componente compartilhado)

**Files:**
- Create: `web/app/pessoas/ResponsavelAutocomplete.tsx`
- Test: `web/app/pessoas/ResponsavelAutocomplete.test.tsx`

**Interfaces:**
- Produces: `ResponsavelAutocomplete({ label, value, onChange }: { label: string; value: { public_id: string; nome: string } | null; onChange: (p: { public_id: string; nome: string } | null) => void })`.
- Consumes: `GET /api/pessoas?q=` (Task 2).

- [ ] **Step 1: Escrever o teste**

Criar `web/app/pessoas/ResponsavelAutocomplete.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ResponsavelAutocomplete } from './ResponsavelAutocomplete';

const mockPessoas = [
  { public_id: 'pes_g', nome: 'Geraldo Gestor', vinculos: [{ id: 'v-g', papel: 'gestor', responsavel: null }] },
  { public_id: 'pes_l', nome: 'Lucia Lideranca', vinculos: [{ id: 'v-l', papel: 'lideranca', responsavel: { public_id: 'pes_g', nome: 'Geraldo Gestor' } }] },
  { public_id: 'pes_ap', nome: 'Ana Apoiadora', vinculos: [{ id: 'v-ap', papel: 'apoiador', responsavel: { public_id: 'pes_l', nome: 'Lucia Lideranca' } }] },
];

describe('ResponsavelAutocomplete', () => {
  afterEach(() => cleanup());

  it('busca, filtra apoiador/colaborador fora e mostra só gestor/coordenador/lideranca', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: mockPessoas }) })) as never;
    const onChange = vi.fn();
    render(<ResponsavelAutocomplete label="Responsável" value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'ge' } });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/pessoas?q=ge');
    });
    expect(await screen.findByText('Geraldo Gestor')).toBeInTheDocument();
    expect(screen.getByText('Lucia Lideranca')).toBeInTheDocument();
    expect(screen.queryByText('Ana Apoiadora')).not.toBeInTheDocument();
  });

  it('menos de 2 caracteres não dispara busca', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: mockPessoas }) })) as never;
    render(<ResponsavelAutocomplete label="Responsável" value={null} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'g' } });
    await new Promise((r) => setTimeout(r, 350));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limita a 10 resultados no dropdown mesmo se a API devolver mais', async () => {
    const muitasPessoas = Array.from({ length: 15 }, (_, i) => ({
      public_id: `pes_${i}`, nome: `Gestor ${i}`,
      vinculos: [{ id: `v-${i}`, papel: 'gestor', responsavel: null }],
    }));
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: muitasPessoas }) })) as never;
    render(<ResponsavelAutocomplete label="Responsável" value={null} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'ge' } });
    await screen.findByText('Gestor 0');
    expect(screen.getAllByRole('button')).toHaveLength(10);
  });

  it('clicar num resultado chama onChange e fecha a lista', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: mockPessoas }) })) as never;
    const onChange = vi.fn();
    render(<ResponsavelAutocomplete label="Responsável" value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'ger' } });
    const opcao = await screen.findByText('Geraldo Gestor');
    fireEvent.click(opcao);

    expect(onChange).toHaveBeenCalledWith({ public_id: 'pes_g', nome: 'Geraldo Gestor' });
    expect(screen.queryByText('Lucia Lideranca')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar teste, ver falhar**

Run: `npx vitest run app/pessoas/ResponsavelAutocomplete.test.tsx`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Implementar**

Criar `web/app/pessoas/ResponsavelAutocomplete.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';

type Pessoa = { public_id: string; nome: string };
type PessoaComVinculos = {
  public_id: string;
  nome: string;
  vinculos: Array<{ id: string; papel: string; responsavel: Pessoa | null }>;
};

const PAPEIS_ELEGIVEIS = new Set(['gestor', 'coordenador', 'lideranca']);
const MIN_CARACTERES = 2;
const LIMITE_RESULTADOS = 10;

export function ResponsavelAutocomplete({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Pessoa | null;
  onChange: (pessoa: Pessoa | null) => void;
}) {
  const [termo, setTermo] = useState(value?.nome ?? '');
  const [resultados, setResultados] = useState<Pessoa[]>([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (termo.length < MIN_CARACTERES || (value && termo === value.nome)) {
      setResultados([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/pessoas?q=${encodeURIComponent(termo)}`)
        .then((res) => res.json())
        .then((data: { pessoas: PessoaComVinculos[] }) => {
          const elegiveis = data.pessoas.filter((p) =>
            p.vinculos.some((v) => PAPEIS_ELEGIVEIS.has(v.papel)),
          );
          setResultados(
            elegiveis.slice(0, LIMITE_RESULTADOS).map((p) => ({ public_id: p.public_id, nome: p.nome })),
          );
          setAberto(true);
        })
        .catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [termo, value]);

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor="responsavel-autocomplete" className="text-label-md text-on-surface-variant">
        {label}
      </label>
      <input
        id="responsavel-autocomplete"
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value);
          onChange(null);
        }}
        placeholder={label}
        className="rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface placeholder:text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
      {aberto && resultados.length > 0 && (
        <ul className="absolute top-full z-10 mt-1 w-full rounded border border-outline-variant bg-surface-container-lowest shadow-md">
          {resultados.map((p) => (
            <li key={p.public_id}>
              <button
                type="button"
                onClick={() => {
                  onChange(p);
                  setTermo(p.nome);
                  setResultados([]);
                  setAberto(false);
                }}
                className="w-full px-4 py-2 text-left text-body-md text-on-surface hover:bg-surface-container"
              >
                {p.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rodar teste, ver passar**

Run: `npx vitest run app/pessoas/ResponsavelAutocomplete.test.tsx`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add web/app/pessoas/ResponsavelAutocomplete.tsx web/app/pessoas/ResponsavelAutocomplete.test.tsx
git commit -m "feat(pessoas): componente ResponsavelAutocomplete (filtra gestor/coordenador/lideranca)"
```

---

### Task 7: `/pessoas` (lista)

**Files:**
- Create: `web/app/pessoas/page.tsx`, `web/app/pessoas/PessoasListClient.tsx`
- Test: `web/app/pessoas/page.test.tsx`, `web/app/pessoas/PessoasListClient.test.tsx`

**Interfaces:**
- Consumes: `GET /api/pessoas` (Task 2), `NavShell` (Task 5).

- [ ] **Step 1: Teste do `page.tsx` (auth gate)**

Criar `web/app/pessoas/page.test.tsx` (mesmo padrão de `web/app/dashboard/page.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

const PessoasListClient = vi.fn(() => 'pessoas-list-client-mock');
vi.mock('./PessoasListClient', () => ({ PessoasListClient: () => PessoasListClient() }));

const REDIRECT_SENTINEL = Symbol('NEXT_REDIRECT');
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw REDIRECT_SENTINEL; }),
}));

import { ssrClient } from '../../lib/supabase/ssr';
import { redirect } from 'next/navigation';
import Page from './page';

describe('/pessoas page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('redireciona pro /login quando não autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    await expect(Page()).rejects.toBe(REDIRECT_SENTINEL);
    expect(redirect).toHaveBeenCalledWith('/login');
    expect(PessoasListClient).not.toHaveBeenCalled();
  });

  it('renderiza a lista quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('pessoas-list-client-mock');
  });
});
```

- [ ] **Step 2: Teste do `PessoasListClient.tsx`**

Criar `web/app/pessoas/PessoasListClient.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PessoasListClient } from './PessoasListClient';

const mockPessoas = [
  {
    public_id: 'pes_a', nome: 'Ana',
    vinculos: [
      { id: 'v-1', papel: 'apoiador', responsavel: { public_id: 'pes_l', nome: 'Lucia' } },
      { id: 'v-2', papel: 'apoiador', responsavel: { public_id: 'pes_c', nome: 'Carlos' } },
    ],
  },
];

describe('PessoasListClient', () => {
  afterEach(() => cleanup());

  it('busca ao montar e mostra 1 linha por vínculo', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: mockPessoas }) })) as never;
    render(<PessoasListClient />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/pessoas?q='));
    const linhasAna = await screen.findAllByText('Ana');
    expect(linhasAna).toHaveLength(2);
    expect(screen.getByText('Lucia')).toBeInTheDocument();
    expect(screen.getByText('Carlos')).toBeInTheDocument();
  });

  it('digitar na busca refaz o fetch com o termo', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: [] }) })) as never;
    render(<PessoasListClient />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/pessoas?q='));

    fireEvent.change(screen.getByPlaceholderText('Buscar por nome'), { target: { value: 'ana' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/pessoas?q=ana'));
  });

  it('link "+ Nova pessoa" aponta pra /pessoas/novo', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: [] }) })) as never;
    render(<PessoasListClient />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText('+ Nova pessoa')).toHaveAttribute('href', '/pessoas/novo');
  });

  it('lista vazia mostra empty state em vez de tabela sem linhas', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ pessoas: [] }) })) as never;
    render(<PessoasListClient />);
    expect(await screen.findByText('Nenhuma pessoa cadastrada ainda.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar testes, ver falhar**

Run: `npx vitest run app/pessoas/page.test.tsx app/pessoas/PessoasListClient.test.tsx`
Expected: FAIL — nenhum dos 2 arquivos de implementação existe ainda.

- [ ] **Step 4: Implementar `page.tsx`**

Criar `web/app/pessoas/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ssrClient } from '../../lib/supabase/ssr';
import { PessoasListClient } from './PessoasListClient';

export default async function PessoasPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <PessoasListClient />;
}
```

- [ ] **Step 5: Implementar `PessoasListClient.tsx`**

Criar `web/app/pessoas/PessoasListClient.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { NavShell } from '../components/NavShell';
import { Message } from '../components/Message';

type Vinculo = { id: string; papel: string; responsavel: { public_id: string; nome: string } | null };
type Pessoa = { public_id: string; nome: string; vinculos: Vinculo[] };

export function PessoasListClient() {
  const [q, setQ] = useState('');
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fetch(`/api/pessoas?q=${encodeURIComponent(q)}`)
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar pessoas');
        return res.json();
      })
      .then((data: { pessoas: Pessoa[] }) => {
        if (!cancelado) setPessoas(data.pessoas);
      })
      .catch(() => {
        if (!cancelado) setErro('Não foi possível carregar as pessoas.');
      });
    return () => {
      cancelado = true;
    };
  }, [q]);

  const linhas = (pessoas ?? []).flatMap((p) => p.vinculos.map((v) => ({ pessoa: p, vinculo: v })));

  return (
    <NavShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome"
            className="rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface placeholder:text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
          <Link
            href="/pessoas/novo"
            className="inline-flex items-center justify-center rounded bg-primary px-6 py-3 text-body-md text-on-primary transition-colors hover:bg-primary/90 active:bg-primary/80"
          >
            + Nova pessoa
          </Link>
        </div>

        {erro && <Message variant="error">{erro}</Message>}

        {pessoas && linhas.length === 0 && (
          <p className="text-body-md text-on-surface-variant">Nenhuma pessoa cadastrada ainda.</p>
        )}

        {pessoas && linhas.length > 0 && (
          <div className="rounded border border-outline-variant overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-md text-on-surface">
                <thead className="bg-surface-container-low">
                  <tr>
                    <th className="px-4 py-2 font-medium">Nome</th>
                    <th className="px-4 py-2 font-medium">Papel</th>
                    <th className="px-4 py-2 font-medium">Responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map(({ pessoa, vinculo }) => (
                    <tr key={vinculo.id} className="border-t border-outline-variant">
                      <td className="px-4 py-2">
                        <Link href={`/pessoas/${pessoa.public_id}`} className="hover:underline">
                          {pessoa.nome}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{vinculo.papel}</td>
                      <td className="px-4 py-2">{vinculo.responsavel?.nome ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </NavShell>
  );
}
```

- [ ] **Step 6: Rodar testes, ver passar**

Run: `npx vitest run app/pessoas/page.test.tsx app/pessoas/PessoasListClient.test.tsx`
Expected: PASS (todos os casos).

- [ ] **Step 7: Commit**

```bash
git add web/app/pessoas/page.tsx web/app/pessoas/page.test.tsx web/app/pessoas/PessoasListClient.tsx web/app/pessoas/PessoasListClient.test.tsx
git commit -m "feat(pessoas): tela /pessoas — lista com busca, 1 linha por vinculo"
```

---

### Task 8: `/pessoas/novo` (cadastro)

**Files:**
- Create: `web/app/pessoas/novo/page.tsx`, `web/app/pessoas/novo/NovaPessoaClient.tsx`
- Test: `web/app/pessoas/novo/page.test.tsx`, `web/app/pessoas/novo/NovaPessoaClient.test.tsx`

**Interfaces:**
- Consumes: `POST /api/pessoas` (existente + Task 1), `GET /api/secoes` (Task 4), `ResponsavelAutocomplete` (Task 6).

- [ ] **Step 1: Teste do `page.tsx`**

Criar `web/app/pessoas/novo/page.test.tsx` (idêntico em estrutura ao Task 7 Step 1, trocando o client mockado):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

const NovaPessoaClient = vi.fn(() => 'nova-pessoa-client-mock');
vi.mock('./NovaPessoaClient', () => ({ NovaPessoaClient: () => NovaPessoaClient() }));

const REDIRECT_SENTINEL = Symbol('NEXT_REDIRECT');
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw REDIRECT_SENTINEL; }),
}));

import { ssrClient } from '../../../lib/supabase/ssr';
import { redirect } from 'next/navigation';
import Page from './page';

describe('/pessoas/novo page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('redireciona pro /login quando não autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    await expect(Page()).rejects.toBe(REDIRECT_SENTINEL);
    expect(redirect).toHaveBeenCalledWith('/login');
    expect(NovaPessoaClient).not.toHaveBeenCalled();
  });

  it('renderiza o form quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('nova-pessoa-client-mock');
  });
});
```

- [ ] **Step 2: Teste do `NovaPessoaClient.tsx`**

Criar `web/app/pessoas/novo/NovaPessoaClient.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { NovaPessoaClient } from './NovaPessoaClient';

const mockResponsavel = {
  public_id: 'pes_resp', nome: 'Geraldo Gestor',
  vinculos: [{ id: 'v-g', papel: 'gestor', responsavel: null }],
};

/** Preenche Nome + Papel e seleciona um Responsável via o autocomplete
 * (digita, espera o dropdown, clica no resultado) — reflete o fluxo
 * real de um usuário, não define o estado por fora. */
async function preencherCamposObrigatorios(nome = 'Ana Nova') {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: nome } });
  fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'apoiador' } });
  fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'ger' } });
  fireEvent.click(await screen.findByText('Geraldo Gestor'));
}

describe('NovaPessoaClient', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.startsWith('/api/pessoas?q=')) {
        return { ok: true, json: async () => ({ pessoas: [mockResponsavel] }) } as Response;
      }
      if (url === '/api/secoes') {
        return { ok: true, json: async () => ({ zonas: [{ id: 'z-1', numero: 5 }] }) } as Response;
      }
      throw new Error('fetch inesperado: ' + url);
    }) as never;
  });

  it('envia POST /api/pessoas com os campos preenchidos', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/secoes') return { ok: true, json: async () => ({ zonas: [] }) } as Response;
      if (url.startsWith('/api/pessoas?q=')) return { ok: true, json: async () => ({ pessoas: [mockResponsavel] }) } as Response;
      if (url === '/api/pessoas' && init?.method === 'POST') {
        return { ok: true, status: 201, json: async () => ({ public_id: 'pes_novo' }) } as Response;
      }
      throw new Error('fetch inesperado: ' + url);
    }) as never;

    render(<NovaPessoaClient />);
    await preencherCamposObrigatorios('Ana Nova');
    fireEvent.click(screen.getByText('Cadastrar'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/pessoas', expect.objectContaining({ method: 'POST' }));
    });
    const chamada = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/pessoas');
    const body = JSON.parse((chamada![1] as RequestInit).body as string);
    expect(body.nome).toBe('Ana Nova');
    expect(body.papel).toBe('apoiador');
    expect(body.responsavel_id).toBe('pes_resp');
  });

  it('nome vazio mostra erro sem chamar POST', async () => {
    render(<NovaPessoaClient />);
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'ger' } });
    fireEvent.click(await screen.findByText('Geraldo Gestor'));
    fireEvent.click(screen.getByText('Cadastrar'));

    expect(await screen.findByText('Nome é obrigatório.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith('/api/pessoas', expect.objectContaining({ method: 'POST' }));
  });

  it('sem responsável selecionado mostra erro sem chamar POST', async () => {
    render(<NovaPessoaClient />);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByText('Cadastrar'));

    expect(await screen.findByText('Selecione um responsável.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith('/api/pessoas', expect.objectContaining({ method: 'POST' }));
  });

  it('409 mostra aviso de duplicata com botão de confirmar vínculo compartilhado', async () => {
    let chamadas = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/secoes') return { ok: true, json: async () => ({ zonas: [] }) } as Response;
      if (url.startsWith('/api/pessoas?q=')) return { ok: true, json: async () => ({ pessoas: [mockResponsavel] }) } as Response;
      if (url === '/api/pessoas' && init?.method === 'POST') {
        chamadas += 1;
        if (chamadas === 1) {
          return {
            ok: false, status: 409,
            json: async () => ({ error: 'pessoa_duplicada', match_por: 'titulo', pessoa_existente: { public_id: 'pes_dup', nome: 'Ana Duplicada' } }),
          } as Response;
        }
        return { ok: true, status: 201, json: async () => ({ public_id: 'pes_dup' }) } as Response;
      }
      throw new Error('fetch inesperado: ' + url);
    }) as never;

    render(<NovaPessoaClient />);
    await preencherCamposObrigatorios('Ana');
    fireEvent.click(screen.getByText('Cadastrar'));

    expect(await screen.findByText(/Ana Duplicada/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirmar vínculo compartilhado'));

    await waitFor(() => expect(chamadas).toBe(2));
    const segundaChamada = vi.mocked(fetch).mock.calls[vi.mocked(fetch).mock.calls.length - 1];
    const body = JSON.parse((segundaChamada[1] as RequestInit).body as string);
    expect(body.confirmar_compartilhado).toBe(true);
  });

  it('falha de rede no POST mostra mensagem de erro genérica', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/secoes') return { ok: true, json: async () => ({ zonas: [] }) } as Response;
      if (url.startsWith('/api/pessoas?q=')) return { ok: true, json: async () => ({ pessoas: [mockResponsavel] }) } as Response;
      if (url === '/api/pessoas' && init?.method === 'POST') throw new Error('network down');
      throw new Error('fetch inesperado: ' + url);
    }) as never;

    render(<NovaPessoaClient />);
    await preencherCamposObrigatorios('Ana');
    fireEvent.click(screen.getByText('Cadastrar'));

    expect(await screen.findByText('Não foi possível cadastrar a pessoa.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar testes, ver falhar**

Run: `npx vitest run app/pessoas/novo/page.test.tsx app/pessoas/novo/NovaPessoaClient.test.tsx`
Expected: FAIL — arquivos não existem.

- [ ] **Step 4: Implementar `page.tsx`**

Criar `web/app/pessoas/novo/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ssrClient } from '../../../lib/supabase/ssr';
import { NovaPessoaClient } from './NovaPessoaClient';

export default async function NovaPessoaPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <NovaPessoaClient />;
}
```

- [ ] **Step 5: Implementar `NovaPessoaClient.tsx`**

Criar `web/app/pessoas/novo/NovaPessoaClient.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NavShell } from '../../components/NavShell';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Message } from '../../components/Message';
import { ResponsavelAutocomplete } from '../ResponsavelAutocomplete';
import { cpfValido } from '../../../lib/cpf';

const focoVisivel =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const selectClassName = `rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant ${focoVisivel}`;

const PAPEIS = ['coordenador', 'colaborador', 'lideranca', 'apoiador'] as const;

type Zona = { id: string; numero: number };
type Secao = { id: string; numero: number; aptos: number };
type Duplicata = { match_por: 'titulo' | 'cpf'; pessoa_existente: { public_id: string; nome: string } };

export function NovaPessoaClient() {
  const router = useRouter();

  const [nome, setNome] = useState('');
  const [titulo, setTitulo] = useState('');
  const [cpf, setCpf] = useState('');
  const [telefone, setTelefone] = useState('');
  const [emailContato, setEmailContato] = useState('');
  const [responsavel, setResponsavel] = useState<{ public_id: string; nome: string } | null>(null);
  const [papel, setPapel] = useState<typeof PAPEIS[number]>('apoiador');
  const [zonaId, setZonaId] = useState('');
  const [secaoId, setSecaoId] = useState('');

  const [zonas, setZonas] = useState<Zona[]>([]);
  const [secoes, setSecoes] = useState<Secao[]>([]);

  const [erro, setErro] = useState<string | null>(null);
  const [duplicata, setDuplicata] = useState<Duplicata | null>(null);

  useEffect(() => {
    fetch('/api/secoes')
      .then((res) => res.json())
      .then((data: { zonas: Zona[] }) => setZonas(data.zonas))
      .catch(() => setZonas([]));
  }, []);

  useEffect(() => {
    if (!zonaId) {
      setSecoes([]);
      setSecaoId('');
      return;
    }
    fetch(`/api/secoes?zona_id=${zonaId}`)
      .then((res) => res.json())
      .then((data: { secoes: Secao[] }) => setSecoes(data.secoes))
      .catch(() => setSecoes([]));
  }, [zonaId]);

  async function enviar(confirmarCompartilhado: boolean) {
    setErro(null);
    // Campos obrigatórios (spec decisão 9: Nome*, Responsável*, Papel*).
    // `papel` sempre tem valor (select com default), então só nome e
    // responsável precisam de checagem explícita — o backend também
    // valida (400 sem nome/responsavel_id/papel), mas checar aqui evita
    // um round-trip só pra descobrir um campo vazio.
    if (!nome.trim()) {
      setErro('Nome é obrigatório.');
      return;
    }
    if (!responsavel) {
      setErro('Selecione um responsável.');
      return;
    }
    // Normaliza pra dígitos ANTES de validar e enviar — encryptTitulo()
    // (web/lib/titulo-enc.ts) não normaliza como tituloHmac()/cpfHmac()
    // normalizam internamente; se mandássemos o título "cru" (com espaço/
    // traço), o valor cifrado guardado ficaria diferente do valor usado
    // pro hash de dedup, uma inconsistência real. Normalizar aqui garante
    // que hash e valor cifrado representem exatamente o mesmo dígitos.
    const tituloDigits = titulo.replace(/\D/g, '');
    if (titulo && tituloDigits.length !== 12) {
      setErro('Título de eleitor deve ter 12 dígitos.');
      return;
    }
    if (cpf && !cpfValido(cpf)) {
      setErro('CPF inválido.');
      return;
    }

    try {
      const res = await fetch('/api/pessoas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nome,
          titulo: tituloDigits || undefined,
          cpf: cpf || undefined,
          telefone: telefone || undefined,
          email_contato: emailContato || undefined,
          responsavel_id: responsavel.public_id,
          papel,
          secao_id: secaoId || undefined,
          confirmar_compartilhado: confirmarCompartilhado,
        }),
      });

      if (res.status === 409) {
        const body = await res.json();
        setDuplicata({ match_por: body.match_por, pessoa_existente: body.pessoa_existente });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErro(body.erro ?? 'Não foi possível cadastrar a pessoa.');
        return;
      }

      const { public_id } = await res.json();
      router.push(`/pessoas/${public_id}`);
    } catch {
      setErro('Não foi possível cadastrar a pessoa.');
    }
  }

  return (
    <NavShell>
      <div className="rounded border border-outline-variant bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-headline-md text-on-surface">Cadastrar pessoa</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            enviar(false);
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" />
          <Input label="Título de eleitor" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título de eleitor" />
          <Input label="CPF" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="CPF" />
          <Input label="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Telefone" />
          <Input label="E-mail de contato" value={emailContato} onChange={(e) => setEmailContato(e.target.value)} placeholder="E-mail de contato" />
          <ResponsavelAutocomplete label="Responsável" value={responsavel} onChange={setResponsavel} />
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Papel</span>
            <select
              id="papel-select"
              aria-label="Papel"
              value={papel}
              onChange={(e) => setPapel(e.target.value as typeof PAPEIS[number])}
              className={selectClassName}
            >
              {PAPEIS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Zona</span>
            <select
              aria-label="Zona"
              value={zonaId}
              onChange={(e) => setZonaId(e.target.value)}
              className={selectClassName}
            >
              <option value="">— sem zona —</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>Zona {z.numero}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Seção</span>
            <select
              aria-label="Seção"
              value={secaoId}
              onChange={(e) => setSecaoId(e.target.value)}
              disabled={!zonaId}
              className={selectClassName}
            >
              <option value="">— sem seção —</option>
              {secoes.map((s) => (
                <option key={s.id} value={s.id}>Seção {s.numero}</option>
              ))}
            </select>
          </label>

          <Button type="submit" className="md:col-span-2">Cadastrar</Button>
          {erro && (
            <div className="md:col-span-2">
              <Message variant="error">{erro}</Message>
            </div>
          )}
          {duplicata && (
            <div className="md:col-span-2 rounded border border-outline-variant bg-surface-container p-4">
              <p className="text-body-md text-on-surface">
                Já existe uma pessoa cadastrada com este {duplicata.match_por}. Nome encontrado:{' '}
                <strong>{duplicata.pessoa_existente.nome}</strong>. Deseja apenas criar um novo vínculo?
              </p>
              <button
                type="button"
                onClick={() => enviar(true)}
                className={`mt-2 rounded px-4 py-2 text-body-md text-primary hover:underline ${focoVisivel}`}
              >
                Confirmar vínculo compartilhado
              </button>
            </div>
          )}
        </form>
      </div>
    </NavShell>
  );
}
```

Nota: o `<label>`+`<select>` de Papel usa `aria-label="Papel"` — em conjunto com o `<span>` visual "Papel" dentro do `<label>` que o envolve, `getByLabelText('Papel')` do teste resolve pelo `aria-label` (mais específico), igual ao padrão já usado no formulário do superadmin.

- [ ] **Step 6: Rodar testes, ver passar**

Run: `npx vitest run app/pessoas/novo/page.test.tsx app/pessoas/novo/NovaPessoaClient.test.tsx`
Expected: PASS (todos os casos).

- [ ] **Step 7: Commit**

```bash
git add web/app/pessoas/novo/
git commit -m "feat(pessoas): tela /pessoas/novo — cadastro com secao/zona e fluxo de duplicata"
```

---

### Task 9: `/pessoas/[publicId]` (detalhe + remover vínculo)

**Files:**
- Create: `web/app/pessoas/[publicId]/page.tsx`, `web/app/pessoas/[publicId]/PessoaDetalheClient.tsx`
- Test: `web/app/pessoas/[publicId]/page.test.tsx`, `web/app/pessoas/[publicId]/PessoaDetalheClient.test.tsx`

**Interfaces:**
- Consumes: `GET /api/pessoas/[publicId]` (Task 3), `GET /api/vinculos/[id]/impacto` (existente), `DELETE /api/vinculos/[id]` (existente), `ResponsavelAutocomplete` (Task 6).

- [ ] **Step 1: Teste do `page.tsx`**

Criar `web/app/pessoas/[publicId]/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));

const PessoaDetalheClient = vi.fn(() => 'pessoa-detalhe-client-mock');
vi.mock('./PessoaDetalheClient', () => ({ PessoaDetalheClient: () => PessoaDetalheClient() }));

const REDIRECT_SENTINEL = Symbol('NEXT_REDIRECT');
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw REDIRECT_SENTINEL; }),
}));

import { ssrClient } from '../../../lib/supabase/ssr';
import { redirect } from 'next/navigation';
import Page from './page';

function ctx(publicId: string) {
  return { params: Promise.resolve({ publicId }) };
}

describe('/pessoas/[publicId] page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('redireciona pro /login quando não autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);
    await expect(Page(ctx('pes_x'))).rejects.toBe(REDIRECT_SENTINEL);
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renderiza o detalhe quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page(ctx('pes_x')));
    expect(html).toContain('pessoa-detalhe-client-mock');
  });
});
```

- [ ] **Step 2: Teste do `PessoaDetalheClient.tsx`**

Criar `web/app/pessoas/[publicId]/PessoaDetalheClient.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PessoaDetalheClient } from './PessoaDetalheClient';

const pessoaComUmVinculo = {
  public_id: 'pes_a', nome: 'Ana', telefone: '999', email_contato: 'a@a.com',
  titulo: '012345678901', secao: { zona_numero: 5, secao_numero: 10 },
  base_legal: 'legitimointeresse', data_coleta: '2026-01-01',
  vinculos: [{ id: 'v-1', papel: 'apoiador', responsavel: { public_id: 'pes_r', nome: 'Resp' } }],
};

const pessoaComDoisVinculos = {
  ...pessoaComUmVinculo,
  vinculos: [
    { id: 'v-1', papel: 'apoiador', responsavel: { public_id: 'pes_r', nome: 'Resp' } },
    { id: 'v-2', papel: 'apoiador', responsavel: { public_id: 'pes_r2', nome: 'Resp2' } },
  ],
};

describe('PessoaDetalheClient', () => {
  afterEach(() => cleanup());

  it('mostra os dados e "Possui 1 vínculo(s) ativo(s)"', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => pessoaComUmVinculo })) as never;
    render(<PessoaDetalheClient publicId="pes_a" />);

    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/Possui 1 vínculo/)).toBeInTheDocument();
    expect(screen.getByText('Resp')).toBeInTheDocument();
  });

  it('"Remover vínculo" vem desabilitado quando é o único vínculo da pessoa, sem chamar impacto', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/pessoas/pes_a') return { ok: true, json: async () => pessoaComUmVinculo } as Response;
      throw new Error('fetch inesperado: ' + url);
    }) as never;

    render(<PessoaDetalheClient publicId="pes_a" />);
    await screen.findByText('Ana');

    expect(screen.getByText('Remover vínculo')).toBeDisabled();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/impacto'));
  });

  it('remover vínculo: impacto -> confirma -> DELETE com destino_id = responsavel_acima', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/pessoas/pes_a') return { ok: true, json: async () => pessoaComDoisVinculos } as Response;
      if (url === '/api/vinculos/v-1/impacto') {
        return { ok: true, json: async () => ({ count: 2, responsavel_acima: { public_id: 'pes_acima', nome: 'Acima' } }) } as Response;
      }
      if (url === '/api/vinculos/v-1' && init?.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => ({}) } as Response;
      }
      throw new Error('fetch inesperado: ' + url + ' ' + init?.method);
    }) as never;

    render(<PessoaDetalheClient publicId="pes_a" />);
    await screen.findByText('Ana');

    fireEvent.click(screen.getAllByText('Remover vínculo')[0]);
    expect(await screen.findByText(/2 pessoa\(s\) serão realocadas para/)).toBeInTheDocument();
    expect(screen.getByText(/Acima/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Confirmar remoção'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/vinculos/v-1', expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ destino_id: 'pes_acima' }),
      }));
    });
  });

  it('Cancelar fecha o modal sem chamar DELETE', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/pessoas/pes_a') return { ok: true, json: async () => pessoaComDoisVinculos } as Response;
      if (url === '/api/vinculos/v-1/impacto') {
        return { ok: true, json: async () => ({ count: 2, responsavel_acima: { public_id: 'pes_acima', nome: 'Acima' } }) } as Response;
      }
      if (url === '/api/vinculos/v-1' && init?.method === 'DELETE') {
        throw new Error('não deveria chamar DELETE após Cancelar');
      }
      throw new Error('fetch inesperado: ' + url);
    }) as never;

    render(<PessoaDetalheClient publicId="pes_a" />);
    await screen.findByText('Ana');

    fireEvent.click(screen.getAllByText('Remover vínculo')[0]);
    await screen.findByText('Confirmar remoção');
    fireEvent.click(screen.getByText('Cancelar'));

    expect(screen.queryByText('Confirmar remoção')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith('/api/vinculos/v-1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('botão "Confirmar remoção" fica desabilitado quando responsavel_acima é null', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/pessoas/pes_a') return { ok: true, json: async () => pessoaComDoisVinculos } as Response;
      if (url === '/api/vinculos/v-1/impacto') {
        return { ok: true, json: async () => ({ count: 0, responsavel_acima: null }) } as Response;
      }
      throw new Error('fetch inesperado: ' + url);
    }) as never;

    render(<PessoaDetalheClient publicId="pes_a" />);
    await screen.findByText('Ana');
    fireEvent.click(screen.getAllByText('Remover vínculo')[0]);

    await waitFor(() => {
      expect(screen.getByText('Confirmar remoção')).toBeDisabled();
    });
  });

  it('DELETE 404 (vínculo já removido por outra sessão) mostra erro', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/pessoas/pes_a') return { ok: true, json: async () => pessoaComDoisVinculos } as Response;
      if (url === '/api/vinculos/v-1/impacto') {
        return { ok: true, json: async () => ({ count: 0, responsavel_acima: { public_id: 'pes_acima', nome: 'Acima' } }) } as Response;
      }
      if (url === '/api/vinculos/v-1' && init?.method === 'DELETE') {
        return { ok: false, status: 404, json: async () => ({ erro: 'vinculo_nao_encontrado' }) } as Response;
      }
      throw new Error('fetch inesperado: ' + url);
    }) as never;

    render(<PessoaDetalheClient publicId="pes_a" />);
    await screen.findByText('Ana');
    fireEvent.click(screen.getAllByText('Remover vínculo')[0]);
    await screen.findByText('Confirmar remoção');
    fireEvent.click(screen.getByText('Confirmar remoção'));

    expect(await screen.findByText('Não foi possível remover o vínculo.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar testes, ver falhar**

Run: `npx vitest run "app/pessoas/[publicId]/page.test.tsx" "app/pessoas/[publicId]/PessoaDetalheClient.test.tsx"`
Expected: FAIL — arquivos não existem.

- [ ] **Step 4: Implementar `page.tsx`**

Criar `web/app/pessoas/[publicId]/page.tsx`:

```tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ssrClient } from '../../../lib/supabase/ssr';
import { PessoaDetalheClient } from './PessoaDetalheClient';

export default async function PessoaDetalhePage(
  { params }: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await params;
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <PessoaDetalheClient publicId={publicId} />;
}
```

- [ ] **Step 5: Implementar `PessoaDetalheClient.tsx`**

Criar `web/app/pessoas/[publicId]/PessoaDetalheClient.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { NavShell } from '../../components/NavShell';
import { Message } from '../../components/Message';
import { ResponsavelAutocomplete } from '../ResponsavelAutocomplete';

type Pessoa = {
  public_id: string;
  nome: string;
  telefone: string | null;
  email_contato: string | null;
  titulo: string | null;
  secao: { zona_numero: number; secao_numero: number } | null;
  base_legal: string;
  data_coleta: string;
  vinculos: Array<{ id: string; papel: string; responsavel: { public_id: string; nome: string } | null }>;
};

type Impacto = { count: number; responsavel_acima: { public_id: string; nome: string } | null };

const LIMIAR_CONFIRMACAO_FORTE = 50;

export function PessoaDetalheClient({ publicId }: { publicId: string }) {
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vinculoRemovendo, setVinculoRemovendo] = useState<string | null>(null);
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [destinoManual, setDestinoManual] = useState<{ public_id: string; nome: string } | null>(null);

  useEffect(() => {
    fetch(`/api/pessoas/${publicId}`)
      .then((res) => {
        if (!res.ok) throw new Error('falha ao carregar pessoa');
        return res.json();
      })
      .then(setPessoa)
      .catch(() => setErro('Não foi possível carregar a pessoa.'));
  }, [publicId]);

  async function iniciarRemocao(vinculoId: string) {
    setVinculoRemovendo(vinculoId);
    setDestinoManual(null);
    const res = await fetch(`/api/vinculos/${vinculoId}/impacto`);
    if (!res.ok) {
      setErro('Não foi possível calcular o impacto da remoção.');
      setVinculoRemovendo(null);
      return;
    }
    setImpacto(await res.json());
  }

  async function confirmarRemocao() {
    if (!vinculoRemovendo || !impacto) return;
    const destinoId = destinoManual?.public_id ?? impacto.responsavel_acima?.public_id;
    if (!destinoId) return;

    const res = await fetch(`/api/vinculos/${vinculoRemovendo}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destino_id: destinoId }),
    });
    if (!res.ok) {
      setErro('Não foi possível remover o vínculo.');
      return;
    }
    setVinculoRemovendo(null);
    setImpacto(null);
    const atualizado = await fetch(`/api/pessoas/${publicId}`).then((r) => r.json());
    setPessoa(atualizado);
  }

  if (erro) return <Message variant="error">{erro}</Message>;
  if (!pessoa) return null;

  return (
    <NavShell>
      <div className="flex flex-col gap-6">
        <div className="rounded border border-outline-variant bg-surface-container-lowest p-6">
          <h2 className="text-headline-md text-on-surface">{pessoa.nome}</h2>
          <dl className="mt-4 grid grid-cols-1 gap-2 text-body-md text-on-surface-variant md:grid-cols-2">
            {pessoa.telefone && <div><dt className="inline font-medium">Telefone: </dt><dd className="inline">{pessoa.telefone}</dd></div>}
            {pessoa.email_contato && <div><dt className="inline font-medium">E-mail: </dt><dd className="inline">{pessoa.email_contato}</dd></div>}
            {pessoa.titulo && <div><dt className="inline font-medium">Título: </dt><dd className="inline">{pessoa.titulo}</dd></div>}
            {pessoa.secao && (
              <div>
                <dt className="inline font-medium">Zona/Seção: </dt>
                <dd className="inline">{pessoa.secao.zona_numero}/{pessoa.secao.secao_numero}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-body-md text-on-surface">
            Possui {pessoa.vinculos.length} vínculo(s) ativo(s)
          </p>
          <ul className="flex flex-col gap-3">
            {pessoa.vinculos.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded border border-outline-variant bg-surface-container px-4 py-3">
                <span className="text-body-md text-on-surface">
                  {v.papel} — responsável: {v.responsavel?.nome ?? '—'}
                </span>
                <button
                  type="button"
                  onClick={() => iniciarRemocao(v.id)}
                  disabled={pessoa.vinculos.length === 1}
                  title={pessoa.vinculos.length === 1 ? 'Remover o último vínculo deixaria esta pessoa inacessível pelo produto.' : undefined}
                  className="rounded px-3 py-1.5 text-body-md text-error hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                >
                  Remover vínculo
                </button>
              </li>
            ))}
          </ul>
        </div>

        {vinculoRemovendo && impacto && (
          <div className="rounded border border-outline-variant bg-surface-container p-4">
            {impacto.responsavel_acima ? (
              <>
                <p className="text-body-md text-on-surface">
                  {impacto.count} pessoa(s) serão realocadas para{' '}
                  <strong>{destinoManual?.nome ?? impacto.responsavel_acima.nome}</strong>.
                </p>
                {impacto.count > LIMIAR_CONFIRMACAO_FORTE && (
                  <div className="mt-2">
                    <p className="text-body-md text-error">
                      Atenção: mais de {LIMIAR_CONFIRMACAO_FORTE} pessoas serão afetadas.
                    </p>
                    <ResponsavelAutocomplete
                      label="Escolher outro destino"
                      value={destinoManual}
                      onChange={setDestinoManual}
                    />
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={confirmarRemocao}
                    className="rounded bg-primary px-4 py-2 text-body-md text-on-primary hover:bg-primary/90"
                  >
                    Confirmar remoção
                  </button>
                  <button
                    type="button"
                    onClick={() => { setVinculoRemovendo(null); setImpacto(null); setDestinoManual(null); }}
                    className="rounded px-4 py-2 text-body-md text-on-surface-variant hover:text-on-surface"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-body-md text-on-surface-variant">
                  Este é o vínculo raiz (Gestor) e não tem responsável acima — removê-lo é uma
                  decisão de ciclo de vida da campanha, fora do escopo desta tela.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled className="rounded bg-primary px-4 py-2 text-body-md text-on-primary opacity-50">
                    Confirmar remoção
                  </button>
                  <button
                    type="button"
                    onClick={() => { setVinculoRemovendo(null); setImpacto(null); setDestinoManual(null); }}
                    className="rounded px-4 py-2 text-body-md text-on-surface-variant hover:text-on-surface"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </NavShell>
  );
}
```

- [ ] **Step 6: Rodar testes, ver passar**

Run: `npx vitest run "app/pessoas/[publicId]/page.test.tsx" "app/pessoas/[publicId]/PessoaDetalheClient.test.tsx"`
Expected: PASS (todos os casos).

- [ ] **Step 7: Commit**

```bash
git add "web/app/pessoas/[publicId]/"
git commit -m "feat(pessoas): tela /pessoas/[publicId] — detalhe + remover vinculo com realocacao"
```

---

### Task 10: Suite completa + lint + verificação visual

**Files:** none (verificação apenas)

- [ ] **Step 1: Suite completa**

Run (from `web/`): `npm test`
Expected: todas as suítes passam, incluindo os ~10 arquivos novos/modificados desta fatia.

- [ ] **Step 2: Lint**

Run (from `web/`): `npm run lint`
Expected: nenhum erro **novo**. Os 5 erros pré-existentes `react-hooks/set-state-in-effect` (fatia C2/D) continuam lá, fora do escopo. Se aparecer erro novo apontando pra código desta fatia, corrigir antes de seguir.

- [ ] **Step 3: Verificação visual real via Playwright**

Com `npm run dev` rodando e sessão de `gestor.a@teste.local` autenticada (mesmo fixture já usado nas fatias C2/D):
- `/pessoas` — lista carrega, busca funciona, "+ Nova pessoa" navega.
- `/pessoas/novo` — cadastra 1 pessoa de teste **com seção** (zona+seção escolhidos), confirma que o `POST` retorna `201` e redireciona pro detalhe.
- Depois de cadastrar, ir em `/mapa-calor`, camada Força — confirmar que a pessoa nova aparece no total daquela zona (prova que `secao_id` realmente ancorou no mapa de calor, ADR 0006).
- Testar o fluxo de duplicata: cadastrar de novo com o mesmo título — vê o aviso, confirma vínculo compartilhado.
- `/pessoas/[publicId]` — detalhe mostra os 2 vínculos da pessoa duplicada (não escondido); remover 1 vínculo, confirmar realocação.
- Mobile (375px): sem scroll horizontal de página em nenhuma das 3 telas novas.
- Zero erro/warning no console em qualquer uma das 3 telas.

**Limpeza da pessoa de teste é só pra ambiente local de desenvolvimento/verificação** — não é um passo do fluxo normal do produto (esta fatia, de propósito, não tem "excluir pessoa" nenhum, ver spec decisão 14 e não-objetivos). Ao final, rodar via SQL direto **só no projeto Supabase de dev** (`axcftjqdjvknrpqzrxls`), nunca em produção:
```sql
delete from vinculo where pessoa_id = (select id from pessoa where public_id = '<public_id da pessoa de teste>');
delete from pessoa where public_id = '<public_id da pessoa de teste>';
```
(apagar `vinculo` antes de `pessoa` — sem `ON DELETE CASCADE` confirmado entre as 2 tabelas, mais seguro apagar na ordem certa do que assumir cascata).

- [ ] **Step 4: Parar o dev server**

Se ficou rodando em background, encerrar.

---

## Definition of Done

- Migration aplicada e verificada (`pg_get_functiondef` mostra `p_secao_id`/`buscar_pessoas`).
- Todas as 3 rotas de API novas + a rota existente modificada implementadas e testadas.
- Todas as 3 telas novas implementadas, usando só componentes/tokens já existentes no design system (+ `ResponsavelAutocomplete`, único componente novo, justificado por 2 usos).
- `npm test` passa (suite inteira, não só os arquivos desta fatia).
- `npm run lint` sem erro novo (os 5 pré-existentes de `react-hooks/set-state-in-effect` continuam fora de escopo).
- Verificação visual real (Playwright) confirma: cadastro com seção aparece no mapa de calor; fluxo de duplicata; remoção de vínculo com realocação; guard do último vínculo e do vínculo raiz funcionando; mobile sem scroll horizontal; zero erro de console.
- Pessoa(s) de teste criadas durante a verificação removidas do banco de dev antes de finalizar.

## Self-Review Notes

- **Spec coverage:** decisão 1 (escopo cadastrar/listar/remover) → todas as tasks. Decisão 2 (`secao_id`) → Task 1. Decisões 3-4 (`GET /api/pessoas`) → Task 2. Decisão 5 (`GET /api/pessoas/[publicId]`) → Task 3. Decisões 6-7 (`GET /api/secoes`) → Task 4. Decisão 8 (lista) → Task 7. Decisões 9-10 (form + duplicata) → Task 8. Decisões 11-14 (detalhe + remover + raiz sem responsável + último vínculo) → Task 9. Não-objetivos são estruturalmente impossíveis de violar (nenhuma task cria edição de pessoa, provisionamento de login, exclusão de pessoa, UI de auditoria ou árvore visual).
- **Placeholder scan:** nenhum "TBD"/"TODO"; todo passo mostra código completo, incluindo os 2 ramos do caso `responsavel_acima` null/não-null e o guard do último vínculo na Task 9.
- **Type consistency:** `Pessoa`, `Vinculo`, `Zona`, `Secao`, `Impacto` são redefinidos localmente em cada componente (sem tipo compartilhado — mesmo padrão já usado em `DashboardSuperadminClient.tsx`/`MapaCalorClient.tsx`, nenhum arquivo de tipos central no projeto) mas os *campos* batem entre a resposta declarada nas Tasks 2/3/4 e o consumo nas Tasks 7/8/9. `secao_id` tem o mesmo nome em `CriarPessoaInput` (Task 1), no body do `POST` (Task 1) e no formulário (Task 8). `MIN_CARACTERES`/`LIMITE_RESULTADOS` (Task 6) só existem no client, não afetam a assinatura de `GET /api/pessoas` (Task 2), que continua sem paginação/limite server-side.
