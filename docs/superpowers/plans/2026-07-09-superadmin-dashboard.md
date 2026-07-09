# Fatia D `/superadmin/dashboard` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `/superadmin/dashboard` (last screen without the design system) — barra superior, "Nova campanha" form card, campaigns table — using the project's existing `Input`/`Button`/`Message` components and Tailwind design tokens, with zero behavior change.

**Architecture:** All changes are confined to `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx`. No new shared component, no new pure module (unlike fatia C2) — this is presentation-only. The JSX return block is edited in disjoint, independently-valid regions across 3 tasks: (1) imports + barra superior + outer wrapper, (2) the "Nova campanha" form, (3) the campaigns table + the top-level error guard.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 (design tokens in `web/app/globals.css`), Vitest + Testing Library + jsdom.

## Global Constraints

- Existing `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx` (11 cases) must keep passing **unmodified** — none of them test color/style, only fetch/state/visible text. Every task ends by running this file and confirming all 11 still pass.
- Do not change: `getByPlaceholderText` targets (`"Subdomínio"`, `"Nome"`, `"Código IBGE do município"`, `"Data da eleição"`), `getByRole('checkbox', { name: modulo })` (the `aria-label={m}` on the checkbox `<input>`), `getByText(rótulo)` targets (`"Sair"`, `"Nova campanha"`, `"Suspender"`, `"Reativar"`, `"Encerrar"`), `getByRole('alert')` (both error banners).
- No `redirect()` added to `web/app/superadmin/dashboard/page.tsx` — it is not touched by this plan at all.
- No new `Select` component, no shared barra-superior component — both explicit non-goals in the spec (YAGNI, `/superadmin/*` and campanha nav are intentionally decoupled).
- Test runner: from `web/`, `npx vitest run <path>` for a single file, `npm test` for the whole suite.
- Select/label pattern (reused verbatim from fatia C2): classes
  `rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant` plus the shared `focoVisivel` focus-visible chain, on the `<select>`, wrapped in `<label className="flex flex-col gap-1">` with `<span className="text-label-md text-on-surface-variant">`.
- `Input` (`web/app/components/Input.tsx`): props `{ label: string; error?: boolean; id?: string } & ComponentProps<'input'>`. `label` is required.
- `Button` (`web/app/components/Button.tsx`): props `ComponentProps<'button'> & { className?: string }`, defaults `type="button"`. Used in this plan only for the "Nova campanha" submit button (Task 2) — **not** for the table's status buttons (Task 3 uses a plain `<button>` there, see that task for why).
- `Message` (`web/app/components/Message.tsx`): props `{ variant: 'error' | 'success'; children }`. `variant="error"` renders `role="alert"`.
- Do not change the relative order of any element the test file queries by (`getByPlaceholderText`, `getByRole`, `getByText`) beyond what styling strictly requires (e.g. wrapping an existing `<input>` in a new `Input`/`<label>` is fine; inserting an unrelated new element between a query target and its sibling is not).

---

## File Structure

- **Modify only** `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx` — imports, a new module-level `focoVisivel` constant, the top-level `erro` early-return, and the JSX inside the component's `return`.
- **No changes** to `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`, `web/app/superadmin/dashboard/page.tsx`, or any other file.

---

### Task 1: Imports, barra superior, outer wrapper

**Files:**
- Modify: `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx` (top of file: imports + new constant; inside the component: the opening of the `return` JSX and its final closing tags)
- Test: `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx` (regression only, not modified)

**Interfaces:**
- Consumes: nothing new from other tasks (this is the first task).
- Produces: nothing other tasks in this plan need to import — every later task edits the same file directly.

- [ ] **Step 1: Update the import block and add `focoVisivel`**

In `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx`, locate the top of the file (the `'use client'` directive through the `MODULOS`/`CARGOS` imports). Replace it with:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { Message } from '../../components/Message';
import { MODULOS, type Modulo } from '../../../lib/modulos';
import { CARGOS, ABRANGENCIAS, type Cargo, type Abrangencia } from '../../../lib/campanha/constantes';

