# CRUD de campanha (criar + mudar status) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duas operações no painel Superadmin que hoje só existem via
`execute_sql` manual: criar uma campanha nova, e mudar seu status
(`ativa`/`suspensa`/`encerrada`).

**Architecture:** Sem migration nova (schema já existe desde S0). Duas
rotas novas (`POST /api/superadmin/campanhas` adicionada ao arquivo do
`GET` já existente; `POST /api/superadmin/campanhas/status` nova) mutam
`public.campanha` direto via `adminClient()` (`service_role`) — sem função
Postgres nova, o gate de autorização já é o `requireSuperadmin()` de cada
rota. Uma função pura testável (`transicionarStatus`) encapsula toda a
máquina de estados e a regra de `suspensa_em`. UI estende o
`DashboardSuperadminClient` já existente (S7) com um formulário de criação
e botões de transição de status por linha.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript, Vitest +
`jsdom`/`@testing-library/react`, `execute_sql` via MCP Supabase (só pra
inspecionar, nenhuma migration nesta fatia).

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/`
  (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência: `docs/superpowers/specs/2026-07-07-crud-campanha-design.md`.
- **Nenhuma migration nova** — `public.campanha` já tem todas as colunas
  necessárias (`supabase/migrations/0002_campanha.sql`).
- **Sem função Postgres nova** — mutação via `adminClient()` direto,
  mesmo padrão de `GET /api/superadmin/campanhas` (S7).
- `subdominio`: normaliza (`trim()` + `toLowerCase()`) ANTES de validar
  `^[a-z0-9-]+$`, tamanho 3-63.
- `uf`: normaliza (`trim()` + `toUpperCase()`) ANTES de validar `^[A-Z]{2}$`.
- `dataEleicao`: valida formato `YYYY-MM-DD` E que a data existe de fato
  (comparando os componentes capturados contra
  `getUTCFullYear()`/`getUTCMonth()+1`/`getUTCDate()` de
  `new Date(`${s}T00:00:00.000Z`)`) — **nunca** só
  `!Number.isNaN(Date.parse(...))`, que aceita datas impossíveis como
  `"2028-02-30"` (normaliza silenciosamente pra `2028-03-01` em vez de
  falhar).
- Máquina de estados: `ativa` ↔ `suspensa` bidirecional; `(ativa|suspensa)
  → encerrada` permitido; qualquer transição SAINDO de `encerrada` é
  inválida; transição pro mesmo status é inválida.
- `suspensa_em`: setado ao entrar em `suspensa`; limpo (`null`) ao sair de
  volta pra `ativa`; **omitido** (não `null`) do update ao ir pra
  `encerrada` — preserva o histórico.
- Toda a lógica acima de transição vive em UMA função pura
  (`transicionarStatus`), que já monta o objeto de update completo — as
  rotas nunca decidem `suspensa_em` por conta própria.
- `POST /api/superadmin/campanhas` retorna `201` com a linha criada.
  `POST /api/superadmin/campanhas/status` retorna `200 {campanha: <linha
  atualizada>}`. Nenhuma das duas retorna só `{ok:true}`.
- Erro de unicidade de `subdominio` (Postgres `23505`) vira `400 {erro:
  'subdomínio já em uso'}`, nunca `500`.
- Commits frequentes; mensagens estilo do repo (`feat: ...`, `test: ...`).

---

## Contexto de código existente (não repetir nas tasks)

- `public.campanha` (migration `0002_campanha.sql`) — colunas:
  `id uuid`, `subdominio text unique`, `nome text`,
  `cargo cargo` (enum: `vereador`|`prefeito`|`deputado_estadual`),
  `abrangencia abrangencia` (enum: `municipal`|`estadual`),
  `municipio_id bigint` (nullable), `uf char(2)` (nullable),
  `status campanha_status` (enum: `ativa`|`suspensa`|`encerrada`, default
  `'ativa'`), `data_eleicao date`, `suspensa_em timestamptz` (nullable),
  `modulos_habilitados jsonb`, `criado_em`/`atualizado_em timestamptz`.
  `CHECK abrangencia_geo`: `municipal` exige `municipio_id` presente e `uf`
  nulo; `estadual` exige `uf` presente e `municipio_id` nulo.
- `web/lib/supabase/require-superadmin.ts` → `requireSuperadmin():
  Promise<NextResponse | null>` — `null` quando liberado.
- `web/lib/supabase/server.ts` → `adminClient()` — cliente `service_role`,
  bypassa RLS.
- `web/app/api/superadmin/campanhas/route.ts` — conteúdo atual completo
  (Task 2 modifica este arquivo):
  ```typescript
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
- `web/app/api/superadmin/campanhas/route.test.ts` — conteúdo atual
  completo (Task 2 reescreve este arquivo, preservando os 3 testes do
  `GET`):
  ```typescript
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
- `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx` — conteúdo
  atual completo (Task 4 modifica este arquivo):
  ```tsx
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
      try {
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
        } else {
          setErro('Não foi possível atualizar o módulo.');
        }
      } catch {
        setErro('Não foi possível atualizar o módulo.');
      } finally {
        setCarregando(null);
      }
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
- `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx` —
  conteúdo atual completo (Task 4 reescreve este arquivo, preservando os 7
  testes existentes — a fixture `mockCampanhas` precisa ganhar `status:
  'ativa'` pra não quebrar `PROXIMOS_STATUS[c.status]` na Task 4):
  ```tsx
  // web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx
  // @vitest-environment jsdom
  import '@testing-library/jest-dom/vitest';
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
  import { DashboardSuperadminClient } from './DashboardSuperadminClient';

  const mockCampanhas = [
    { id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a', modulos_habilitados: ['comunicacao'] },
  ];

  describe('DashboardSuperadminClient', () => {
    afterEach(() => {
      cleanup();
    });

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

    it('mostra erro e libera o checkbox quando o POST de módulo falha por rede (fetch rejeita)', async () => {
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url === '/api/superadmin/campanhas') {
          return { ok: true, json: async () => mockCampanhas } as Response;
        }
        if (url === '/api/superadmin/modulos') {
          throw new Error('network error');
        }
        throw new Error(`fetch inesperado: ${url}`);
      }) as never;

      render(<DashboardSuperadminClient />);
      const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
      fireEvent.click(checkboxIa);

      expect(checkboxIa).toBeDisabled();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
      });

      expect(screen.queryByRole('checkbox', { name: 'ia' })).not.toBeInTheDocument();
    });

    it('mostra erro quando o POST de módulo responde com falha (res.ok === false)', async () => {
      globalThis.fetch = vi.fn(async (url: string) => {
        if (url === '/api/superadmin/campanhas') {
          return { ok: true, json: async () => mockCampanhas } as Response;
        }
        if (url === '/api/superadmin/modulos') {
          return { ok: false, json: async () => ({}) } as Response;
        }
        throw new Error(`fetch inesperado: ${url}`);
      }) as never;

      render(<DashboardSuperadminClient />);
      const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
      fireEvent.click(checkboxIa);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
      });
    });
  });
  ```

