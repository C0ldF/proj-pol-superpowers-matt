# Logout de campanha + redirect pro /login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao usuário de campanha um jeito de sair (logout) pela UI, e
fazer `/dashboard`/`/mapa-calor` mandarem pro `/login` quando não
autenticado, em vez de mostrar texto morto.

**Architecture:** Duas peças independentes, sem arquivo em comum. (1)
`POST /api/auth/logout` (mesma estrutura de `web/app/api/superadmin/logout/
route.ts`, S7) + botão "Sair" no `NavShell` compartilhado. (2)
`web/app/dashboard/page.tsx` e `web/app/mapa-calor/page.tsx` trocam o
`return <p>não autenticado</p>` por `redirect('/login')` de
`next/navigation`.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript, Vitest +
`jsdom`/`@testing-library/react` (já existentes desde S4).

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/`
  (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência:
  `docs/superpowers/specs/2026-07-06-logout-redirect-campanha-design.md`.
- `POST /api/auth/logout` **não** checa autorização — sempre chama
  `signOut()` e sempre retorna `200 {ok:true}`, mesmo sem sessão ativa.
- Logout no `NavShell`: `await fetch('/api/auth/logout', {method:'POST'}).
  catch(() => {})` — o `.catch` vazio é obrigatório, garante que uma falha
  de rede não impede o `window.location.href = '/login'` de rodar depois.
- Redirect usa `redirect()` de `next/navigation`, não `router.push` nem
  texto inline. Sem preservar `?next=` — sempre `/login` puro.
- `NavShell` (`web/app/components/NavShell.tsx`) **não** precisa de
  `'use client'` própria — confirmado empiricamente nesta sessão (`render()`
  via `@testing-library/react` funciona sem contexto de router) e contra
  `web/node_modules/next/dist/docs/01-app/01-getting-started/
  05-server-and-client-components.md:176`: um arquivo importado e
  renderizado só por Client Components já faz parte do bundle cliente.
- Testes de componente que usam `render`/`screen`/`fireEvent` (RTL) exigem
  `import '@testing-library/jest-dom/vitest'` — sem isso, matchers como
  `toBeInTheDocument`/`toHaveAttribute` não existem (`Invalid Chai
  property`), confirmado empiricamente nesta sessão.
- Commits frequentes; mensagens estilo do repo (`feat: ...`, `test: ...`).

---

## Contexto de schema/API (não repetir nas tasks)

- `web/app/api/superadmin/logout/route.ts` (S7) — referência estrutural
  exata pra Task 1, corpo atual completo:
  ```typescript
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
- `web/app/components/NavShell.tsx` — conteúdo atual completo (Task 1
  modifica este arquivo):
  ```tsx
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
- `web/app/components/NavShell.test.tsx` — teste atual completo (Task 1
  reescreve este arquivo, preservando esta asserção):
  ```tsx
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
- `web/app/dashboard/page.tsx` — conteúdo atual completo (Task 2 modifica):
  ```tsx
  import { cookies } from 'next/headers';
  import { ssrClient } from '../../lib/supabase/ssr';
  import { DashboardClient } from './DashboardClient';

  export default async function DashboardPage() {
    const cookieStore = await cookies();
    const supabase = ssrClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return <p>não autenticado</p>;
    }

    return <DashboardClient />;
  }
  ```
- `web/app/dashboard/page.test.tsx` — teste atual completo (Task 2
  reescreve, trocando o teste do caso não-autenticado):
  ```tsx
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
- `web/app/mapa-calor/page.tsx` e `web/app/mapa-calor/page.test.tsx` — mesmo
  formato exato do dashboard acima, só com `MapaCalorClient`/`mapa-calor` no
  lugar de `DashboardClient`/`dashboard`.

---

### Task 1: Logout de campanha (`POST /api/auth/logout` + botão no `NavShell`)

**Files:**
- Create: `web/app/api/auth/logout/route.ts`
- Create: `web/app/api/auth/logout/route.test.ts`
- Modify: `web/app/components/NavShell.tsx`
- Modify: `web/app/components/NavShell.test.tsx`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`).
- Produces: `POST /api/auth/logout` — sempre `200 {ok:true}`, sem gate.
  Botão "Sair" no `NavShell`. Nenhuma task futura consome isso diretamente.

- [ ] **Step 1: Escrever o teste da rota**