const focoVisivel =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
```

- [ ] **Step 2: Replace the barra superior (open the wrapper + header, remove the bare `Sair` button)**

Locate, inside `export function DashboardSuperadminClient()`, the start of the `return` statement through the opening of the form (the `<button onClick={sair}>Sair</button>` line and the blank line after it):

```tsx
  return (
    <div>
      <button onClick={sair}>Sair</button>

      <form onSubmit={criarCampanha}>
```

Replace with:

```tsx
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-4">
        <p className="text-headline-md text-on-surface">Painel Superadmin</p>
        <button
          type="button"
          onClick={sair}
          className={`rounded px-4 py-2 text-body-md text-on-surface-variant transition-colors hover:text-on-surface ${focoVisivel}`}
        >
          Sair
        </button>
      </header>
      <main className="flex flex-col gap-6 p-6">
      <form onSubmit={criarCampanha}>
```

Note: the `<form>` tag and everything after it (the form's fields, the table) stay exactly as they are for now — Tasks 2 and 3 restyle them. This step only changes the outer wrapper and the barra superior; the file is left with mismatched indentation between the new `<main>` and the still-untouched form/table content, which is fine — indentation doesn't affect test behavior and Task 2/3 will clean it up as they rewrite those blocks.

- [ ] **Step 3: Close the new `<main>` wrapper**

Locate the very end of the same `return` statement (the closing `</table>` down through the closing `</div>` and `);`):

```tsx
      </table>
    </div>
  );
```

Replace with:

```tsx
      </table>
      </main>
    </div>
  );
```

- [ ] **Step 4: Run the regression test**

Run (from `web/`): `npx vitest run app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
Expected: PASS (11/11, unmodified) — the barra superior change doesn't affect any of the 11 test queries (`"Sair"` text is still present, still fires `sair()` on click).

- [ ] **Step 5: Commit**

```bash
git add web/app/superadmin/dashboard/DashboardSuperadminClient.tsx
git commit -m "feat(superadmin-dashboard): barra de topo tokenizada (título da aplicação + Sair)"
```

---

### Task 2: "Nova campanha" form card

**Files:**
- Modify: `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx` (the `<form onSubmit={criarCampanha}>...</form>` block, unchanged by Task 1)
- Test: `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx` (regression only, not modified)

**Interfaces:**
- Consumes: `Input`, `Button`, `Message` imports and the `focoVisivel` constant from Task 1.
- Produces: `selectClassName` (module-level constant, added by Step 1 below) — the single definition of the tokenized `<select>` look, reused by both `cargo` and `abrangencia` in this task's Step 2 instead of repeating the class string twice.

- [ ] **Step 1: Add the `selectClassName` constant**

Locate the `focoVisivel` constant added in Task 1:

```tsx
const focoVisivel =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
```

Add immediately after it:

```tsx
const focoVisivel =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const selectClassName = `rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant ${focoVisivel}`;
```

- [ ] **Step 2: Replace the form block**

Locate the `<form onSubmit={criarCampanha}>` block (starts right after `<main className="flex flex-col gap-6 p-6">` from Task 1, ends at its matching `</form>`):

```tsx
      <form onSubmit={criarCampanha}>
        <input value={subdominio} onChange={(e) => setSubdominio(e.target.value)} placeholder="Subdomínio" />
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome" />
        <select aria-label="cargo" value={cargo} onChange={(e) => setCargo(e.target.value as Cargo)}>
          {CARGOS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          aria-label="abrangência"
          value={abrangencia}
          onChange={(e) => setAbrangencia(e.target.value as Abrangencia)}
        >
          {ABRANGENCIAS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {abrangencia === 'municipal' ? (
          <input
            type="number"
            value={municipioId}
            onChange={(e) => setMunicipioId(e.target.value)}
            placeholder="Código IBGE do município"
          />
        ) : (
          <input value={uf} onChange={(e) => setUf(e.target.value)} placeholder="UF" maxLength={2} />
        )}
        <input
          type="date"
          value={dataEleicao}
          onChange={(e) => setDataEleicao(e.target.value)}
          placeholder="Data da eleição"
        />
        <button type="submit">Nova campanha</button>
        {erroCriar && <p role="alert">{erroCriar}</p>}
      </form>
```