---

### Task 1: Biblioteca de domínio — `web/lib/campanha/`

**Files:**
- Create: `web/lib/campanha/constantes.ts`
- Create: `web/lib/campanha/transicionar-status.ts`
- Create: `web/lib/campanha/transicionar-status.test.ts`

**Interfaces:**
- Produces: `CARGOS`, `Cargo`, `isCargo`; `ABRANGENCIAS`, `Abrangencia`,
  `isAbrangencia`; `STATUS_CAMPANHA`, `StatusCampanha`, `isStatusCampanha`
  (todos em `constantes.ts`); `transicionarStatus(atual, novo):
  ResultadoTransicao` (em `transicionar-status.ts`, importa `StatusCampanha`
  de `./constantes`). Tasks 2 e 3 consomem tudo isso.

**Nota de estrutura:** o spec descrevia `web/lib/campanha.ts` (arquivo
plano) — mudado pra `web/lib/campanha/constantes.ts` (dentro de um
diretório) porque `transicionar-status.ts` também precisa viver junto
(mesmo domínio) e este projeto nunca mistura um arquivo e um diretório de
mesmo nome no mesmo lugar (`web/lib/auth.ts` + `web/lib/auth/` não
coexistem em nenhum lugar do código atual — só uma forma ou outra). Um
diretório `web/lib/campanha/` pros dois arquivos é consistente com o
padrão já usado por `web/lib/auth/`, `web/lib/pessoa/`, `web/lib/vinculo/`.

- [ ] **Step 1: Implementar as constantes (sem teste próprio — mesmo padrão de `web/lib/modulos.ts`, S6, que também não tem teste dedicado pra guards triviais de lista fechada)**

```typescript
// web/lib/campanha/constantes.ts
export const CARGOS = ['vereador', 'prefeito', 'deputado_estadual'] as const;
export type Cargo = (typeof CARGOS)[number];
export function isCargo(value: string): value is Cargo {
  return (CARGOS as readonly string[]).includes(value);
}

export const ABRANGENCIAS = ['municipal', 'estadual'] as const;
export type Abrangencia = (typeof ABRANGENCIAS)[number];
export function isAbrangencia(value: string): value is Abrangencia {
  return (ABRANGENCIAS as readonly string[]).includes(value);
}

export const STATUS_CAMPANHA = ['ativa', 'suspensa', 'encerrada'] as const;
export type StatusCampanha = (typeof STATUS_CAMPANHA)[number];
export function isStatusCampanha(value: string): value is StatusCampanha {
  return (STATUS_CAMPANHA as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Escrever o teste de `transicionarStatus`**

```typescript
// web/lib/campanha/transicionar-status.test.ts
import { describe, it, expect } from 'vitest';
import { transicionarStatus } from './transicionar-status';

