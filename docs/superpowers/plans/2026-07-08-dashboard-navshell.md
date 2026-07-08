# Fatia C1 — NavShell + `/dashboard` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `NavShell` (vira sidebar esquerda de largura fixa 240px, layout estrutural das telas autenticadas) e os 3 componentes de `/dashboard` (`AlertasList`, `EvolucaoChart`, `RankingTable`) com os tokens do design system já existentes — mesma disciplina das fatias A/B (fundação + auth restante).

**Architecture:** 4 tasks independentes, uma por arquivo (`NavShell.tsx`, `AlertasList.tsx`, `EvolucaoChart.tsx`, `RankingTable.tsx`). `NavShell` é a única com comportamento novo (destaque de link ativo via `usePathname()`) — as outras 3 são restilização pura de componentes já cobertos por teste, sem mudar fetch/estado/lógica. Nas 3 tasks de restilização pura, as edições são cirúrgicas (blocos `old_string`/`new_string` que tocam só import + `return`), nunca uma reescrita do arquivo inteiro — reduz o diff e torna estruturalmente impossível alterar `useEffect`/fetch/estado por engano.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, Tailwind v4 (`@theme` tokens já definidos em `web/app/globals.css`), Vitest + Testing Library, `recharts` (já uma dependência do projeto).

## Global Constraints

- Nenhuma mudança de lógica de fetch/estado/decisão de texto em nenhum dos 4 arquivos — só apresentação (spec, decisão geral).
- `Button` continua com 1 variante só — "Sair" NÃO usa `Button`, fica `<button>` nativo estilizado inline (spec, decisão 2).
- Nenhum componente `Table` novo — `RankingTable` estiliza `<table>` direto (spec, decisão 6).
- Nenhuma lib de ícones nova — os 2 ícones de `AlertasList` são SVG inline hand-authored no mesmo arquivo, `aria-hidden="true"`, tamanho controlado **só** via classe Tailwind (`h-5 w-5`) — nunca atributo `width`/`height` fixo no `<svg>` (spec, decisão 4).
- Cor do `EvolucaoChart`: `stroke="var(--color-secondary)"` exatamente (não hex, não `"#2563eb"` antigo) — valor verificado empiricamente em browser real, é literal, não aproximação (spec, decisão 5). Eixos (`XAxis`/`YAxis`) usam `tick={{ fill: 'var(--color-on-surface-variant)' }}` — sem isso os eixos ficam na cor cinza default do `recharts`, inconsistente com o resto do token system.
- Link ativo no `NavShell`: igualdade exata `pathname === href`, nunca prefixo (spec, decisão 1). Marcado via `aria-current={ativo ? 'page' : undefined}` — não via checagem de string de classe Tailwind: `aria-current="page"` é o atributo HTML semântico pra exatamente esse caso (item de navegação corrente), e um teste que verifica esse atributo continua correto mesmo se o valor de `className` mudar depois (ex.: trocar `bg-primary` por outra classe) — testar a classe diretamente acopla o teste a um detalhe de implementação que pode mudar sem o comportamento mudar.
- `NavShell` deixa de ser só uma barra de navegação e passa a ser o layout estrutural completo da área autenticada (sidebar + main) — isso fica documentado num comentário de uma linha no próprio arquivo, não só implícito na estrutura do JSX.
- Breakpoint responsivo: `md` (mesmo já usado em `/login`, `/superadmin/login`, `/redefinir-senha` — não `lg`, decisão consciente de manter consistência com o resto do projeto).
- `min-h-screen` (não `min-h-dvh`) — mesma decisão de manter consistência com as 3 telas de auth já existentes.
- `<main>` recebe só `min-w-0 flex-1 p-6` — **sem** `overflow-x-auto` no `<main>`: a tabela de `RankingTable` já tem seu próprio `overflow-x-auto` escopado a ela; adicionar outro no `<main>` criaria uma região de scroll aninhada (anti-padrão: 2 containers com scroll horizontal um dentro do outro é confuso pro usuário e não resolve nada que o `overflow-x-auto` da tabela já não resolva sozinho).
- Toda classe de foco visível replica exatamente o padrão já usado em `Button`/`Input`: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`.
- Nenhum teste novo em `AlertasList.test.tsx`, `EvolucaoChart.test.tsx`, `RankingTable.test.tsx` — são restilização pura, os testes existentes devem passar sem modificação. `NavShell.test.tsx` ganha exatamente 1 teste novo (link ativo) — os 3 existentes não mudam.

---

### Task 1: `NavShell` — sidebar + link ativo

**Files:**
- Modify: `web/app/components/NavShell.tsx`
- Test: `web/app/components/NavShell.test.tsx`

**Interfaces:**
- Consumes: `Link` (`next/link`), `usePathname` (`next/navigation`) — novo nesta task.
- Produces: `NavShell({ children }: { children: React.ReactNode })` — assinatura não muda, continua um Client Component (`'use client'`) que envolve `children` numa estrutura de sidebar + main. `/dashboard/DashboardClient.tsx` e `/mapa-calor/MapaCalorClient.tsx` continuam chamando `<NavShell>{...}</NavShell>` exatamente como hoje — nenhuma mudança de interface externa.

- [ ] **Step 1: Ler o arquivo atual pra confirmar o texto exato do teste existente**

Ler `web/app/components/NavShell.test.tsx` — já tem 3 casos (`renderiza os 2 links...`, `clicar em Sair dispara POST...`, `redireciona pro /login mesmo se o fetch falhar...`). Estes 3 não mudam.

- [ ] **Step 2: Escrever o teste novo (4º caso) — link ativo, via `aria-current`**

Substituir o conteúdo de `web/app/components/NavShell.test.tsx` por (adiciona `vi.mock('next/navigation', ...)` no topo e 1 novo `it(...)`, mantém os outros 3 idênticos):

```tsx
// web/app/components/NavShell.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { NavShell } from './NavShell';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