Replace with:

```tsx
      <div className="rounded border border-outline-variant bg-surface-container-lowest p-6">
        <h2 className="mb-4 text-headline-md text-on-surface">Nova campanha</h2>
        <form onSubmit={criarCampanha} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Subdomínio"
            value={subdominio}
            onChange={(e) => setSubdominio(e.target.value)}
            placeholder="Subdomínio"
          />
          <Input
            label="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome"
          />
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Cargo</span>
            <select
              aria-label="cargo"
              value={cargo}
              onChange={(e) => setCargo(e.target.value as Cargo)}
              className="rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {CARGOS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Abrangência</span>
            <select
              aria-label="abrangência"
              value={abrangencia}
              onChange={(e) => setAbrangencia(e.target.value as Abrangencia)}
              className="rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {ABRANGENCIAS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          {abrangencia === 'municipal' ? (
            <Input
              label="Código IBGE do município"
              type="number"
              value={municipioId}
              onChange={(e) => setMunicipioId(e.target.value)}
              placeholder="Código IBGE do município"
            />
          ) : (
            <Input
              label="UF"
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              placeholder="UF"
              maxLength={2}
            />
          )}
          <Input
            label="Data da eleição"
            type="date"
            value={dataEleicao}
            onChange={(e) => setDataEleicao(e.target.value)}
            placeholder="Data da eleição"
          />
          <Button type="submit" className="md:col-span-2">
            Nova campanha
          </Button>
          {erroCriar && <Message variant="error">{erroCriar}</Message>}
        </form>
      </div>
```

Note: the conditional `município`/`UF` rendering (`abrangencia === 'municipal' ? ... : ...`) is preserved exactly — only the two branches' JSX (raw `<input>` → `Input`) changed, not the condition or its structure.

- [ ] **Step 3: Run the regression test**

Run: `npx vitest run app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
Expected: PASS (11/11) — in particular, the 3 tests that submit the form (`getByPlaceholderText('Subdomínio')`, `'Nome'`, `'Código IBGE do município'`, `'Data da eleição'`, then `getByText('Nova campanha')`) and the 1 test asserting `erro na criação mostra body.erro em role="alert"`.

- [ ] **Step 4: Commit**

```bash
git add web/app/superadmin/dashboard/DashboardSuperadminClient.tsx
git commit -m "feat(superadmin-dashboard): form Nova campanha em card com grid + Input/Button/Message"
```

---

### Task 3: Campaigns table + status buttons + list-level error

**Files:**
- Modify: `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx` (the top-level `if (erro) return ...` guard, and the `<table>...</table>` block, both unchanged by Tasks 1-2)
- Test: `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx` (regression only, not modified)

**Interfaces:**
- Consumes: `Message` import from Task 1. Deliberately does **not** consume `Button` — see Step 2's note on why the status buttons are a plain `<button>` instead.

- [ ] **Step 1: Replace the list-level error guard**

Locate, near the top of `export function DashboardSuperadminClient()`'s body (right before `if (!campanhas) return null;`):

```tsx
  if (erro) return <p role="alert">{erro}</p>;
```

Replace with:

```tsx
  if (erro) return <Message variant="error">{erro}</Message>;