describe('transicionarStatus', () => {
  it('ativa -> suspensa: válida, seta suspensa_em (string)', () => {
    const r = transicionarStatus('ativa', 'suspensa');
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(r.update.status).toBe('suspensa');
      expect(typeof r.update.suspensa_em).toBe('string');
    }
  });

  it('suspensa -> ativa: válida, limpa suspensa_em (null)', () => {
    const r = transicionarStatus('suspensa', 'ativa');
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(r.update).toEqual({ status: 'ativa', suspensa_em: null });
    }
  });

  it('ativa -> encerrada: válida, NÃO tem a chave suspensa_em', () => {
    const r = transicionarStatus('ativa', 'encerrada');
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(r.update).toEqual({ status: 'encerrada' });
      expect('suspensa_em' in r.update).toBe(false);
    }
  });

  it('suspensa -> encerrada: válida, NÃO tem a chave suspensa_em (preserva o histórico)', () => {
    const r = transicionarStatus('suspensa', 'encerrada');
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(r.update).toEqual({ status: 'encerrada' });
      expect('suspensa_em' in r.update).toBe(false);
    }
  });

  it('encerrada -> ativa (ou qualquer coisa saindo de encerrada): inválida', () => {
    const r = transicionarStatus('encerrada', 'ativa');
    expect(r.valida).toBe(false);
    if (!r.valida) expect(r.erro).toBe('campanha encerrada não pode mudar de status');
  });

  it('ativa -> ativa (mesmo status): inválida', () => {
    const r = transicionarStatus('ativa', 'ativa');
    expect(r.valida).toBe(false);
    if (!r.valida) expect(r.erro).toBe('já está nesse status');
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd web && npx vitest run lib/campanha/transicionar-status.test.ts`
Expected: FAIL — `Cannot find module './transicionar-status'`

- [ ] **Step 4: Implementar `transicionarStatus`**

```typescript
// web/lib/campanha/transicionar-status.ts
import { type StatusCampanha } from './constantes';

export type ResultadoTransicao =
  | { valida: true; update: { status: StatusCampanha; suspensa_em?: string | null } }
  | { valida: false; erro: string };

export function transicionarStatus(
  atual: StatusCampanha,
  novo: StatusCampanha,
): ResultadoTransicao {
  if (atual === novo) {
    return { valida: false, erro: 'já está nesse status' };
  }
  if (atual === 'encerrada') {
    return { valida: false, erro: 'campanha encerrada não pode mudar de status' };
  }
  if (novo === 'suspensa') {
    return { valida: true, update: { status: 'suspensa', suspensa_em: new Date().toISOString() } };
  }
  if (novo === 'ativa') {
    return { valida: true, update: { status: 'ativa', suspensa_em: null } };
  }
  return { valida: true, update: { status: 'encerrada' } };
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `cd web && npx vitest run lib/campanha/transicionar-status.test.ts`
Expected: PASS — 6/6

- [ ] **Step 6: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes.

- [ ] **Step 7: Commit**

```bash
git add web/lib/campanha/constantes.ts web/lib/campanha/transicionar-status.ts web/lib/campanha/transicionar-status.test.ts
git commit -m "feat: constantes de campanha + transicionarStatus (máquina de estados pura)"
```

---

### Task 2: `POST /api/superadmin/campanhas` (criar campanha)

**Files:**
- Modify: `web/app/api/superadmin/campanhas/route.ts`
- Modify: `web/app/api/superadmin/campanhas/route.test.ts`

**Interfaces:**
- Consumes: `isCargo`, `isAbrangencia` (`web/lib/campanha/constantes.ts`,
  Task 1); `requireSuperadmin`; `adminClient`.
- Produces: `POST /api/superadmin/campanhas` — `201` com a linha criada em
  sucesso, `400` em qualquer falha de validação/unicidade. `GET` ganha
  `status` na lista de colunas selecionadas (necessário pra Task 4
  calcular os botões de transição). Task 4 consome ambos via `fetch`.

- [ ] **Step 1: Escrever o teste (reescreve o arquivo inteiro — preserva os 3 testes do `GET`, adiciona `status` na fixture, adiciona os testes do `POST`)**

```typescript
// web/app/api/superadmin/campanhas/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

const mockCampanhas = [
  {
    id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a',
    modulos_habilitados: ['comunicacao'], status: 'ativa',
  },
];

function mockAdmin(overrides: Partial<{
  selectData: unknown; selectError: unknown;
  insertData: unknown; insertError: unknown;
}> = {}) {
  const {
    selectData = mockCampanhas, selectError = null,
    insertData = { id: 'c-novo' }, insertError = null,
  } = overrides;
  const single = vi.fn(async () => ({ data: insertData, error: insertError }));
  const selectAfterInsert = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select: selectAfterInsert }));
  const select = vi.fn(async () => ({ data: selectData, error: selectError }));
  const from = vi.fn(() => ({ select, insert }));
  return { from, select, insert, single };
}

vi.mock('../../../../lib/supabase/server', () => ({ adminClient: vi.fn() }));

import { GET, POST } from './route';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';

function postReq(body: unknown) {
  return new Request('http://localhost/api/superadmin/campanhas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CORPO_MUNICIPAL_VALIDO = {
  subdominio: 'campanha-nova', nome: 'Campanha Nova', cargo: 'prefeito',
  abrangencia: 'municipal', municipioId: 2211001, dataEleicao: '2028-10-01',
};

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
    vi.mocked(adminClient).mockReturnValue(mockAdmin({ selectData: null, selectError: { message: 'falha' } }) as never);
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

describe('POST /api/superadmin/campanhas', () => {
  it('403 repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await POST(postReq(CORPO_MUNICIPAL_VALIDO));
    expect(res.status).toBe(403);
  });

  it('400 com campo obrigatório faltando, sem chamar insert', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const { nome: _nome, ...semNome } = CORPO_MUNICIPAL_VALIDO;
    const res = await POST(postReq(semNome));
    expect(res.status).toBe(400);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('subdominio é normalizado (ABC vira abc); 400 se inválido mesmo normalizado', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, subdominio: 'ABC' }));
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({ subdominio: 'abc' }));

    const res = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, subdominio: 'a b' }));
    expect(res.status).toBe(400);
  });

  it('400 com cargo/abrangencia fora da lista fechada, sem chamar insert', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res1 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, cargo: 'presidente' }));
    expect(res1.status).toBe(400);
    const res2 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, abrangencia: 'nacional' }));
    expect(res2.status).toBe(400);
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it('400 quando municipal sem municipioId, ou com uf junto', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const { municipioId: _m, ...semMunicipio } = CORPO_MUNICIPAL_VALIDO;
    const res1 = await POST(postReq(semMunicipio));
    expect(res1.status).toBe(400);
    const res2 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, uf: 'PI' }));
    expect(res2.status).toBe(400);
  });

  it('400 quando estadual sem uf, ou com municipioId junto', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const corpoEstadual = {
      subdominio: 'campanha-est', nome: 'Campanha Estadual', cargo: 'deputado_estadual',
      abrangencia: 'estadual', uf: 'PI', dataEleicao: '2028-10-01',
    };
    const { uf: _uf, ...semUf } = corpoEstadual;
    const res1 = await POST(postReq(semUf));
    expect(res1.status).toBe(400);
    const res2 = await POST(postReq({ ...corpoEstadual, municipioId: 2211001 }));
    expect(res2.status).toBe(400);
  });

  it('uf é normalizada (" pi " vira "PI"); 400 se inválida após normalizar', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const corpoEstadual = {
      subdominio: 'campanha-est', nome: 'Campanha Estadual', cargo: 'deputado_estadual',
      abrangencia: 'estadual', uf: ' pi ', dataEleicao: '2028-10-01',
    };
    await POST(postReq(corpoEstadual));
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({ uf: 'PI' }));

    const res = await POST(postReq({ ...corpoEstadual, uf: 'P1' }));
    expect(res.status).toBe(400);
  });

  it('400 com dataEleicao vazia/formato errado/impossível; 201 em ano bissexto válido', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res1 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, dataEleicao: '' }));
    expect(res1.status).toBe(400);
    const res2 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, dataEleicao: '10/01/2028' }));
    expect(res2.status).toBe(400);
    const res3 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, dataEleicao: '2028-02-30' }));
    expect(res3.status).toBe(400);
    const res4 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, dataEleicao: '2027-02-29' }));
    expect(res4.status).toBe(400);
    const res5 = await POST(postReq({ ...CORPO_MUNICIPAL_VALIDO, dataEleicao: '2028-02-29' }));
    expect(res5.status).toBe(201);
  });

  it('400 com subdominio duplicado, sem vazar erro cru do Postgres', async () => {
    vi.mocked(adminClient).mockReturnValue(
      mockAdmin({
        insertData: null,
        insertError: { code: '23505', message: 'duplicate key value violates unique constraint "campanha_subdominio_key"' },
      }) as never,
    );
    const res = await POST(postReq(CORPO_MUNICIPAL_VALIDO));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: 'subdomínio já em uso' });
  });

  it('201 com a linha criada em caso de sucesso', async () => {
    const linhaCriada = { id: 'c-novo', ...CORPO_MUNICIPAL_VALIDO, status: 'ativa' };
    vi.mocked(adminClient).mockReturnValue(mockAdmin({ insertData: linhaCriada }) as never);
    const res = await POST(postReq(CORPO_MUNICIPAL_VALIDO));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(linhaCriada);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/superadmin/campanhas/route.test.ts`
Expected: FAIL — `POST` não exportado de `./route`, e o `GET` existente
também falha (fixture ganhou `status`, mas o `GET` real ainda não seleciona
essa coluna, então `toEqual(mockCampanhas)` compara igual pro mock — na
verdade o `GET` test passa porque o mock controla o retorno; só o `POST`
falha por não existir ainda).

- [ ] **Step 3: Implementar (adiciona `POST` e `status` ao `select` do `GET`)**

```typescript
// web/app/api/superadmin/campanhas/route.ts
import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../lib/supabase/server';
import { isCargo, isAbrangencia } from '../../../../lib/campanha/constantes';

export async function GET() {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  const { data, error } = await adminClient()
    .from('campanha')
    .select('id, nome, subdominio, modulos_habilitados, status');
  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });
  return NextResponse.json(data);
}

function subdominioValido(s: string): boolean {
  return /^[a-z0-9-]+$/.test(s) && s.length >= 3 && s.length <= 63;
}

function ufValida(s: string): boolean {
  return /^[A-Z]{2}$/.test(s);
}

function dataEleicaoValida(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const data = new Date(`${s}T00:00:00.000Z`);
  return (
    data.getUTCFullYear() === Number(y) &&
    data.getUTCMonth() + 1 === Number(mo) &&
    data.getUTCDate() === Number(d)
  );
}

export async function POST(req: Request) {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  let body: {
    subdominio?: string; nome?: string; cargo?: string; abrangencia?: string;
    municipioId?: number; uf?: string; dataEleicao?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }

  const { nome, cargo, abrangencia, municipioId, dataEleicao } = body;
  const subdominio = body.subdominio?.trim().toLowerCase();
  if (!subdominio || !nome || !cargo || !abrangencia || !dataEleicao) {
    return NextResponse.json({ erro: 'campos obrigatórios ausentes' }, { status: 400 });
  }
  if (!subdominioValido(subdominio)) {
    return NextResponse.json(
      { erro: 'subdomínio inválido (use apenas letras minúsculas, números e hífen, 3-63 caracteres)' },
      { status: 400 },
    );
  }
  if (!isCargo(cargo)) {
    return NextResponse.json({ erro: `cargo inválido: "${cargo}"` }, { status: 400 });
  }
  if (!isAbrangencia(abrangencia)) {
    return NextResponse.json({ erro: `abrangência inválida: "${abrangencia}"` }, { status: 400 });
  }

  let uf: string | undefined;
  if (abrangencia === 'municipal') {
    if (municipioId == null || body.uf) {
      return NextResponse.json(
        { erro: 'abrangência municipal exige municipioId e não aceita uf' },
        { status: 400 },
      );
    }
  } else {
    if (!body.uf || municipioId != null) {
      return NextResponse.json(
        { erro: 'abrangência estadual exige uf e não aceita municipioId' },
        { status: 400 },
      );
    }
    uf = body.uf.trim().toUpperCase();
    if (!ufValida(uf)) {
      return NextResponse.json({ erro: 'uf inválida (use exatamente 2 letras)' }, { status: 400 });
    }
  }

  if (!dataEleicaoValida(dataEleicao)) {
    return NextResponse.json(
      { erro: 'dataEleicao inválida (use o formato YYYY-MM-DD e uma data real)' },
      { status: 400 },
    );
  }

  const { data, error } = await adminClient()
    .from('campanha')
    .insert({
      subdominio,
      nome,
      cargo,
      abrangencia,
      municipio_id: abrangencia === 'municipal' ? municipioId : null,
      uf: abrangencia === 'estadual' ? uf : null,
      data_eleicao: dataEleicao,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ erro: 'subdomínio já em uso' }, { status: 400 });
    }
    return NextResponse.json({ erro: error.message }, { status: 400 });
  }
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/superadmin/campanhas/route.test.ts`
Expected: PASS — 13/13 (3 do `GET` + 10 do `POST`)

- [ ] **Step 5: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam.

- [ ] **Step 6: Commit**

```bash
git add web/app/api/superadmin/campanhas/route.ts web/app/api/superadmin/campanhas/route.test.ts
git commit -m "feat: POST /api/superadmin/campanhas (criar campanha)"
```

---

### Task 3: `POST /api/superadmin/campanhas/status` (mudar status)

**Files:**
- Create: `web/app/api/superadmin/campanhas/status/route.ts`
- Create: `web/app/api/superadmin/campanhas/status/route.test.ts`

**Interfaces:**
- Consumes: `isStatusCampanha`, `transicionarStatus`
  (`web/lib/campanha/constantes.ts` + `transicionar-status.ts`, Task 1);
  `requireSuperadmin`; `adminClient`.
- Produces: `POST /api/superadmin/campanhas/status` — body
  `{campanhaId, novoStatus}`, `200 {campanha: <linha atualizada>}` em
  sucesso, `400` em qualquer falha. Task 4 consome via `fetch`.

- [ ] **Step 1: Escrever o teste**

```typescript
// web/app/api/superadmin/campanhas/status/route.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../../lib/supabase/require-superadmin', () => ({
  requireSuperadmin: vi.fn(async () => null),
}));

function mockAdmin(overrides: Partial<{
  selectData: unknown; selectError: unknown;
  updateData: unknown; updateError: unknown;
}> = {}) {
  const {
    selectData = { status: 'ativa' }, selectError = null,
    updateData = { id: 'c-1', status: 'suspensa' }, updateError = null,
  } = overrides;

  const singleSelect = vi.fn(async () => ({ data: selectData, error: selectError }));
  const eqSelect = vi.fn(() => ({ single: singleSelect }));
  const select = vi.fn(() => ({ eq: eqSelect }));

  const singleUpdate = vi.fn(async () => ({ data: updateData, error: updateError }));
  const selectAfterUpdate = vi.fn(() => ({ single: singleUpdate }));
  const eqUpdate = vi.fn(() => ({ select: selectAfterUpdate }));
  const update = vi.fn(() => ({ eq: eqUpdate }));

  const from = vi.fn(() => ({ select, update }));
  return { from, select, update };
}

vi.mock('../../../../../lib/supabase/server', () => ({ adminClient: vi.fn() }));

import { POST } from './route';
import { requireSuperadmin } from '../../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../../lib/supabase/server';

function req(body: unknown) {
  return new Request('http://localhost/api/superadmin/campanhas/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/superadmin/campanhas/status', () => {
  it('403 repassa o bloqueio de requireSuperadmin', async () => {
    const { NextResponse } = await import('next/server');
    const blocked = NextResponse.json({ erro: 'acesso restrito ao superadmin' }, { status: 403 });
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(blocked);
    const res = await POST(req({ campanhaId: 'c-1', novoStatus: 'suspensa' }));
    expect(res.status).toBe(403);
  });

  it('400 quando a campanha não existe', async () => {
    vi.mocked(adminClient).mockReturnValue(
      mockAdmin({ selectData: null, selectError: { message: 'not found' } }) as never,
    );
    const res = await POST(req({ campanhaId: 'c-inexistente', novoStatus: 'suspensa' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ erro: 'campanha não encontrada' });
  });

  it('400 quando novoStatus não é um StatusCampanha válido, sem chamar update', async () => {
    const admin = mockAdmin();
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req({ campanhaId: 'c-1', novoStatus: 'banana' }));
    expect(res.status).toBe(400);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('400 quando a transição é inválida (sair de encerrada), sem chamar update', async () => {
    const admin = mockAdmin({ selectData: { status: 'encerrada' } });
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req({ campanhaId: 'c-1', novoStatus: 'ativa' }));
    expect(res.status).toBe(400);
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('200 com transição válida: aplica exatamente resultado.update e retorna a linha', async () => {
    const admin = mockAdmin({
      selectData: { status: 'ativa' },
      updateData: { id: 'c-1', status: 'suspensa', suspensa_em: '2026-07-07T00:00:00.000Z' },
    });
    vi.mocked(adminClient).mockReturnValue(admin as never);
    const res = await POST(req({ campanhaId: 'c-1', novoStatus: 'suspensa' }));
    expect(res.status).toBe(200);
    expect(admin.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspensa', suspensa_em: expect.any(String) }),
    );
    expect(await res.json()).toEqual({
      campanha: { id: 'c-1', status: 'suspensa', suspensa_em: '2026-07-07T00:00:00.000Z' },
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/api/superadmin/campanhas/status/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Implementar a rota**

```typescript
// web/app/api/superadmin/campanhas/status/route.ts
import { NextResponse } from 'next/server';
import { requireSuperadmin } from '../../../../../lib/supabase/require-superadmin';
import { adminClient } from '../../../../../lib/supabase/server';
import { isStatusCampanha } from '../../../../../lib/campanha/constantes';
import { transicionarStatus } from '../../../../../lib/campanha/transicionar-status';

export async function POST(req: Request) {
  const blocked = await requireSuperadmin();
  if (blocked) return blocked;

  let body: { campanhaId?: string; novoStatus?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 });
  }
  const { campanhaId, novoStatus } = body;
  if (!campanhaId || !novoStatus) {
    return NextResponse.json({ erro: 'campanhaId e novoStatus são obrigatórios' }, { status: 400 });
  }
  if (!isStatusCampanha(novoStatus)) {
    return NextResponse.json({ erro: `status inválido: "${novoStatus}"` }, { status: 400 });
  }

  const admin = adminClient();
  const { data: atual, error: erroSelect } = await admin
    .from('campanha')
    .select('status')
    .eq('id', campanhaId)
    .single();
  if (erroSelect || !atual) {
    return NextResponse.json({ erro: 'campanha não encontrada' }, { status: 400 });
  }

  const resultado = transicionarStatus(atual.status, novoStatus);
  if (!resultado.valida) {
    return NextResponse.json({ erro: resultado.erro }, { status: 400 });
  }

  const { data, error } = await admin
    .from('campanha')
    .update({ ...resultado.update, atualizado_em: new Date().toISOString() })
    .eq('id', campanhaId)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ erro: error.message }, { status: 400 });
  }
  return NextResponse.json({ campanha: data });
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/api/superadmin/campanhas/status/route.test.ts`
Expected: PASS — 5/5

- [ ] **Step 5: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam.

- [ ] **Step 6: Commit**

```bash
git add web/app/api/superadmin/campanhas/status/route.ts web/app/api/superadmin/campanhas/status/route.test.ts
git commit -m "feat: POST /api/superadmin/campanhas/status (mudar status)"
```

---

### Task 4: UI — formulário de criação + botões de transição de status

**Files:**
- Modify: `web/app/superadmin/dashboard/DashboardSuperadminClient.tsx`
- Modify: `web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`

**Interfaces:**
- Consumes: `CARGOS`, `Cargo`, `ABRANGENCIAS`, `Abrangencia`
  (`web/lib/campanha/constantes.ts`, Task 1); `POST
  /api/superadmin/campanhas` (Task 2) e `POST
  /api/superadmin/campanhas/status` (Task 3) via `fetch`.
- Produces: nenhuma interface nova — comportamento observável (form +
  botões). Nenhuma task futura consome isso.

- [ ] **Step 1: Escrever o teste (reescreve o arquivo inteiro — preserva os 7 testes existentes com a fixture `mockCampanhas` ganhando `status: 'ativa'`, adiciona os 4 testes novos no fim)**

```tsx
// web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { DashboardSuperadminClient } from './DashboardSuperadminClient';