function renderNav() {
  return render(
    <NavShell>
      <p>conteudo-de-teste</p>
    </NavShell>,
  );
}

describe('NavShell', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
    // @ts-expect-error jsdom não navega de verdade — substitui por um objeto simples e observável
    delete window.location;
    // @ts-expect-error idem
    window.location = { href: '' };
  });

  it('renderiza os 2 links de navegação e o children', () => {
    renderNav();
    expect(screen.getByText('Mapa de Calor')).toHaveAttribute('href', '/mapa-calor');
    expect(screen.getByText('Dashboard')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('conteudo-de-teste')).toBeInTheDocument();
  });

  it('marca aria-current="page" só no link cujo href bate com o pathname atual', () => {
    renderNav();
    expect(screen.getByText('Dashboard')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Mapa de Calor')).not.toHaveAttribute('aria-current');
  });

  it('clicar em Sair dispara POST /api/auth/logout e redireciona pro /login', async () => {
    renderNav();
    fireEvent.click(screen.getByText('Sair'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    });
    await waitFor(() => {
      expect(window.location.href).toBe('/login');
    });
  });

  it('redireciona pro /login mesmo se o fetch falhar (falha de rede)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as never;
    renderNav();
    fireEvent.click(screen.getByText('Sair'));

    await waitFor(() => {
      expect(window.location.href).toBe('/login');
    });
  });
});
```

- [ ] **Step 3: Rodar e confirmar que o teste novo falha**

Run: `cd web && npx vitest run app/components/NavShell.test.tsx`
Expected: FAIL — o 2º caso ("marca aria-current...") falha porque `NavShell.tsx` ainda não seta `aria-current` em nenhum link. Os outros 3 casos continuam passando (comportamento de logout não mudou ainda).

- [ ] **Step 4: Implementar a sidebar**

Substituir o conteúdo de `web/app/components/NavShell.tsx` por:

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

async function sair() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.href = '/login';
}

const LINKS = [
  { href: '/mapa-calor', label: 'Mapa de Calor' },
  { href: '/dashboard', label: 'Dashboard' },
];

const focoVisivel =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

// NavShell é o layout estrutural das telas autenticadas (sidebar + área
// principal), não só uma barra de navegação — /dashboard e /mapa-calor
// dependem dele pra essa estrutura inteira.
export function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-row items-center justify-between gap-4 border-b border-outline-variant bg-surface-container-low px-6 py-4 md:w-[240px] md:flex-shrink-0 md:flex-col md:items-stretch md:justify-between md:border-b-0 md:border-r md:px-6 md:py-6">
        <div className="flex flex-row items-center gap-4 md:flex-col md:items-start md:gap-6">
          <p className="text-headline-md text-on-surface">Sistema Campanha</p>
          <nav aria-label="Navegação principal" className="flex flex-row gap-2 md:flex-col">
            {LINKS.map((link) => {
              const ativo = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={ativo ? 'page' : undefined}
                  className={`rounded px-4 py-2 text-body-md transition-colors ${focoVisivel} ${
                    ativo
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <button
          type="button"
          onClick={sair}
          className={`rounded px-4 py-2 text-left text-body-md text-on-surface-variant transition-colors hover:text-on-surface ${focoVisivel}`}
        >
          Sair
        </button>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5: Rodar e confirmar que os 4 testes passam**

Run: `cd web && npx vitest run app/components/NavShell.test.tsx`
Expected: PASS — 4/4.

- [ ] **Step 6: Commit**

```bash
git add web/app/components/NavShell.tsx web/app/components/NavShell.test.tsx
git commit -m "feat: restiliza NavShell como sidebar com destaque de rota ativa"
```

---

### Task 2: `AlertasList` — cards com ícone de severidade

**Files:**
- Modify: `web/app/dashboard/AlertasList.tsx` (edição cirúrgica — `useEffect`/fetch/estado ficam intocados)

**Interfaces:**
- Consumes: `Message` (`web/app/components/Message.tsx`, já existe desde a fatia B — `variant: 'error' | 'success'`).
- Produces: `AlertasList()` — assinatura não muda, `DashboardClient.tsx` continua chamando `<AlertasList />` sem props.

- [ ] **Step 1: Rodar o teste existente pra confirmar baseline**

Run: `cd web && npx vitest run app/dashboard/AlertasList.test.tsx`
Expected: PASS — 3/3 (baseline antes da mudança).

- [ ] **Step 2: Edit — adicionar o import de `Message` e os 2 ícones**

Em `web/app/dashboard/AlertasList.tsx`, trocar:

```tsx
import { useEffect, useState } from 'react';

type Alerta = {
  tipo: 'area' | 'lideranca_estagnada';
  alvo_id: string;
  label: string;
  detalhe: Record<string, unknown>;
};

export function AlertasList() {
```

por:

```tsx
import { useEffect, useState } from 'react';
import { Message } from '../components/Message';

type Alerta = {
  tipo: 'area' | 'lideranca_estagnada';
  alvo_id: string;
  label: string;
  detalhe: Record<string, unknown>;
};

function IconArea() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-5 w-5 flex-shrink-0 text-on-surface-variant"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 18s6-5.686 6-10a6 6 0 1 0-12 0c0 4.314 6 10 6 10Z"
      />
      <circle cx="10" cy="8" r="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLideranca() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-5 w-5 flex-shrink-0 text-on-surface-variant"
    >
      <circle cx="10" cy="6.5" r="3" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 17c0-3.314 2.686-6 6-6s6 2.686 6 6" />
    </svg>
  );
}

export function AlertasList() {
```

**Não muda:** o `useState`/`useEffect`/fetch logo abaixo continuam byte-a-byte idênticos — esta edição só adiciona código antes deles, não toca neles.

- [ ] **Step 3: Edit — trocar o render (erro/vazio/lista)**

No mesmo arquivo, trocar:

```tsx
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

por:

```tsx
  if (erro) return <Message variant="error">{erro}</Message>;
  if (!alertas) return null;

  if (alertas.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Nenhum alerta no momento.</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-headline-md text-on-surface">Alertas</h2>
      <ul className="flex flex-col gap-3">
        {alertas.map((a) => (
          <li
            key={`${a.tipo}-${a.alvo_id}`}
            className="flex items-start gap-3 rounded border border-outline-variant bg-surface-container px-4 py-3"
          >
            {a.tipo === 'area' ? <IconArea /> : <IconLideranca />}
            <p className="text-body-md text-on-surface">
              {a.tipo === 'area'
                ? `Zona ${a.label}: potencial acima da média com baixa penetração.`
                : `${a.label}: sem crescimento na sub-árvore nos últimos 30 dias.`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que os 3 testes continuam passando**

Run: `cd web && npx vitest run app/dashboard/AlertasList.test.tsx`
Expected: PASS — 3/3 (texto idêntico ao anterior em todos os 3 casos: os 2 tipos, estado vazio, erro — `Message` produz o mesmo `role="alert"` que o `<p role="alert">` anterior).

- [ ] **Step 5: Commit**

```bash
git add web/app/dashboard/AlertasList.tsx
git commit -m "feat: restiliza AlertasList como cards com ícone de severidade"
```

---

### Task 3: `EvolucaoChart` — cor do design system

**Files:**
- Modify: `web/app/dashboard/EvolucaoChart.tsx` (edição cirúrgica — `useEffect`/fetch/estado ficam intocados)

**Interfaces:**
- Consumes: `Message` (`web/app/components/Message.tsx`).
- Produces: `EvolucaoChart()` — assinatura não muda.

- [ ] **Step 1: Rodar o teste existente pra confirmar baseline**

Run: `cd web && npx vitest run app/dashboard/EvolucaoChart.test.tsx`
Expected: PASS — 3/3 (baseline antes da mudança).

- [ ] **Step 2: Edit — adicionar o import de `Message`**

Em `web/app/dashboard/EvolucaoChart.tsx`, trocar:

```tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

type Ponto = { dia: string; total: number };
```

por:

```tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Message } from '../components/Message';

type Ponto = { dia: string; total: number };
```

**Não muda:** o `useState`/`useEffect`/fetch continuam byte-a-byte idênticos.

- [ ] **Step 3: Edit — trocar o render (erro/vazio/gráfico)**

No mesmo arquivo, trocar:

```tsx
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

por:

```tsx
  if (erro) return <Message variant="error">{erro}</Message>;
  if (!pontos) return null;

  const temMovimentacao = pontos.some((p) => p.total > 0);
  if (!temMovimentacao) {
    return (
      <p className="text-body-md text-on-surface-variant">
        Nenhuma movimentação nos últimos 90 dias.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-headline-md text-on-surface">Evolução (90 dias)</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={pontos}>
          <XAxis dataKey="dia" tick={{ fill: 'var(--color-on-surface-variant)' }} />
          <YAxis allowDecimals={false} tick={{ fill: 'var(--color-on-surface-variant)' }} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-secondary)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que os 3 testes continuam passando**

Run: `cd web && npx vitest run app/dashboard/EvolucaoChart.test.tsx`
Expected: PASS — 3/3.

- [ ] **Step 5: Commit**

```bash
git add web/app/dashboard/EvolucaoChart.tsx
git commit -m "feat: EvolucaoChart usa cor secondary e tick color do design system"
```

---

### Task 4: `RankingTable` — tabela com tokens

**Files:**
- Modify: `web/app/dashboard/RankingTable.tsx` (edição cirúrgica — `useEffect`/fetch/estado ficam intocados)

**Interfaces:**
- Consumes: `Message` (`web/app/components/Message.tsx`).
- Produces: `RankingTable()` — assinatura não muda.

- [ ] **Step 1: Rodar o teste existente pra confirmar baseline**

Run: `cd web && npx vitest run app/dashboard/RankingTable.test.tsx`
Expected: PASS — 4/4 (baseline antes da mudança).

- [ ] **Step 2: Edit — adicionar o import de `Message`**

Em `web/app/dashboard/RankingTable.tsx`, trocar:

```tsx
'use client';
import { useEffect, useState } from 'react';

type RankingRow = {
```

por:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Message } from '../components/Message';

type RankingRow = {
```

**Não muda:** o `useState`/`useEffect`/fetch continuam byte-a-byte idênticos.

- [ ] **Step 3: Edit — trocar o render (erro/vazio/tabela)**

No mesmo arquivo, trocar:

```tsx
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

por:

```tsx
  if (erro) return <Message variant="error">{erro}</Message>;
  if (!linhas) return null;

  if (linhas.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Nenhum líder com sub-árvore ainda.</p>;
  }

  const { soma_ramos, total_real } = linhas[0];

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-headline-md text-on-surface">Ranking de lideranças</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-md text-on-surface">
          <thead className="bg-surface-container-low">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 text-right font-medium">Tamanho da sub-árvore</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.pessoa_id} className="border-t border-outline-variant">
                <td className="px-4 py-2">{l.nome}</td>
                <td className="px-4 py-2 text-right text-data-mono tabular-nums">
                  {l.subarvore_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-body-md text-on-surface-variant">
        Soma dos ramos: {soma_ramos} · Total real da campanha: {total_real}
        {soma_ramos !== total_real && (
          <> · {soma_ramos - total_real} apoiador(es) compartilhado(s) entre ramos.</>
        )}
      </p>
    </section>
  );
}
```

(o espaçamento entre a tabela e o parágrafo de resumo já vem do `gap-4` no `<section>` — não precisa de margem extra.)

- [ ] **Step 4: Rodar e confirmar que os 4 testes continuam passando**

Run: `cd web && npx vitest run app/dashboard/RankingTable.test.tsx`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add web/app/dashboard/RankingTable.tsx
git commit -m "feat: restiliza RankingTable com tokens, tabular-nums e alinhamento à direita"
```

---

### Task 5: Verificação visual final (Playwright, desktop + mobile)

**Files:** nenhum arquivo de produto — só verificação, sem commit de código.

**Interfaces:**
- Consumes: servidor de dev rodando (`npm run dev`), as 4 tasks anteriores completas.

- [ ] **Step 1: Rodar a suite inteira (integração das 4 tasks)**

Run: `cd web && npm test`
Expected: PASS — todos os testes do projeto (não só os 4 arquivos desta fatia). Esta é a checagem de integração final — não precisa de commit próprio porque nenhum arquivo de produto muda aqui, só verificação.

- [ ] **Step 2: Subir o servidor de dev**

Run: `cd web && npm run dev` (background)
Expected: `Ready` sem erro.

- [ ] **Step 3: Screenshot desktop (≥768px) de `/dashboard`**

Usar Playwright MCP (`browser_navigate` + `browser_resize` pra ~1280x800 + `browser_take_screenshot`) contra `http://localhost:<porta>/dashboard` (autenticado — usar sessão/cookie de teste já estabelecida no projeto, mesmo padrão das fatias anteriores).
Verificar visualmente:
- sidebar à esquerda (240px), link "Dashboard" destacado (`bg-primary`), "Mapa de Calor" não destacado;
- cards de alerta com ícone visível (se houver dados);
- tabela com coluna numérica alinhada à direita, monoespaçada;
- gráfico com linha teal (`secondary`), eixos na cor `on-surface-variant` (não cinza default do recharts);
- **contraste**: texto da sidebar/cards/tabela legível contra o fundo (checagem visual, os pares de token já foram validados matematicamente na fundação — aqui é só confirmar que a combinação nova de tokens não ficou visualmente estranha);
- **hover**: passar o mouse nos links da sidebar e no botão "Sair" — muda de cor suavemente (`transition-colors`), sem "salto".

- [ ] **Step 4: Verificação de teclado (foco visível)**

Usar `browser_press_key` (Tab repetido) navegando pela sidebar — confirmar que cada link e o botão "Sair" mostram o anel de foco (`focus-visible:outline`) na ordem visual esperada (wordmark não é focável, depois os 2 links, depois "Sair").

- [ ] **Step 5: Screenshot mobile (<768px) de `/dashboard`**

`browser_resize` pra ~375x800, `browser_take_screenshot`.
Verificar visualmente:
- sidebar vira faixa horizontal no topo (wordmark + nav + Sair lado a lado);
- conteúdo principal abaixo;
- **sem scroll horizontal na página** (a tabela deve rolar dentro do seu próprio `overflow-x-auto`, não estourar a largura da tela).

- [ ] **Step 6: Reportar quaisquer divergências visuais encontradas**

Se algo não bater com o esperado (ex.: overlap, texto cortado, cor errada, foco ausente, scroll horizontal na página), corrigir antes de finalizar a fatia — não é uma nova task, é ajuste dentro da task correspondente (1-4) que introduziu o problema.

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura do spec:** decisão 1 (sidebar+link ativo+foco+transição) → Task 1. Decisão 2 (Sair sem `Button`) → Task 1. Decisão 3 (`Message` nos 3 componentes) → Tasks 2/3/4. Decisão 4 (cards+ícones) → Task 2. Decisão 5 (`dataviz`, cor `secondary` + tick color) → Task 3. Decisão 6 (tabela sem componente novo, `tabular-nums`, alinhamento) → Task 4. Responsividade da sidebar → Task 1 (classes `md:`) + Task 5 (verificação visual real nos 2 tamanhos, incluindo ausência de scroll horizontal). Foco de teclado (achado da revisão ui-ux-pro-max) → Task 1 (implementação) + Task 5 Step 4 (verificação real via teclado). Débito documentado (tabela/resumo acessível do gráfico) → não vira task, propositalmente (spec já registra como fora de escopo).

**Placeholder scan:** nenhum "TBD"/"depois" — todo código é completo e literal, copiado das decisões do spec. Os blocos `old_string` das Tasks 2-4 foram conferidos contra o conteúdo atual real dos 3 arquivos (lido diretamente durante o brainstorming desta fatia), não reconstruídos de memória.

**Consistência de tipos:** `Alerta`, `Ponto`, `RankingRow` mantêm os mesmos nomes/campos do código atual (não removidos nem renomeados) — só a função de renderização muda em cada task.
