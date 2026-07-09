# Fatia C2 `/mapa-calor` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `/mapa-calor` to match the design system rollout (fatia C2): marker color driven by data magnitude via the existing 13-step heatmap ramps, a new gradient legend, tokenized controls/card/popup, and `<Message>` for errors.

**Architecture:** New pure module `web/lib/mapa-calor/cor-por-valor.ts` (no React/DOM/Tailwind/MapLibre dependency) provides `indiceStep`, `corPorValor`, `limitesValores` — built test-first. `MapaCalorClient.tsx` imports this module and wires it into the existing marker-drawing `useEffect`, adds a legend, restyles controls/card/popup, and swaps the raw error `<p>` for `<Message>`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 (design tokens in `web/app/globals.css`), MapLibre GL JS, Vitest + Testing Library + jsdom.

## Global Constraints

- Design tokens only — no raw hex/rgb in JSX. Heatmap ramp tokens: `--color-heatmap-{forca|potencial|penetracao}-{100..700}` (13 steps, step increment 50), already defined in `web/app/globals.css:54-96`. Null-value token: `--color-on-surface-variant` (`web/app/globals.css:14`).
- `STEPS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700] as const` — 13 entries, index 0-12.
- Fetch contract unchanged: `/api/mapa-calor?granularidade=zona|bairro` refetches only on `granularidade` change, never on `camada` change. Do not touch this.
- XSS fix from S4 unchanged: popup content built via `document.createElement` + `Popup#setDOMContent`, never `Popup#setHTML` and never raw HTML strings.
- No new `Select` component — only 2 `<select>` uses in the whole project (YAGNI, same discipline as `Button`/`Input`/`Message`).
- No generic/reusable legend component outside `MapaCalorClient.tsx` — only 1 use.
- Existing `web/app/mapa-calor/MapaCalorClient.test.tsx` (4 cases) must keep passing **unmodified** — none of them test color/style, only fetch/state. Every task that touches `MapaCalorClient.tsx` ends by running this file and confirming all 4 still pass.
- Test runner: from `web/`, `npx vitest run <path>` for a single file, `npm test` for the whole suite.

---

## File Structure

- **Create** `web/lib/mapa-calor/cor-por-valor.ts` — pure functions: `STEPS`, `indiceStep`, `corPorValor`, `limitesValores`. No framework dependency.
- **Create** `web/lib/mapa-calor/cor-por-valor.test.ts` — unit tests for the 3 functions above, TDD.
- **Modify** `web/app/mapa-calor/MapaCalorClient.tsx` — import the pure module, replace `CORES`/opacity marker logic, add legend, restyle controls/card/popup, swap error `<p>` for `<Message>`.
- **No changes** to `web/app/mapa-calor/MapaCalorClient.test.tsx` — used only as a regression check after each `MapaCalorClient.tsx` edit.

---

### Task 1: `indiceStep`

**Files:**
- Create: `web/lib/mapa-calor/cor-por-valor.ts`
- Test: `web/lib/mapa-calor/cor-por-valor.test.ts`

**Interfaces:**
- Produces: `export const STEPS: readonly [100,150,200,250,300,350,400,450,500,550,600,650,700]`
- Produces: `export function indiceStep(valor: number, min: number, max: number): number` — returns an index into `STEPS` (0-12).

- [ ] **Step 1: Write the failing tests**

Create `web/lib/mapa-calor/cor-por-valor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { STEPS, indiceStep } from './cor-por-valor';

describe('indiceStep', () => {
  it('valor no mínimo retorna índice 0', () => {
    expect(indiceStep(10, 10, 50)).toBe(0);
  });

  it('valor no máximo retorna índice 12 (STEPS.length - 1)', () => {
    expect(indiceStep(50, 10, 50)).toBe(STEPS.length - 1);
  });

  it('valor no meio retorna índice ~6', () => {
    expect(indiceStep(30, 10, 50)).toBe(6);
  });

  it('min === max retorna o step central (índice 6)', () => {
    expect(indiceStep(30, 30, 30)).toBe(6);
  });

  it('valor abaixo do mínimo é clampado pro índice 0', () => {
    expect(indiceStep(-100, 10, 50)).toBe(0);
  });

  it('valor acima do máximo é clampado pro índice 12 (STEPS.length - 1)', () => {
    expect(indiceStep(999, 10, 50)).toBe(STEPS.length - 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `web/`): `npx vitest run lib/mapa-calor/cor-por-valor.test.ts`
Expected: FAIL — `Cannot find module './cor-por-valor'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `web/lib/mapa-calor/cor-por-valor.ts`:

```ts
export const STEPS = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700] as const;

export function indiceStep(valor: number, min: number, max: number): number {
  if (min === max) return 6; // step 400 — centro exato dos 13 steps (índice 6 de 0-12)
  const proporcao = (valor - min) / (max - min);
  const indice = Math.round(proporcao * (STEPS.length - 1));
  return Math.max(0, Math.min(STEPS.length - 1, indice)); // clamp defensivo p/ valor fora de [min, max]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/mapa-calor/cor-por-valor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/lib/mapa-calor/cor-por-valor.ts web/lib/mapa-calor/cor-por-valor.test.ts
git commit -m "feat(mapa-calor): indiceStep — mapeia valor pra índice da rampa de 13 steps"
```

---

### Task 2: `corPorValor`

**Files:**
- Modify: `web/lib/mapa-calor/cor-por-valor.ts`
- Test: `web/lib/mapa-calor/cor-por-valor.test.ts`

**Interfaces:**
- Consumes: `STEPS`, `indiceStep(valor, min, max)` from Task 1.
- Produces: `export function corPorValor(valor: number | null, min: number, max: number, camada: 'forca' | 'potencial' | 'penetracao'): string` — returns a `var(--color-...)` CSS string.

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/mapa-calor/cor-por-valor.test.ts`:

```ts
import { corPorValor } from './cor-por-valor';