const mockCampanhas = [
  {
    id: 'c-1', nome: 'Campanha A', subdominio: 'campanha-a',
    modulos_habilitados: ['comunicacao'], status: 'ativa',
  },
];

describe('DashboardSuperadminClient', () => {
  afterEach(() => {
    cleanup();
  });

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

  it('mostra erro e libera o checkbox quando o POST de módulo falha por rede (fetch rejeita)', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/modulos') {
        throw new Error('network error');
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
    fireEvent.click(checkboxIa);

    expect(checkboxIa).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });

    expect(screen.queryByRole('checkbox', { name: 'ia' })).not.toBeInTheDocument();
  });

  it('mostra erro quando o POST de módulo responde com falha (res.ok === false)', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/modulos') {
        return { ok: false, json: async () => ({}) } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    const checkboxIa = await screen.findByRole('checkbox', { name: 'ia' });
    fireEvent.click(checkboxIa);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível/i);
    });
  });

  it('preencher e submeter o formulário de nova campanha dispara POST /api/superadmin/campanhas; sucesso adiciona a linha sem refetch', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/superadmin/campanhas' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/campanhas' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'c-2', nome: 'Campanha Nova', subdominio: 'campanha-nova',
            modulos_habilitados: [], status: 'ativa',
          }),
        } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);

    fireEvent.change(screen.getByPlaceholderText('Subdomínio'), { target: { value: 'campanha-nova' } });
    fireEvent.change(screen.getByPlaceholderText('Nome'), { target: { value: 'Campanha Nova' } });
    fireEvent.change(screen.getByPlaceholderText('Código IBGE do município'), { target: { value: '2211001' } });
    fireEvent.change(screen.getByPlaceholderText('Data da eleição'), { target: { value: '2028-10-01' } });
    fireEvent.click(screen.getByText('Nova campanha'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/campanhas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subdominio: 'campanha-nova', nome: 'Campanha Nova', cargo: 'vereador',
          abrangencia: 'municipal', municipioId: 2211001, dataEleicao: '2028-10-01',
        }),
      });
    });
    expect(await screen.findByText(/Campanha Nova/)).toBeInTheDocument();
  });

  it('erro na criação mostra body.erro em role="alert"', async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/superadmin/campanhas' && (!init || init.method === undefined)) {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/campanhas' && init?.method === 'POST') {
        return { ok: false, json: async () => ({ erro: 'subdomínio já em uso' }) } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);

    fireEvent.change(screen.getByPlaceholderText('Subdomínio'), { target: { value: 'campanha-a' } });
    fireEvent.change(screen.getByPlaceholderText('Nome'), { target: { value: 'Duplicada' } });
    fireEvent.change(screen.getByPlaceholderText('Código IBGE do município'), { target: { value: '2211001' } });
    fireEvent.change(screen.getByPlaceholderText('Data da eleição'), { target: { value: '2028-10-01' } });
    fireEvent.click(screen.getByText('Nova campanha'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('subdomínio já em uso');
    });
  });

  it('campanha ativa mostra Suspender/Encerrar; suspensa mostra Reativar/Encerrar; encerrada não mostra botão', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return {
          ok: true,
          json: async () => [
            { id: 'c-1', nome: 'Ativa', subdominio: 'ativa', modulos_habilitados: [], status: 'ativa' },
            { id: 'c-2', nome: 'Suspensa', subdominio: 'suspensa', modulos_habilitados: [], status: 'suspensa' },
            { id: 'c-3', nome: 'Encerrada', subdominio: 'encerrada', modulos_habilitados: [], status: 'encerrada' },
          ],
        } as Response;
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Ativa/);

    const linhaAtiva = screen.getByText(/Ativa \(/).closest('tr')!;
    expect(within(linhaAtiva).getByText('Suspender')).toBeInTheDocument();
    expect(within(linhaAtiva).getByText('Encerrar')).toBeInTheDocument();
    expect(within(linhaAtiva).queryByText('Reativar')).not.toBeInTheDocument();

    const linhaSuspensa = screen.getByText(/Suspensa \(/).closest('tr')!;
    expect(within(linhaSuspensa).getByText('Reativar')).toBeInTheDocument();
    expect(within(linhaSuspensa).getByText('Encerrar')).toBeInTheDocument();

    const linhaEncerrada = screen.getByText(/Encerrada \(/).closest('tr')!;
    expect(within(linhaEncerrada).queryByText('Suspender')).not.toBeInTheDocument();
    expect(within(linhaEncerrada).queryByText('Reativar')).not.toBeInTheDocument();
    expect(within(linhaEncerrada).queryByText('Encerrar')).not.toBeInTheDocument();
  });

  it('clicar em Suspender dispara POST /api/superadmin/campanhas/status, desabilita durante a requisição, atualiza status só depois do 200', async () => {
    let resolveFetch: (value: Response) => void;
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === '/api/superadmin/campanhas') {
        return { ok: true, json: async () => mockCampanhas } as Response;
      }
      if (url === '/api/superadmin/campanhas/status') {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }
      throw new Error(`fetch inesperado: ${url}`);
    }) as never;

    render(<DashboardSuperadminClient />);
    await screen.findByText(/Campanha A/);

    const botaoSuspender = screen.getByText('Suspender');
    fireEvent.click(botaoSuspender);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/superadmin/campanhas/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: 'c-1', novoStatus: 'suspensa' }),
      });
    });
    expect(botaoSuspender).toBeDisabled();

    resolveFetch!({ ok: true, json: async () => ({ campanha: { id: 'c-1', status: 'suspensa' } }) } as Response);

    await waitFor(() => {
      expect(screen.getByText('Reativar')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
Expected: FAIL — os testes novos falham (`getByPlaceholderText('Subdomínio')`
não encontra nada, `getByText('Suspender')` não encontra nada) — os 7
testes preexistentes continuam passando (a mudança na fixture não quebra
nada ainda, porque o componente atual não lê `c.status`).

- [ ] **Step 3: Implementar**

```tsx
// web/app/superadmin/dashboard/DashboardSuperadminClient.tsx
'use client';
import { useEffect, useState } from 'react';
import { MODULOS, type Modulo } from '../../../lib/modulos';
import { CARGOS, ABRANGENCIAS, type Cargo, type Abrangencia } from '../../../lib/campanha/constantes';

type StatusCampanha = 'ativa' | 'suspensa' | 'encerrada';

type Campanha = {
  id: string;
  nome: string;
  subdominio: string;
  modulos_habilitados: string[];
  status: StatusCampanha;
};

const PROXIMOS_STATUS: Record<StatusCampanha, { novoStatus: StatusCampanha; rotulo: string }[]> = {
  ativa: [
    { novoStatus: 'suspensa', rotulo: 'Suspender' },
    { novoStatus: 'encerrada', rotulo: 'Encerrar' },
  ],
  suspensa: [
    { novoStatus: 'ativa', rotulo: 'Reativar' },
    { novoStatus: 'encerrada', rotulo: 'Encerrar' },
  ],
  encerrada: [],
};

export function DashboardSuperadminClient() {
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState<string | null>(null);

  const [subdominio, setSubdominio] = useState('');
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState<Cargo>(CARGOS[0]);
  const [abrangencia, setAbrangencia] = useState<Abrangencia>(ABRANGENCIAS[0]);
  const [municipioId, setMunicipioId] = useState('');
  const [uf, setUf] = useState('');
  const [dataEleicao, setDataEleicao] = useState('');
  const [erroCriar, setErroCriar] = useState<string | null>(null);

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

  async function criarCampanha(e: React.FormEvent) {
    e.preventDefault();
    setErroCriar(null);
    const res = await fetch('/api/superadmin/campanhas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subdominio,
        nome,
        cargo,
        abrangencia,
        municipioId: abrangencia === 'municipal' ? Number(municipioId) : undefined,
        uf: abrangencia === 'estadual' ? uf : undefined,
        dataEleicao,
      }),
    });
    if (!res.ok) {
      const body = await res.json();
      setErroCriar(body.erro ?? 'Não foi possível criar a campanha.');
      return;
    }
    const nova: Campanha = await res.json();
    setCampanhas((atual) => [nova, ...(atual ?? [])]);
    setSubdominio('');
    setNome('');
    setMunicipioId('');
    setUf('');
    setDataEleicao('');
  }

  async function mudarStatus(campanha: Campanha, novoStatus: StatusCampanha) {
    const chave = `status:${campanha.id}`;
    setCarregando(chave);
    try {
      const res = await fetch('/api/superadmin/campanhas/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campanhaId: campanha.id, novoStatus }),
      });
      if (res.ok) {
        setCampanhas((atual) =>
          (atual ?? []).map((c) => (c.id === campanha.id ? { ...c, status: novoStatus } : c)),
        );
      } else {
        setErro('Não foi possível mudar o status.');
      }
    } catch {
      setErro('Não foi possível mudar o status.');
    } finally {
      setCarregando(null);
    }
  }

  async function alternar(campanha: Campanha, modulo: Modulo, habilitado: boolean) {
    const chave = `${campanha.id}:${modulo}`;
    setCarregando(chave);
    const acao = habilitado ? 'desabilitar' : 'habilitar';
    try {
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
      } else {
        setErro('Não foi possível atualizar o módulo.');
      }
    } catch {
      setErro('Não foi possível atualizar o módulo.');
    } finally {
      setCarregando(null);
    }
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
    </div>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/superadmin/dashboard/DashboardSuperadminClient.test.tsx`
Expected: PASS — 11/11 (7 preexistentes + 4 novos)

- [ ] **Step 5: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam.

- [ ] **Step 6: Rodar `npx tsc --noEmit`, confirmar zero erros novos**

- [ ] **Step 7: Commit**

```bash
git add web/app/superadmin/dashboard/DashboardSuperadminClient.tsx web/app/superadmin/dashboard/DashboardSuperadminClient.test.tsx
git commit -m "feat: formulário de criação + botões de transição de status no painel Superadmin"
```

---

## Self-Review

**1. Cobertura do spec:** decisão 1 (sem função Postgres) → Tasks 2/3
(mutação via `adminClient()` direto); decisão 2 (`POST` no arquivo do
`GET`) → Task 2; decisão 3 (`cargo`/`abrangencia`/`status` como listas
fechadas) → Task 1; decisão 4 (criação retorna `201` com a linha) → Task 2
Step 3, teste "201 com a linha criada"; decisão 5 (duplicidade vira `400`)
→ Task 2 Step 3 (`error.code === '23505'`), teste correspondente; decisão 6
(máquina de estados) → Task 1, 6 testes de `transicionarStatus`; decisão 7
(`suspensa_em` embutido no update) → Task 1 (mesma função, testes 3-4 do
Step 2); decisão 8 (`transicionarStatus` valida E monta update) → Task 1;
decisão 9 (`municipioId` numérico livre) → Task 4 Step 3 (input
`type="number"`, sem dropdown); decisão 10 (botões mostram só transições
legais) → Task 4 (`PROXIMOS_STATUS`), testado no Step 1; decisão 11
(`subdominio` normaliza + valida formato) → Task 2 Step 3
(`subdominioValido`), testado; decisão 12 (`uf` normaliza) → Task 2 Step 3,
testado; decisão 13 (`dataEleicao` sem confiar em `Date.parse()` sozinho)
→ Task 2 Step 3 (`dataEleicaoValida`, comparação de componentes),
testado com os 2 casos de ano bissexto/não-bissexto; decisão 14 (rota de
status retorna a linha) → Task 3 Step 3, teste "200 com transição válida".
Todos os 24 itens de teste do spec → cobertos: 1-6 (Task 1), 7-15 (Task 2,
renomeados/reordenados levemente pra bater com a implementação real —
mesma cobertura), 16-20 (Task 3), 21-24 (Task 4). Não-objetivos:
nenhuma task cria job de expurgo, exportação LGPD, edição de campos
pós-criação, dropdown de município, `DELETE`, ou CSS — confirmado por
omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda
task tem código completo (teste + implementação), incluindo os 4 arquivos
existentes reescritos por inteiro em vez de diffs parciais.

**3. Consistência de tipos:** `StatusCampanha` (Task 1,
`constantes.ts`) é usado identicamente em `transicionar-status.ts` (Task
1, importado), na rota de status (Task 3, via `isStatusCampanha`) e no
componente (Task 4, redeclarado localmente como union literal
`'ativa'|'suspensa'|'encerrada'` — não importado de `constantes.ts` porque
o componente já tem seu próprio tipo `Campanha` com o mesmo formato dos
outros campos vindos da API, mesmo padrão do `Modulo` que também é
importado só onde precisa, e `StatusCampanha` sendo uma union de 3 strings
literais idêntica não corre risco de divergir). `Cargo`/`Abrangencia`
(Task 1) usados identicamente em Task 2 (via `isCargo`/`isAbrangencia`) e
Task 4 (importados diretamente pro `<select>`). `ResultadoTransicao` (Task
1) é o tipo de retorno de `transicionarStatus`, consumido em Task 3 via
`resultado.valida`/`resultado.update`/`resultado.erro` — nomes batem
exatamente.
