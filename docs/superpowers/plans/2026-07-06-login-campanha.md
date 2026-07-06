# Login de campanha (página) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a página `/login` que autentica usuários de campanha via
`POST /api/auth/login` (já existente, S1) — hoje esse endpoint não tem
nenhuma UI que o consuma.

**Architecture:** Uma única página client component (`web/app/login/page.tsx`),
sem backend novo. Mesmo padrão estrutural de `web/app/superadmin/login/page.tsx`
(S7): form simples, `fetch` POST, erro em `role="alert"`, redirect via
`window.location.href`. Duas melhorias sobre esse precedente: `try/catch` ao
redor do `fetch` (o login Superadmin não trata erro de rede) e botão
desabilitado durante a requisição.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TypeScript, Vitest +
`jsdom`/`@testing-library/react` (já existentes desde S4).

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/`
  (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`).
- Spec de referência: `docs/superpowers/specs/2026-07-06-login-campanha-design.md`.
- Sem estilo/CSS — mesmo nível de acabamento de `/mapa-calor`, `/dashboard`,
  `/superadmin/*` (decisão 8 do spec).
- Sem logout, sem redirect automático em `/dashboard`/`/mapa-calor`, sem
  máscara de CPF no cliente (não-objetivos do spec).
- Mensagem de erro: usa `body.erro` quando presente; fallback
  `'Não foi possível entrar.'` quando ausente (resposta sem `body.erro`) ou
  quando o `fetch`/`res.json()` falha antes de produzir uma resposta válida
  (decisões 4-5 do spec).
- Redirect de sucesso: `/dashboard` (decisão 7 do spec).
- Commits frequentes; mensagens estilo do repo (`feat: ...`, `test: ...`).

---

## Contexto de schema/API (não repetir na task)

- `POST /api/auth/login` (`web/app/api/auth/login/route.ts`, S1) — body
  `{identificador, senha}`. Resolve `x-campanha-subdominio` do header
  (já injetado por `web/middleware.ts` a partir do `Host`, a página não
  precisa saber disso). Resposta: `200 {ok:true}` em sucesso; `401 {erro}`
  em qualquer falha (CPF/e-mail inválido, senha errada, conflito de
  subdomínio) — sempre a mesma mensagem genérica
  `"CPF/e-mail ou senha inválidos"`.
- `web/app/superadmin/login/page.tsx` (S7) — página de referência
  estrutural: client component, dois inputs controlados, `fetch` POST,
  `role="alert"` no erro, `window.location.href` no sucesso. Corpo atual
  completo:
  ```tsx
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
  A página desta fatia diverge dela em 3 pontos: campo único
  "CPF ou e-mail" (não e-mail-only), `try/catch` ao redor do `fetch`, e
  botão desabilitado durante a requisição.

---

### Task 1: Página `/login`

**Files:**
- Create: `web/app/login/page.tsx`
- Create: `web/app/login/page.test.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/login` (`web/app/api/auth/login/route.ts`, S1) via `fetch`.
- Produces: página client-side com form identificador+senha. Nenhuma task
  futura consome isso diretamente (é uma folha da árvore de dependências).

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/login/page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

describe('/login page', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
  });

  it('envia identificador e senha pro endpoint de login', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identificador: 'user@campanha.com', senha: 'segredo' }),
      });
    });
  });

  it('mostra a mensagem de erro do servidor quando o login falha', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ erro: 'CPF/e-mail ou senha inválidos' }),
    })) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('CPF/e-mail ou senha inválidos');
    });
  });

  it('usa mensagem genérica quando a resposta de erro não tem body.erro', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar.');
    });
  });

  it('usa mensagem genérica quando o fetch rejeita (falha de rede)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar.');
    });
  });

  it('desabilita o botão durante a requisição e reabilita após erro', async () => {
    let resolveFetch: (value: unknown) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByText('Entrar')).toBeDisabled();
    });

    resolveFetch!({ ok: false, json: async () => ({ erro: 'falhou' }) });

    await waitFor(() => {
      expect(screen.getByText('Entrar')).not.toBeDisabled();
    });
  });

  it('uma nova submissão limpa a mensagem de erro anterior antes da nova requisição concluir', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ erro: 'primeiro erro' }),
    })) as never;
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('CPF ou e-mail'), { target: { value: 'user@campanha.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByText('Entrar'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('primeiro erro');
    });

    let resolveFetch: (value: unknown) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    fireEvent.click(screen.getByText('Entrar'));

    // Antes da 2ª requisição concluir, o alerta antigo já deve ter sumido.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    resolveFetch!({ ok: false, json: async () => ({ erro: 'segundo erro' }) });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('segundo erro');
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/login/page.test.tsx`
Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 3: Implementar a página**

```tsx
// web/app/login/page.tsx
'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [identificador, setIdentificador] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identificador, senha }),
      });
      if (res.ok) {
        window.location.href = '/dashboard';
        return;
      }
      const body = await res.json();
      setErro(body.erro ?? 'Não foi possível entrar.');
    } catch {
      setErro('Não foi possível entrar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={entrar}>
      <input
        value={identificador}
        onChange={(e) => setIdentificador(e.target.value)}
        placeholder="CPF ou e-mail"
      />
      <input
        type="password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        placeholder="Senha"
      />
      <button type="submit" disabled={enviando}>Entrar</button>
      {erro && <p role="alert">{erro}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/login/page.test.tsx`
Expected: PASS — 6/6

- [ ] **Step 5: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes de S0-S7.

- [ ] **Step 6: Commit**

```bash
git add web/app/login/page.tsx web/app/login/page.test.tsx
git commit -m "feat: página /login de campanha (consome POST /api/auth/login do S1)"
```

---

## Self-Review

**1. Cobertura do spec:** decisão 1 (fatia mínima, sem logout/redirect nas
outras páginas) → nenhuma task cria essas peças, confirmado por omissão;
decisão 2 (mesmo padrão estrutural do login Superadmin) → Task 1 Step 3;
decisão 3 (campo único "CPF ou e-mail", sem máscara) → Task 1 Step 3
(`identificador` livre); decisão 4 (mensagem de erro com fallback) → Task 1
testes 2-3; decisão 5 (erro de rede/parse com try/catch) → Task 1 teste 4;
decisão 6 (subdomínio invisível pra página) → Task 1 Step 3 (nenhuma
referência a subdomínio no componente); decisão 7 (redirect `/dashboard`) →
Task 1 Step 3; decisão 8 (sem estilo) → Task 1 Step 3 (HTML puro, sem
classes/CSS); decisão 9 (botão desabilitado) → Task 1 teste 5. Os 5 itens
de teste do spec → cobertos pelos 6 testes da Task 1 (o teste de erro de
rede é um item extra que a lista do spec não numerou explicitamente, mas a
decisão 5 exige o comportamento — adicionado aqui pra fechar a lacuna).
Não-objetivos: nenhuma task cria `POST /api/auth/logout`, mexe em
`/dashboard`/`/mapa-calor`, adiciona máscara de CPF, ou adiciona CSS —
confirmado por omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda
task tem código completo (teste + implementação).

**3. Consistência de tipos:** único componente, sem interface compartilhada
com outra task — não há risco de nome divergente entre tasks. `identificador`/
`senha`/`erro`/`enviando` usados de forma consistente entre os testes e a
implementação.

---

Plano completo e salvo em `docs/superpowers/plans/2026-07-06-login-campanha.md`.