```

- [ ] **Step 2: Replace the table block**

Locate the `<table>` block (starts right after the form's closing `</div>` from Task 2, ends at its matching `</table>`):

```tsx
      <table>
        <thead>
          <tr>
            <th>Campanha</th>
            {MODULOS.map((m) => (
              <th key={m}>{m}</th>
            ))}
            <th>Status</th>
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
              <td>
                {c.status}
                {PROXIMOS_STATUS[c.status].map(({ novoStatus, rotulo }) => (
                  <button
                    key={novoStatus}
                    type="button"
                    disabled={carregando === `status:${c.id}`}
                    onClick={() => mudarStatus(c, novoStatus)}
                  >
                    {rotulo}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
```

Replace with:

```tsx
      <div className="flex flex-col gap-4">
        <h2 className="text-headline-md text-on-surface">Campanhas</h2>
        <div className="rounded border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-md text-on-surface">
              <thead className="bg-surface-container-low">
                <tr>
                  <th className="px-4 py-2 font-medium">Campanha</th>
                  {MODULOS.map((m) => (
                    <th key={m} className="px-4 py-2 text-center font-medium">
                      {m}
                    </th>
                  ))}
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {campanhas.map((c) => (
                  <tr key={c.id} className="border-t border-outline-variant">
                    <td className="px-4 py-2">
                      {c.nome} ({c.subdominio})
                    </td>
                    {MODULOS.map((m) => {
                      const habilitado = c.modulos_habilitados.includes(m);
                      const chave = `${c.id}:${m}`;
                      return (
                        <td key={m} className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={m}
                            checked={habilitado}
                            disabled={carregando === chave}
                            onChange={() => alternar(c, m, habilitado)}
                            className="accent-primary"
                          />
                        </td>
                      );
                    })}
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span>{c.status}</span>
                        {PROXIMOS_STATUS[c.status].map(({ novoStatus, rotulo }) => (
                          <button
                            key={novoStatus}
                            type="button"
                            disabled={carregando === `status:${c.id}`}
                            onClick={() => mudarStatus(c, novoStatus)}
                            className={`inline-flex items-center justify-center rounded bg-primary px-3 py-1.5 text-body-md text-on-primary transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary ${focoVisivel}`}
                          >
                            {rotulo}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
```

Note: the status buttons use a plain `<button>`, not the shared `Button` component, and reuse the shared `focoVisivel` constant from Task 1 for the focus-visible chain. `Button` hardcodes `px-6 py-3` (`web/app/components/Button.tsx:9`) sized for a form CTA — too large for a table cell here. Tailwind utilities of the same CSS property (`px-6` vs. a smaller override) don't reliably resolve by where they appear in a `className` string, so overriding `Button` via `className` is not a dependable way to get a smaller button; writing the button's own complete className directly (as above) is the only deterministic option that doesn't also require modifying the shared `Button` component (out of scope — this plan touches only `DashboardSuperadminClient.tsx`, and `Button` is used by 4+ other screens). This is not a copy of `Button`'s implementation to keep in sync — it's this table's own definition of a primary action, expressed with the same design tokens, the same way `RankingTable`/`AlertasList` each write their own Tailwind classes rather than importing a shared className string.

- [ ] **Step 3: Run the regression test**

Run: `npx vitest run app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
Expected: PASS (11/11) — in particular the checkbox tests (`getByRole('checkbox', { name: 'comunicacao' })`/`'ia'`), the status-button tests (`getByText('Suspender')`/`'Reativar'`/`'Encerrar'`), and `mostra erro quando a busca de campanhas falha` (now via `Message`, still `role="alert"`).

- [ ] **Step 4: Commit**

```bash
git add web/app/superadmin/dashboard/DashboardSuperadminClient.tsx
git commit -m "feat(superadmin-dashboard): tabela de campanhas tokenizada, botoes de status compactos, erro via Message"
```

---

### Task 4: Full suite + lint + visual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run (from `web/`): `npm test`
Expected: all suites PASS, including `app/superadmin/dashboard/DashboardSuperadminClient.test.tsx` (11 tests, unmodified).

- [ ] **Step 2: Run lint**

Run (from `web/`): `npm run lint`
Expected: no *new* errors introduced by this plan. Note: as of fatia C2, `npm run lint` reports 5 pre-existing `react-hooks/set-state-in-effect` errors project-wide, one of which is in this exact file (`DashboardSuperadminClient.tsx`, the `setErro(null)` inside the fetch `useEffect` — untouched by any task in this plan). That finding is already logged as pre-existing/out-of-scope; do not fix it here. If `npm run lint` reports anything **new** pointing at code this plan touched, fix it before moving on.

- [ ] **Step 3: Visual verification checklist**

Run: `npm run dev` (from `web/`), navigate to `/superadmin/dashboard` with a superadmin session, check:
- Barra superior: título da aplicação "Painel Superadmin" + "Sair" button, matches `NavShell`'s text-button treatment.
- Form: card with border, 2-column grid on desktop, 1 column on mobile viewport width, `Input`s have visible labels above each field.
- Table: header row `bg-surface-container-low`, row borders, checkboxes tinted with the primary color (`accent-primary`), status buttons visibly smaller than a normal form-CTA `Button` (Task 3's native `<button>` uses `px-3 py-1.5`, not `Button`'s `px-6 py-3` — this is deterministic by construction, but confirm it visually anyway since this is the one styling decision in the plan with a stated technical rationale).
- No horizontal scroll on the page itself at mobile width — only the table's own `overflow-x-auto` should scroll if the table is wider than the viewport.
- Both error banners (list-load failure, creation failure) render via `Message` (rounded, tinted background) instead of plain text.

- [ ] **Step 4: Stop the dev server**

If left running in the background, stop it once verification is done.

## Definition of Done

- No functional change: fetch calls, state shape, validation, and `page.tsx` are byte-identical to before this plan.
- All 11 existing tests in `DashboardSuperadminClient.test.tsx` pass unmodified.
- `npm test` passes (full suite).
- `npm run lint` introduces no new errors (the 5 pre-existing `react-hooks/set-state-in-effect` findings, including the one in this file, are unrelated to this plan and untouched).
- Layout consistent with the design system: `Input`/`Button`/`Message` reused where applicable, tokens (not raw colors) everywhere, same visual family as `/dashboard` (`RankingTable`) and `/mapa-calor`.
- No file other than `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx` modified.

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (no `NavShell`, local structure) → Task 1. Decision 2 (barra superior) → Task 1. Decision 3 (form card) → Task 2. Decision 4 (table visual match, checkbox `accent-primary`) → Task 3. Decision 5 (status buttons, deterministic single implementation — native `<button>` from the start, no `Button`-override/runtime-check/fallback branch) → Task 3. Decision 6 (`erro` → `Message`) → Task 3 Step 1. All 7 non-goals (no redirect, no `Select`, no shared barra-superior component, no fetch/state changes, `/superadmin/login` untouched, no pagination/search, test-surface preserved) are structurally impossible to violate given the plan only ever replaces JSX markup inside `DashboardSuperadminClient.tsx` and never touches `page.tsx`, fetch calls, or state hooks.
- **Placeholder scan:** no TBD/TODO; every step shows complete code. No task branches on a runtime outcome anymore — Task 3's status button is one deterministic implementation, not a "try X, fall back to Y if it doesn't work" conditional.
- **Type consistency:** `Cargo`/`Abrangencia`/`Modulo`/`StatusCampanha` types are untouched throughout (no task modifies the type definitions or the `CARGOS`/`ABRANGENCIAS`/`MODULOS`/`PROXIMOS_STATUS` constants) — only the JSX rendering those values changes. `focoVisivel` (Task 1) and `selectClassName` (Task 2) are the only 2 new module-level constants, each introduced in the same task/commit that first uses them (no dead/unused-until-later-task state).