describe('corPorValor', () => {
  it('valor null retorna cinza neutro, independente da camada', () => {
    expect(corPorValor(null, 0, 10, 'forca')).toBe('var(--color-on-surface-variant)');
    expect(corPorValor(null, 0, 10, 'penetracao')).toBe('var(--color-on-surface-variant)');
  });

  it('valor no mínimo retorna o token do step 100 da camada', () => {
    expect(corPorValor(0, 0, 10, 'forca')).toBe('var(--color-heatmap-forca-100)');
    expect(corPorValor(0, 0, 10, 'potencial')).toBe('var(--color-heatmap-potencial-100)');
  });

  it('valor no máximo retorna o token do step 700 da camada', () => {
    expect(corPorValor(10, 0, 10, 'penetracao')).toBe('var(--color-heatmap-penetracao-700)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/mapa-calor/cor-por-valor.test.ts`
Expected: FAIL — `corPorValor is not a function` / `does not provide an export named 'corPorValor'`.

- [ ] **Step 3: Write minimal implementation**

Append to `web/lib/mapa-calor/cor-por-valor.ts`:

```ts
export function corPorValor(
  valor: number | null,
  min: number,
  max: number,
  camada: 'forca' | 'potencial' | 'penetracao',
): string {
  if (valor === null) return 'var(--color-on-surface-variant)';
  const step = STEPS[indiceStep(valor, min, max)];
  return `var(--color-heatmap-${camada}-${step})`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/mapa-calor/cor-por-valor.test.ts`
Expected: PASS (9 tests total — 6 from Task 1 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add web/lib/mapa-calor/cor-por-valor.ts web/lib/mapa-calor/cor-por-valor.test.ts
git commit -m "feat(mapa-calor): corPorValor — resolve token de cor por magnitude e camada"
```

---

### Task 3: `limitesValores`

**Files:**
- Modify: `web/lib/mapa-calor/cor-por-valor.ts`
- Test: `web/lib/mapa-calor/cor-por-valor.test.ts`

**Interfaces:**
- Produces: `export function limitesValores(areas: { forca: number; potencial: number; penetracao: number | null }[], camada: 'forca' | 'potencial' | 'penetracao'): { min: number; max: number } | null`

- [ ] **Step 1: Write the failing tests**

Append to `web/lib/mapa-calor/cor-por-valor.test.ts`:

```ts
import { limitesValores } from './cor-por-valor';

describe('limitesValores', () => {
  it('lista vazia retorna null', () => {
    expect(limitesValores([], 'forca')).toBeNull();
  });

  it('todos os valores da camada nulos retorna null', () => {
    const areas = [
      { forca: 1, potencial: 1, penetracao: null },
      { forca: 2, potencial: 2, penetracao: null },
    ];
    expect(limitesValores(areas, 'penetracao')).toBeNull();
  });

  it('ignora null e calcula min/max só dos números', () => {
    const areas = [
      { forca: 1, potencial: 1, penetracao: 0.2 },
      { forca: 2, potencial: 2, penetracao: null },
      { forca: 3, potencial: 3, penetracao: 0.8 },
    ];
    expect(limitesValores(areas, 'penetracao')).toEqual({ min: 0.2, max: 0.8 });
  });

  it('calcula min/max pra camada sem valores nulos possíveis (forca)', () => {
    const areas = [
      { forca: 5, potencial: 1, penetracao: 0.1 },
      { forca: 1, potencial: 1, penetracao: 0.1 },
      { forca: 9, potencial: 1, penetracao: 0.1 },
    ];
    expect(limitesValores(areas, 'forca')).toEqual({ min: 1, max: 9 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/mapa-calor/cor-por-valor.test.ts`
Expected: FAIL — `limitesValores is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `web/lib/mapa-calor/cor-por-valor.ts`:

```ts
export function limitesValores(
  areas: { forca: number; potencial: number; penetracao: number | null }[],
  camada: 'forca' | 'potencial' | 'penetracao',
): { min: number; max: number } | null {
  const valores = areas.map((a) => a[camada]).filter((v): v is number => v !== null);
  if (valores.length === 0) return null;
  return { min: Math.min(...valores), max: Math.max(...valores) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/mapa-calor/cor-por-valor.test.ts`
Expected: PASS (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add web/lib/mapa-calor/cor-por-valor.ts web/lib/mapa-calor/cor-por-valor.test.ts
git commit -m "feat(mapa-calor): limitesValores — min/max não-nulos da camada ativa"
```

---

### Task 4: Wire marker color to the pure module

**Files:**
- Modify: `web/app/mapa-calor/MapaCalorClient.tsx` (imports, remove `CORES`, add a shared `limites` memo, rewrite the markers `useEffect`)
- Test: `web/app/mapa-calor/MapaCalorClient.test.tsx` (regression only, not modified)

**Interfaces:**
- Consumes: `corPorValor(valor, min, max, camada)`, `limitesValores(areas, camada)` from Tasks 2-3.
- Produces: `limites: { min: number; max: number } | null` (component-body `useMemo`, reused by the legend in Task 5 — computed once per `[areas, camada]` change instead of once per consumer).

- [ ] **Step 1: Update the import block and remove `CORES`**

Locate the top of `web/app/mapa-calor/MapaCalorClient.tsx` (the `'use client'` directive through the `AreaCalor` type, and the `CORES` constant right after it). Replace that whole section with:

```tsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NavShell } from '../components/NavShell';
import { corPorValor, limitesValores } from '../../lib/mapa-calor/cor-por-valor';

type Granularidade = 'zona' | 'bairro';
type Camada = 'forca' | 'potencial' | 'penetracao';

type AreaCalor = {
  area_id: string;
  area_nome: string;
  forca: number;
  potencial: number;
  penetracao: number | null;
  ponto_geojson: { type: 'Point'; coordinates: [number, number] } | null;
};
```

(the `CORES` constant that used to follow the `AreaCalor` type is deleted — nothing replaces it here, `corPorValor` takes over)

- [ ] **Step 2: Add the shared `limites` memo**

Inside `export function MapaCalorClient()`, locate the `erro` state declaration:

```tsx
  const [erro, setErro] = useState<string | null>(null);
```

Add immediately after it:

```tsx
  const [erro, setErro] = useState<string | null>(null);
  const limites = useMemo(() => limitesValores(areas, camada), [areas, camada]);
```

- [ ] **Step 3: Replace the markers `useEffect` marker-color logic**

Locate the marker-rendering `useEffect` (the effect that iterates over `areas` and creates `maplibregl.Marker` instances — currently depends on `[areas, camada]` and reads `CORES[camada]`). Replace its entire body with:

```tsx
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers: maplibregl.Marker[] = [];
    for (const area of areas) {
      if (!area.ponto_geojson) continue;
      const valor = area[camada];
      const el = document.createElement('div');
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.borderRadius = '50%';
      el.style.background = limites
        ? corPorValor(valor, limites.min, limites.max, camada)
        : 'var(--color-on-surface-variant)';

      const content = document.createElement('div');
      const nome = document.createElement('strong');
      nome.textContent = area.area_nome;
      content.append(
        nome,
        document.createElement('br'),
        `Força: ${area.forca}`,
        document.createElement('br'),
        `Potencial: ${area.potencial}`,
        document.createElement('br'),
        `Penetração: ${area.penetracao ?? 'sem dado'}`,
      );
      const popup = new maplibregl.Popup({ offset: 12 }).setDOMContent(content);

      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat(area.ponto_geojson.coordinates)
          .setPopup(popup)
          .addTo(map),
      );
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [areas, camada, limites]);
```

Note: `el.style.opacity` is gone — the no-data distinction is now color-only (spec decision 2). Popup `className`/typography and legend are added in later tasks; this step only rewires color. `limites` is in the dependency array for lint correctness (exhaustive-deps) even though it only changes when `areas`/`camada` do — it's the same memoized reference otherwise, so this doesn't cause extra re-runs.

- [ ] **Step 4: Run the regression test**

Run (from `web/`): `npx vitest run app/mapa-calor/MapaCalorClient.test.tsx`
Expected: PASS (4/4, unmodified).

- [ ] **Step 5: Commit**

```bash
git add web/app/mapa-calor/MapaCalorClient.tsx
git commit -m "feat(mapa-calor): cor do marcador varia por magnitude via rampa de 13 steps"
```

---

### Task 5: Legend + layout (controls restyle, card wrapper)

**Files:**
- Modify: `web/app/mapa-calor/MapaCalorClient.tsx` (imports, new `Legenda` local component, component body, the `return (...)` JSX block)

**Interfaces:**
- Consumes: `limites` (the `useMemo`'d `{ min, max } | null`) from Task 4; `STEPS` from Task 1; `Message` from `web/app/components/Message.tsx`.
- Produces: local (non-exported) `Legenda({ min, max, camada }: { min: number; max: number; camada: Camada })` used only inside `MapaCalorClient.tsx`.

- [ ] **Step 1: Update imports**

Locate the import block at the top of `web/app/mapa-calor/MapaCalorClient.tsx` (currently ends with the `corPorValor`/`limitesValores` import from Task 4). Replace it with:

```tsx
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NavShell } from '../components/NavShell';
import { Message } from '../components/Message';
import { STEPS, corPorValor, limitesValores } from '../../lib/mapa-calor/cor-por-valor';
```

- [ ] **Step 2: Add the `Legenda` local component**

Add above `export function MapaCalorClient()` (same pattern as `IconArea`/`IconLideranca` in `web/app/dashboard/AlertasList.tsx:12-46` — local unexported function above the exported component):

```tsx
function Legenda({ min, max, camada }: { min: number; max: number; camada: Camada }) {
  const gradiente = `linear-gradient(to right, ${STEPS.map(
    (step) => `var(--color-heatmap-${camada}-${step})`,
  ).join(', ')})`;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-3 w-full rounded" style={{ background: gradiente }} />
      <div className="flex justify-between text-body-md text-on-surface-variant">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Nothing to add here — reuse `limites` from Task 4**

The `limites` memo added in Task 4, Step 2 (`const limites = useMemo(() => limitesValores(areas, camada), [areas, camada]);`, right after the `erro` state declaration) is the single source of truth for both the markers `useEffect` and the legend below — no second computation. This step is a no-op checkpoint; proceed to Step 4.

- [ ] **Step 4: Replace the `return` JSX block**

Replace the component's `return (...)` block with:

```tsx
  return (
    <NavShell>
      <div className="flex flex-col gap-6">
        <div className="flex gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Granularidade:</span>
            <select
              value={granularidade}
              onChange={(e) => setGranularidade(e.target.value as Granularidade)}
              className="rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <option value="zona">Zona</option>
              <option value="bairro">Bairro</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-label-md text-on-surface-variant">Camada:</span>
            <select
              value={camada}
              onChange={(e) => setCamada(e.target.value as Camada)}
              className="rounded border border-outline bg-surface-container-lowest px-4 py-3 text-body-lg text-on-surface hover:border-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <option value="forca">Força</option>
              <option value="potencial">Potencial</option>
              <option value="penetracao">Penetração</option>
            </select>
          </label>
        </div>
        {limites && (
          <Legenda min={limites.min} max={limites.max} camada={camada} />
        )}
        {erro && <Message variant="error">{erro}</Message>}
        <div className="rounded border border-outline-variant overflow-hidden">
          <div ref={mapContainerRef} style={{ width: '100%', height: '600px' }} />
        </div>
      </div>
    </NavShell>
  );
```

Note: `<label>` changes from `Granularidade:` / `Camada:` plain text to `<span>` wrapping the text — this preserves `getByLabelText(/granularidade/i)` / `getByLabelText(/camada/i)` association (the `<select>` stays a descendant of `<label>`, Testing Library resolves it the same way) while allowing independent `text-label-md` styling matching `Input`'s label treatment (`web/app/components/Input.tsx:18`).

- [ ] **Step 5: Run the regression test**

Run: `npx vitest run app/mapa-calor/MapaCalorClient.test.tsx`
Expected: PASS (4/4) — `getByLabelText` and `getByRole('alert')` both still resolve correctly.

- [ ] **Step 6: Commit**

```bash
git add web/app/mapa-calor/MapaCalorClient.tsx
git commit -m "feat(mapa-calor): legenda, controles tokenizados, mapa em card, erro via Message"
```

---

### Task 6: Popup typography

**Files:**
- Modify: `web/app/mapa-calor/MapaCalorClient.tsx` (inside the markers `useEffect` from Task 4)

**Constraint:** preserve the DOM-only popup construction. Do not introduce `innerHTML`, `insertAdjacentHTML`, or `Popup#setHTML` anywhere in this task — every node stays `document.createElement` + `.textContent`/`.className`, content stays wired through `Popup#setDOMContent` (XSS fix from S4, restated here since this task is exactly the one touching that code).

- [ ] **Step 1: Add `className` to the popup's `nome` element**

In the markers `useEffect` (Task 4, Step 3), locate:

```tsx
      const nome = document.createElement('strong');
      nome.textContent = area.area_nome;
```

Replace with:

```tsx
      const nome = document.createElement('strong');
      nome.className = 'font-medium text-body-lg text-on-surface';
      nome.textContent = area.area_nome;
```

- [ ] **Step 2: Add `className` to the popup's value text**

Locate the `content.append(...)` call:

```tsx
      content.append(
        nome,
        document.createElement('br'),
        `Força: ${area.forca}`,
        document.createElement('br'),
        `Potencial: ${area.potencial}`,
        document.createElement('br'),
        `Penetração: ${area.penetracao ?? 'sem dado'}`,
      );
```

Replace with a wrapper `<div>` carrying the value typography (keeps `document.createElement`/`setDOMContent` — no `innerHTML`, XSS fix from S4 untouched):

```tsx
      const valores = document.createElement('div');
      valores.className = 'text-body-md text-on-surface-variant';
      valores.append(
        `Força: ${area.forca}`,
        document.createElement('br'),
        `Potencial: ${area.potencial}`,
        document.createElement('br'),
        `Penetração: ${area.penetracao ?? 'sem dado'}`,
      );
      content.append(nome, valores);
```

- [ ] **Step 3: Run the regression test**

Run: `npx vitest run app/mapa-calor/MapaCalorClient.test.tsx`
Expected: PASS (4/4) — no test inspects popup DOM content/classes.

- [ ] **Step 4: Commit**

```bash
git add web/app/mapa-calor/MapaCalorClient.tsx
git commit -m "feat(mapa-calor): tipografia tokenizada no popup (nome + valores)"
```

---

### Task 7: Full suite regression + visual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run (from `web/`): `npm test`
Expected: all suites PASS, including `lib/mapa-calor/cor-por-valor.test.ts` (13 tests) and `app/mapa-calor/MapaCalorClient.test.tsx` (4 tests, unmodified).

- [ ] **Step 2: Run lint**

Run (from `web/`): `npm run lint`
Expected: no errors. This is the check that catches issues `vitest` can't — unused imports/vars (e.g. a leftover `CORES` reference or an unused `useMemo` import if a prior task's edit was incomplete), hooks exhaustive-deps warnings on the `useEffect`/`useMemo` touched in Tasks 4-5. Fix anything it flags before moving on.

- [ ] **Step 3: Visual verification via dev server**

Run: `npm run dev` (from `web/`), navigate to `/mapa-calor` with an authenticated session.

Check, per spec's Testes section:
- Marker colors vary by magnitude within the same camada.
- No-data marker (`penetracao: null`) renders visibly gray, distinct from the lightest rampa step.
- Legend shows the 13-step gradient + correct min/max, and updates when switching camada.
- Legend does not render when the active camada has zero non-null values (only reachable if seed/fixture data has all-null `penetracao`).
- Popup shows tokenized typography — inspect the rendered popup DOM (e.g. browser devtools) and confirm `font-medium text-body-lg text-on-surface` landed on the name node and `text-body-md text-on-surface-variant` on the values node; MapLibre popups live outside the component's normal render tree, so this is worth checking directly rather than assuming Tailwind classes survived.
- Controls (`<select>`) visually match `Input`'s border/focus treatment.
- Map sits inside a bordered, rounded card with no square corner bleeding through (`overflow-hidden` working).
- No horizontal scroll on mobile viewport width (this project has no dark theme and marker color is data-driven, not MapLibre-zoom-driven — neither is in scope for this check).

- [ ] **Step 4: Stop the dev server**

If left running in the background, stop it once verification is done.

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (color algorithm + degenerate case) → Task 1. Decision 2 (null → gray, excluded from min/max) → Tasks 2-4 (`corPorValor` null branch, `limitesValores` filter). Decision 3 (legend) → Task 5. Decision 4 (controls) → Task 5. Decision 5 (card + popup typography) → Tasks 5-6. Decision 6 (`Message`) → Task 5. Non-objectives (fetch contract, no `Select`/legend abstraction, XSS fix, backend aggregation) are called out in Global Constraints and left untouched by every task.
- **Placeholder scan:** no TBD/TODO; every step shows complete code.
- **Type consistency:** `Camada = 'forca' | 'potencial' | 'penetracao'` used identically across Tasks 2, 3, 5. `corPorValor`/`limitesValores` signatures match between their Task 1-3 definitions and their Task 4-5 call sites. `limites` (the Task 4 `useMemo`) is the single computation reused by both the markers effect and the Task 5 legend — no duplicate `limitesValores` call site remains after Task 5.
- **No dead code across tasks:** `CORES` and `el.style.opacity` are removed in the same task (Task 4) that introduces their replacement — no task leaves an unused/orphaned symbol for a later task to clean up. `npm run lint` in Task 7 is the backstop, not a substitute for this.