```typescript
// web/app/api/auth/logout/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));

const signOut = vi.fn(async () => ({ error: null }));
vi.mock('../../../../lib/supabase/ssr', () => ({
  ssrClient: vi.fn(() => ({ auth: { signOut } })),
}));

import { POST } from './route';

describe('POST /api/auth/logout', () => {
  it('200 e chama signOut, mesmo sem sessão ativa', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/auth/logout/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/auth/logout/route.ts
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

Run: `cd web && npx vitest run app/api/auth/logout/route.test.ts`
Expected: PASS — 1/1

- [ ] **Step 5: Escrever o teste do `NavShell` (reescreve o arquivo inteiro, preservando a asserção original com RTL no lugar de `renderToStaticMarkup`)**

```tsx
// web/app/components/NavShell.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { NavShell } from './NavShell';

describe('NavShell', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
  });

  it('renderiza os 2 links de navegação e o children', () => {
    render(
      <NavShell>
        <p>conteudo-de-teste</p>
      </NavShell>,
    );
    expect(screen.getByText('Mapa de Calor')).toHaveAttribute('href', '/mapa-calor');
    expect(screen.getByText('Dashboard')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('conteudo-de-teste')).toBeInTheDocument();
  });

  it('clicar em Sair dispara POST /api/auth/logout', async () => {
    render(
      <NavShell>
        <p>conteudo-de-teste</p>
      </NavShell>,
    );
    fireEvent.click(screen.getByText('Sair'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    });
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/components/NavShell.test.tsx`
Expected: FAIL — `Unable to find an element with the text: Sair` (o botão
ainda não existe)

- [ ] **Step 7: Implementar o botão no `NavShell`**

```tsx
// web/app/components/NavShell.tsx
'use client';
import Link from 'next/link';

async function sair() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
}

export function NavShell({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header>
        <nav>
          <Link href="/mapa-calor">Mapa de Calor</Link>
          {' '}
          <Link href="/dashboard">Dashboard</Link>
          {' '}
          <button onClick={sair}>Sair</button>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

Nota: `NavShell` ganha `'use client'` porque agora define um `onClick`
próprio (evento de interação) — diferente da premissa da Global Constraint
acima (que dizia que ele "não precisa" da diretiva enquanto só continha
`Link`s estáticos e nenhum event handler próprio). Um arquivo que define
seu próprio `onClick` precisa da diretiva onde a função é declarada, ainda
que ele já fosse alcançado só por Client Components — a regra do
`05-server-and-client-components.md:176` cobre "não precisar adicionar a
outros componentes", não "nunca precisar em nenhum arquivo com handler
próprio". Adicionar `'use client'` aqui é seguro e não muda nenhum
comportamento de bundle além do já existente (o arquivo já estava no grafo
client).

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/components/NavShell.test.tsx`
Expected: PASS — 2/2

- [ ] **Step 9: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes.

- [ ] **Step 10: Commit**

```bash
git add web/app/api/auth/logout/route.ts web/app/api/auth/logout/route.test.ts web/app/components/NavShell.tsx web/app/components/NavShell.test.tsx
git commit -m "feat: logout de campanha (POST /api/auth/logout + botão Sair no NavShell)"
```

---

### Task 2: Redirect pro `/login` em `/dashboard` e `/mapa-calor`

**Files:**
- Modify: `web/app/dashboard/page.tsx`
- Modify: `web/app/dashboard/page.test.tsx`
- Modify: `web/app/mapa-calor/page.tsx`
- Modify: `web/app/mapa-calor/page.test.tsx`

**Interfaces:**
- Consumes: `ssrClient` (`web/lib/supabase/ssr.ts`), `redirect` de
  `next/navigation`.
- Produces: nenhuma interface nova — comportamento observável (redirect em
  vez de texto). Nenhuma task futura consome isso.

- [ ] **Step 1: Escrever o teste do `/dashboard` (reescreve o arquivo, trocando só o teste do caso não-autenticado)**

```tsx
// web/app/dashboard/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('./DashboardClient', () => ({
  DashboardClient: () => 'dashboard-client-mock',
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

import { ssrClient } from '../../lib/supabase/ssr';
import { redirect } from 'next/navigation';
import Page from './page';

describe('/dashboard page', () => {
  it('redireciona pro /login quando não autenticado, sem renderizar o dashboard', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renderiza o dashboard quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('dashboard-client-mock');
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/dashboard/page.test.tsx`
Expected: FAIL — o primeiro teste falha porque a página ainda retorna
`<p>não autenticado</p>` em vez de chamar `redirect`, então `Page()` não
rejeita e a asserção `rejects.toThrow` falha.

- [ ] **Step 3: Implementar o redirect em `/dashboard`**

```tsx
// web/app/dashboard/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ssrClient } from '../../lib/supabase/ssr';
import { DashboardClient } from './DashboardClient';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <DashboardClient />;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/dashboard/page.test.tsx`
Expected: PASS — 2/2

- [ ] **Step 5: Escrever o teste do `/mapa-calor` (mesmo formato exato, trocado `DashboardClient`/`dashboard` por `MapaCalorClient`/`mapa-calor`)**

```tsx
// web/app/mapa-calor/page.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock('../../lib/supabase/ssr', () => ({ ssrClient: vi.fn() }));
vi.mock('./MapaCalorClient', () => ({
  MapaCalorClient: () => 'mapa-calor-client-mock',
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));

import { ssrClient } from '../../lib/supabase/ssr';
import { redirect } from 'next/navigation';
import Page from './page';

describe('/mapa-calor page', () => {
  it('redireciona pro /login quando não autenticado, sem renderizar o mapa', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    } as never);

    await expect(Page()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renderiza o mapa quando autenticado', async () => {
    vi.mocked(ssrClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } }, error: null }) },
    } as never);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('mapa-calor-client-mock');
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/mapa-calor/page.test.tsx`
Expected: FAIL — mesma razão do Step 2, agora pro `/mapa-calor`.

- [ ] **Step 7: Implementar o redirect em `/mapa-calor`**

```tsx
// web/app/mapa-calor/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ssrClient } from '../../lib/supabase/ssr';
import { MapaCalorClient } from './MapaCalorClient';

export default async function MapaCalorPage() {
  const cookieStore = await cookies();
  const supabase = ssrClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <MapaCalorClient />;
}
```

- [ ] **Step 8: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/mapa-calor/page.test.tsx`
Expected: PASS — 2/2

- [ ] **Step 9: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam.

- [ ] **Step 10: Commit**

```bash
git add web/app/dashboard/page.tsx web/app/dashboard/page.test.tsx web/app/mapa-calor/page.tsx web/app/mapa-calor/page.test.tsx
git commit -m "feat: /dashboard e /mapa-calor redirecionam pro /login quando não autenticado"
```

---

## Self-Review

**1. Cobertura do spec:** decisão 1 (duas peças, sem arquivo em comum) →
Task 1 (4 arquivos: rota + teste + `NavShell` + teste) e Task 2 (4 arquivos:
2 páginas + 2 testes), zero overlap confirmado; decisão 2 (rota nova, não
reaproveita `/api/superadmin/logout`) → Task 1 Step 3, path
`web/app/api/auth/logout/`; decisão 3 (sem checagem de autorização) → Task
1 Step 3 (sem `requireX` nenhum antes do `signOut`); decisão 4 (`NavShell`
sem `'use client'` própria — na prática ganhou a diretiva no Step 7 porque
o botão introduz `onClick` que a decisão 4 original não previa
explicitamente; note de correção deixada no próprio Step 7) → Task 1;
decisão 5 (`.catch(() => {})` antes do redirect) → Task 1 Step 7; decisão 6
(`redirect()` de `next/navigation`) → Task 2 Steps 3 e 7; decisão 7 (sem
`?next=`) → Task 2 (nenhum query param usado); decisão 8 (gotcha de teste
do `redirect`, mock que lança) → Task 2 Steps 1 e 5. Os 6 itens de teste do
spec → cobertos 1:1 pelas Tasks 1 (testes 1-3) e 2 (testes 4-6, dobrados
pras duas páginas). Não-objetivos: nenhuma task adiciona `?next=`, mexe em
`/superadmin/*`, cria redirect em outras páginas, adiciona CSS, ou mexe em
`audit_log` — confirmado por omissão.

**Gap encontrado e corrigido durante o self-review:** a decisão 4 do spec
("`NavShell` não precisa de `'use client'` própria") foi verificada e
confirmada correta *para o código anterior a esta fatia* (sem handler
próprio) — mas a implementação do botão "Sair" (Step 7) introduz um
`onClick` definido dentro do próprio `NavShell.tsx`, o que aciona a regra
"Client Components need event handlers" independente de quem importa o
arquivo. `'use client'` foi adicionado no Step 7 com uma nota explicando a
diferença. Isso não contradiz a decisão 4 (que falava do estado do arquivo
antes da mudança) — é a mudança do Step 7 que muda a premissa.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda
task tem código completo (teste + implementação), incluindo os 2 arquivos
inteiros reescritos no lugar de diffs parciais.

**3. Consistência de tipos:** `POST /api/auth/logout` (Task 1) e
`redirect('/login')` (Task 2) não compartilham nenhuma interface TS — são
independentes. `sair()` (Task 1) e `entrar()` (página `/login`, fatia
anterior) seguem o mesmo padrão de nomes em português já estabelecido nas
páginas de auth do projeto.

---

Plano completo e salvo em `docs/superpowers/plans/2026-07-06-logout-redirect-campanha.md`.
