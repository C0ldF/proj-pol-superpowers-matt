# Fatia B — Auth Restante Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restilizar `/superadmin/login` e `/redefinir-senha` com o
mesmo padrão visual do `/login` (split-screen, `Button`/`Input`),
fechando o débito de regressão visual do Preflight, e fechar 3 lacunas
combinadas (loading no superadmin/login, `role` correto na mensagem do
redefinir-senha, cobertura de teste pro redefinir-senha).

**Architecture:** Novo componente `Message` (`web/app/components/`)
mapeia `variant: 'error'|'success'` pra `role`/tokens de cor —
reaproveitado pelas 2 telas novas e na refatoração do banner de erro
do `/login` (troca `<p role="alert" ...>` inline por
`<Message variant="error">`, mesmo DOM resultante).
`/superadmin/login` ganha estado `enviando` (mesmo padrão do
`/login`). `/redefinir-senha` troca `msg: string` por um discriminador
`{ tipo: 'sucesso'|'erro'; texto: string } | null`.

**Tech Stack:** Next.js 16.2.9, React 19, Tailwind v4 (já instalado),
Vitest + Testing Library (já instalados).

## Global Constraints

- `Message` não recebe `className`, `role` ou qualquer prop de estilo
  — variant é o único parâmetro, decide `role` + tokens de cor. API
  deliberadamente fechada nesta fatia (ver nota na Task 1).
- `web/app/login/page.test.tsx` (7 casos) não é modificado — a
  refatoração do banner de erro pra `Message` deve produzir o mesmo
  DOM (mesmo `role`, mesmas classes) que o `<p>` inline que ele
  substitui.
- `web/app/superadmin/login/page.test.tsx` — os 2 casos existentes não
  mudam de conteúdo/asserção; um 3º caso é adicionado ao mesmo arquivo.
- Headings não podem duplicar o texto de nenhum label ou botão na
  mesma tela (quebra `getByText` nos testes — já aconteceu na fatia
  anterior). `/superadmin/login`: heading "Acesso restrito" (distinto
  de "E-mail"/"Senha"/"Entrar"). `/redefinir-senha`: heading "Redefinir
  senha" — **não** "Nova senha" (colide com o `label` do campo).
- Wordmark do painel institucional: "Painel Superadmin" em
  `/superadmin/login`, "Sistema Campanha" em `/redefinir-senha`.
- `/superadmin/login`: `Button` fica `disabled={enviando}` mas mantém
  o texto "Entrar" (nunca "Entrando..." ou variação) durante o envio —
  mesmo padrão do `/login`. Sem `try/catch` novo ao redor do `fetch` —
  não estava lá antes, não é uma das 3 lacunas combinadas (ver nota na
  Task 3 sobre o risco aceito disso).
- `/redefinir-senha`: **não** ganha estado de loading/disabled — fora
  de escopo desta fatia (não é uma das 3 lacunas). `Input` da senha
  ganha `autoComplete="new-password"`, **não** ganha `required`.
- `resultado`/`erro` são resetados pra `null` no início de cada submit,
  antes do request — evita mensagem antiga visível durante nova
  tentativa (`/superadmin/login` já faz isso hoje; `/redefinir-senha`
  ganha esse reset nesta fatia).
- Baseline: suite tem hoje 280/280 testes passando (60 arquivos). Cada
  task abaixo declara o delta esperado (`baseline + N`) — se a suíte
  já estiver em um número diferente de 280 no momento da execução
  (ex.: outra fatia mergeada entre a escrita e a execução deste
  plano), o delta continua valendo, só o total muda.

---

### Task 1: Componente `Message`

**Files:**
- Create: `web/app/components/Message.tsx`
- Create: `web/app/components/Message.test.tsx`

**Interfaces:**
- Produces: `Message({ variant: 'error' | 'success', children:
  React.ReactNode }): JSX.Element`. Tasks 2-4 consomem via
  `import { Message } from '../components/Message'` (ou
  `'../../components/Message'` de `web/app/superadmin/login/`).

- [ ] **Step 1: Escrever o teste**

```tsx
// web/app/components/Message.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Message } from './Message';

afterEach(() => {
  cleanup();
});

describe('Message', () => {
  it('renderiza os children', () => {
    render(<Message variant="error">Algo deu errado</Message>);
    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
  });

  it('variante error usa role="alert"', () => {
    render(<Message variant="error">Erro</Message>);
    expect(screen.getByRole('alert')).toHaveTextContent('Erro');
  });

  it('variante error aplica os tokens de cor de erro', () => {
    render(<Message variant="error">Erro</Message>);
    expect(screen.getByRole('alert')).toHaveClass('bg-error-container', 'text-on-error-container');
  });

  it('variante success usa role="status"', () => {
    render(<Message variant="success">Feito</Message>);
    expect(screen.getByRole('status')).toHaveTextContent('Feito');
  });

  it('variante success aplica os tokens de cor de sucesso', () => {
    render(<Message variant="success">Feito</Message>);
    expect(screen.getByRole('status')).toHaveClass('bg-secondary-container', 'text-on-secondary-container');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/components/Message.test.tsx`
Expected: FAIL — `./Message` não existe ainda (erro de import).

- [ ] **Step 3: Implementar**

```tsx
// web/app/components/Message.tsx
interface MessageProps {
  variant: 'error' | 'success';
  children: React.ReactNode;
}

export function Message({ variant, children }: MessageProps) {
  // error → role="alert" (anúncio assertivo, correto pra erro);
  // success → role="status" (anúncio "polite", não-assertivo — mais
  // correto pra confirmação não-urgente do que "alert" seria).
  // Decisão de acessibilidade (ARIA), não só estilo.
  const role = variant === 'error' ? 'alert' : 'status';
  const colorClasses =
    variant === 'error'
      ? 'bg-error-container text-on-error-container'
      : 'bg-secondary-container text-on-secondary-container';

  // <p>, não <div>/<section>: preserva exatamente a semântica e o DOM
  // que já existia no banner de erro inline do /login (mesma tag).
  return (
    <p role={role} className={`rounded px-4 py-3 text-body-md ${colorClasses}`}>
      {children}
    </p>
  );
}
```

Nota: sem `'use client'` — `Message` não usa nenhum hook nem API só de
client, é puramente apresentacional (diferente de `Button`/`Input`,
que existem especificamente pra interação e por isso carregam seu
próprio limite client).

**Decisão arquitetural — API deliberadamente fechada:** `Message` só
aceita `variant: 'error' | 'success'` porque são os únicos 2 casos de
uso reais no produto hoje (nenhuma prop de `role`/estilo exposta,
YAGNI). Isso torna o componente específico desses 2 casos, não um
componente de mensagem genérico. Se aparecer um caso de uso real
futuro (`'warning'`, `'info'`, um contexto fora de formulário), o
componente pode ser expandido então — não é código pra escrever agora
"pra garantir", é uma decisão consciente de manter a API pequena até
que um segundo caso real justifique abri-la.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/components/Message.test.tsx`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add web/app/components/Message.tsx web/app/components/Message.test.tsx
git commit -m "feat: componente Message (variantes error/success)"
```

---

### Task 2: Refatoração do banner de erro do `/login`

**Files:**
- Modify: `web/app/login/page.tsx`

**Interfaces:**
- Consumes: `Message` (Task 1).

**Nota importante:** `web/app/login/page.test.tsx` (7 casos) **não é
modificado por esta task**. O teste usa `getByRole('alert')` — a
marcação abaixo produz o mesmo `role="alert"` e as mesmas classes
(`bg-error-container`, `text-on-error-container`, `rounded`, `px-4`,
`py-3`, `text-body-md`) que o `<p>` inline que ela substitui — a
ORDEM das classes na string muda, mas isso não afeta CSS nem
`toHaveClass`/`getByRole`.

- [ ] **Step 1: Reescrever `web/app/login/page.tsx`**

```tsx
// web/app/login/page.tsx
'use client';
import { useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Message } from '../components/Message';

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
        return; // fica desabilitado — a página já está navegando embora
      }
      let body: { erro?: string } = {};
      try {
        body = await res.json();
      } catch {
        // resposta de erro sem JSON válido — cai no fallback abaixo
      }
      setErro(body.erro ?? 'Não foi possível entrar.');
    } catch {
      setErro('Não foi possível entrar.'); // fetch rejeitou (falha de rede)
    }
    setEnviando(false);
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-center bg-primary px-8 py-16 md:w-[42%]">
        <p className="text-headline-md text-on-primary">Sistema Campanha</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-16 md:px-24">
        <form onSubmit={entrar} className="flex w-full max-w-md flex-col gap-6">
          <h1 className="text-headline-lg text-on-surface">Acesse sua conta</h1>
          <Input
            label="CPF ou e-mail"
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
            placeholder="CPF ou e-mail"
          />
          <Input
            label="Senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha"
          />
          <Button type="submit" disabled={enviando} className="w-full">
            Entrar
          </Button>
          {erro && <Message variant="error">{erro}</Message>}
        </form>
      </div>
    </div>
  );
}
```

Nota: única mudança real é a última linha do `form` — o `<p role="alert" ...>`
inline vira `<Message variant="error">`. Nada mais no arquivo muda
(lógica de `entrar()`/estado idênticos).

- [ ] **Step 2: Rodar os testes existentes de `/login` e confirmar que continuam passando sem modificação**

Run: `cd web && npx vitest run app/login/page.test.tsx`
Expected: PASS — 7/7, sem alterar `page.test.tsx`.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `cd web && npm test`
Expected: baseline + 5 (os 5 testes do `Message` da Task 1 — esta task
não adiciona teste novo, só refatora marcação já coberta pelos 7
testes existentes do `/login`).

- [ ] **Step 4: Commit**

```bash
git add web/app/login/page.tsx
git commit -m "refactor: /login usa Message pro banner de erro"
```

---

### Task 3: Restilização de `/superadmin/login`

**Files:**
- Modify: `web/app/superadmin/login/page.tsx`
- Modify: `web/app/superadmin/login/page.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input` (já existentes), `Message` (Task 1).

- [ ] **Step 1: Adicionar o 3º teste a `web/app/superadmin/login/page.test.tsx` (preserva os 2 existentes)**

```tsx
// web/app/superadmin/login/page.test.tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SuperadminLoginPage from './page';

describe('/superadmin/login page', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
  });

  afterEach(() => {
    cleanup();
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

  it('desabilita o botão durante a requisição e reabilita após erro', async () => {
    let resolveFetch: (value: { ok: boolean; json: () => Promise<{ erro?: string }> }) => void;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as never;
    render(<SuperadminLoginPage />);
    fireEvent.change(screen.getByPlaceholderText('E-mail'), { target: { value: 'admin@x.com' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByText('Entrar'));

    await waitFor(() => {
      expect(screen.getByText('Entrar')).toBeDisabled();
    });

    resolveFetch!({ ok: false, json: async () => ({ erro: 'falhou' }) });

    await waitFor(() => {
      expect(screen.getByText('Entrar')).not.toBeDisabled();
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que só o 3º caso falha**

Run: `cd web && npx vitest run app/superadmin/login/page.test.tsx`
Expected: FAIL no 3º caso (`page.tsx` ainda não desabilita o botão) —
os 2 primeiros continuam PASS (nada mudou neles nem no `page.tsx`
ainda).

- [ ] **Step 3: Reescrever `web/app/superadmin/login/page.tsx`**

```tsx
// web/app/superadmin/login/page.tsx
'use client';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Message } from '../../components/Message';

export default function SuperadminLoginPage() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const res = await fetch('/api/superadmin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (!res.ok) {
      // res.json() assume corpo JSON válido — comportamento idêntico
      // ao arquivo original (nunca tratou resposta não-JSON). Não é
      // uma das 3 lacunas combinadas desta fatia; preservado
      // deliberadamente, não é um bug esquecido.
      const body = await res.json();
      setErro(body.erro ?? 'Não foi possível entrar.');
      setEnviando(false);
      return;
    }
    window.location.href = '/superadmin/dashboard';
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-center bg-primary px-8 py-16 md:w-[42%]">
        <p className="text-headline-md text-on-primary">Painel Superadmin</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-16 md:px-24">
        <form onSubmit={entrar} className="flex w-full max-w-md flex-col gap-6">
          <h1 className="text-headline-lg text-on-surface">Acesso restrito</h1>
          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail"
          />
          <Input
            label="Senha"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha"
          />
          <Button type="submit" disabled={enviando} className="w-full">
            Entrar
          </Button>
          {erro && <Message variant="error">{erro}</Message>}
        </form>
      </div>
    </div>
  );
}
```

Nota: `entrar()` ganha só `setEnviando(true)` (logo após `setErro(null)`)
e `setEnviando(false)` no caminho de erro (antes do `return`) — nada
mais na lógica muda (mesmo `fetch` sem `try/catch`, igual ao arquivo
original; não é uma das 3 lacunas combinadas, então não adiciona
tratamento de falha de rede que não existia). No caminho de sucesso
não há `setEnviando(false)` — a navegação (`window.location.href`)
desmonta a página, mesmo padrão do `/login`.

- [ ] **Step 4: Rodar e confirmar que os 3 passam**

Run: `cd web && npx vitest run app/superadmin/login/page.test.tsx`
Expected: PASS — 3/3.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd web && npm test`
Expected: baseline + 6 (5 do `Message` na Task 1 + 1 caso novo nesta
task).

- [ ] **Step 6: Commit**

```bash
git add web/app/superadmin/login/page.tsx web/app/superadmin/login/page.test.tsx
git commit -m "feat: restiliza /superadmin/login e adiciona estado de loading"
```

---

### Task 4: Restilização de `/redefinir-senha`

**Files:**
- Modify: `web/app/redefinir-senha/page.tsx`
- Create: `web/app/redefinir-senha/page.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input` (já existentes), `Message` (Task 1).

- [ ] **Step 1: Escrever o teste (arquivo novo)**

```tsx
// web/app/redefinir-senha/page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createBrowserClient } from '@supabase/ssr';
import RedefinirSenha from './page';

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

function mockUpdateUser(impl: () => Promise<{ error: { message: string } | null }>) {
  const updateUser = vi.fn(impl);
  vi.mocked(createBrowserClient).mockReturnValue({ auth: { updateUser } } as never);
  return updateUser;
}

describe('/redefinir-senha page', () => {
  it('chama updateUser com a senha digitada', async () => {
    const updateUser = mockUpdateUser(async () => ({ error: null }));

    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'senhaNova123' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ password: 'senhaNova123' });
    });
  });

  it('mostra mensagem de sucesso (role="status") quando updateUser não retorna erro', async () => {
    mockUpdateUser(async () => ({ error: null }));
    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'senhaNova123' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Senha redefinida.');
    });
  });

  it('mostra mensagem de erro (role="alert") quando updateUser retorna erro', async () => {
    mockUpdateUser(async () => ({ error: { message: 'falhou' } }));
    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Salvar'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível redefinir.');
    });
  });

  it('uma nova submissão limpa a mensagem anterior antes da nova requisição concluir', async () => {
    mockUpdateUser(async () => ({ error: { message: 'primeiro erro' } }));
    render(<RedefinirSenha />);
    fireEvent.change(screen.getByPlaceholderText('Nova senha'), { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    let resolveUpdateUser: (value: { error: { message: string } | null }) => void;
    vi.mocked(createBrowserClient).mockReturnValue({
      auth: {
        updateUser: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveUpdateUser = resolve;
            }),
        ),
      },
    } as never);
    fireEvent.click(screen.getByText('Salvar'));

    // Antes da 2ª requisição concluir, a mensagem antiga já deve ter sumido.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    resolveUpdateUser!({ error: null });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Senha redefinida.');
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run app/redefinir-senha/page.test.tsx`
Expected: FAIL — `page.tsx` ainda não usa `resultado`/`Message`
(`role="status"`/`role="alert"` não existem na marcação atual).

- [ ] **Step 3: Reescrever `web/app/redefinir-senha/page.tsx`**

```tsx
// web/app/redefinir-senha/page.tsx
'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Message } from '../components/Message';

type Resultado =
  | { tipo: 'erro'; texto: string }
  | { tipo: 'sucesso'; texto: string };

export default function RedefinirSenha() {
  const [senha, setSenha] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setResultado(null);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.updateUser({ password: senha });
    setResultado(
      error
        ? { tipo: 'erro', texto: 'Não foi possível redefinir.' }
        : { tipo: 'sucesso', texto: 'Senha redefinida.' },
    );
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-center bg-primary px-8 py-16 md:w-[42%]">
        <p className="text-headline-md text-on-primary">Sistema Campanha</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-16 md:px-24">
        <form onSubmit={salvar} className="flex w-full max-w-md flex-col gap-6">
          <h1 className="text-headline-lg text-on-surface">Redefinir senha</h1>
          <Input
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Nova senha"
          />
          <Button type="submit" className="w-full">
            Salvar
          </Button>
          {resultado && (
            <Message variant={resultado.tipo === 'sucesso' ? 'success' : 'error'}>
              {resultado.texto}
            </Message>
          )}
        </form>
      </div>
    </div>
  );
}
```

Nota: `resultado` substitui o antigo `msg: string` — carrega o
discriminador (`tipo`) além do texto, então a renderização escolhe a
variante certa de `Message` sem re-derivar nada. `setResultado(null)`
no início de `salvar()` (antes do `await`) garante que uma mensagem
antiga (sucesso ou erro) some assim que uma nova tentativa começa,
antes da resposta da nova chegar — mesmo princípio já usado em
`/login` pro `erro`. Sem estado de loading/disabled (fora de escopo).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run app/redefinir-senha/page.test.tsx`
Expected: PASS — 4/4.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd web && npm test`
Expected: baseline + 10 (5 do `Message` + 1 do `/superadmin/login` +
4 desta task).

- [ ] **Step 6: Commit**

```bash
git add web/app/redefinir-senha/page.tsx web/app/redefinir-senha/page.test.tsx
git commit -m "feat: restiliza /redefinir-senha com Message (sucesso/erro) e teste novo"
```

---

## Self-Review

- ✓ Todas as decisões do spec (escopo/lacunas, `Message`, wordmark
  diferenciado, headings sem colisão, reset de mensagem, `autoComplete`
  sem `required`, não-objetivos) foram mapeadas pra uma task
  específica — nenhuma ficou só na spec sem task correspondente.
- ✓ Nenhum objetivo fora do escopo foi implementado (sem loading em
  `/redefinir-senha`, sem `try/catch` novo em `/superadmin/login`, sem
  validação de força/confirmação de senha) — confirmado por omissão
  em cada task.
- ✓ Imports e tipos conferidos: caminhos relativos batem com a
  profundidade real de cada arquivo (`../components/Message` de
  `login/`/`redefinir-senha/`, `../../components/Message` de
  `superadmin/login/`); `resultado.tipo` (`'sucesso'|'erro'`, em
  português, domínio da aplicação) e `variant` de `Message`
  (`'error'|'success'`, em inglês, API do componente) são
  discriminadores diferentes por design — a Task 4 traduz um pro
  outro explicitamente, não são o mesmo enum reaproveitado.
- ✓ Progressão de testes consistente: baseline (280) → +5 (Task 1) →
  +5 (Task 2, sem teste novo) → +6 (Task 3) → +10 (Task 4).

---

## Apêndice: Contexto de código existente (não repetir nas tasks)

- `web/app/components/Button.tsx` — já existe, não é modificado por
  nenhuma task desta fatia:
  ```tsx
  'use client';
  import type { ComponentProps } from 'react';

  export function Button({ className = '', ...props }: ComponentProps<'button'>) {
    return (
      <button
        type="button"
        {...props}
        className={`inline-flex items-center justify-center rounded bg-primary px-6 py-3 text-body-md text-on-primary transition-colors hover:bg-primary/90 active:bg-primary/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary ${className}`}
      />
    );
  }
  ```
- `web/app/components/Input.tsx` — já existe, não é modificado por
  nenhuma task desta fatia:
  ```tsx
  'use client';
  import { useId, type ComponentProps } from 'react';

  interface InputProps extends Omit<ComponentProps<'input'>, 'id'> {
    label: string;
    error?: boolean;
    id?: string;
  }

  export function Input({ label, error = false, id, className = '', ...props }: InputProps) {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={inputId}
          className={`text-label-md ${error ? 'text-error' : 'text-on-surface-variant'}`}
        >
          {label}
        </label>
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          {...props}
          className={`rounded border px-4 py-3 text-body-lg text-on-surface placeholder:text-on-surface-variant bg-surface-container-lowest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${error ? 'border-error hover:border-error' : 'border-outline hover:border-on-surface-variant'} ${className}`}
        />
      </div>
    );
  }
  ```
- `web/app/login/page.tsx` — conteúdo atual completo (Task 2 modifica
  este arquivo):
  ```tsx
  'use client';
  import { useState } from 'react';
  import { Button } from '../components/Button';
  import { Input } from '../components/Input';

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
          return; // fica desabilitado — a página já está navegando embora
        }
        let body: { erro?: string } = {};
        try {
          body = await res.json();
        } catch {
          // resposta de erro sem JSON válido — cai no fallback abaixo
        }
        setErro(body.erro ?? 'Não foi possível entrar.');
      } catch {
        setErro('Não foi possível entrar.'); // fetch rejeitou (falha de rede)
      }
      setEnviando(false);
    }

    return (
      <div className="flex min-h-screen flex-col md:flex-row">
        <div className="flex items-center justify-center bg-primary px-8 py-16 md:w-[42%]">
          <p className="text-headline-md text-on-primary">Sistema Campanha</p>
        </div>
        <div className="flex flex-1 items-center justify-center bg-surface px-6 py-16 md:px-24">
          <form onSubmit={entrar} className="flex w-full max-w-md flex-col gap-6">
            <h1 className="text-headline-lg text-on-surface">Acesse sua conta</h1>
            <Input
              label="CPF ou e-mail"
              value={identificador}
              onChange={(e) => setIdentificador(e.target.value)}
              placeholder="CPF ou e-mail"
            />
            <Input
              label="Senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Senha"
            />
            <Button type="submit" disabled={enviando} className="w-full">
              Entrar
            </Button>
            {erro && (
              <p
                role="alert"
                className="rounded bg-error-container px-4 py-3 text-body-md text-on-error-container"
              >
                {erro}
              </p>
            )}
          </form>
        </div>
      </div>
    );
  }
  ```
- `web/app/login/page.test.tsx` — já existe com 7 casos, **não é
  modificado por nenhuma task** (comportamento preservado por
  construção).
- `web/app/superadmin/login/page.tsx` — conteúdo atual completo
  (Task 3 reescreve este arquivo):
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
- `web/app/superadmin/login/page.test.tsx` — conteúdo atual completo
  (Task 3 adiciona um 3º caso a este arquivo, preservando os 2
  existentes):
  ```tsx
  // @vitest-environment jsdom
  import '@testing-library/jest-dom/vitest';
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
  import SuperadminLoginPage from './page';

  describe('/superadmin/login page', () => {
    beforeEach(() => {
      globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as never;
    });

    afterEach(() => {
      cleanup();
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
- `web/app/redefinir-senha/page.tsx` — conteúdo atual completo
  (Task 4 reescreve este arquivo):
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
- `web/app/redefinir-senha/page.test.tsx` — **não existe hoje**
  (criado do zero pela Task 4).
- Path relativo: `web/app/superadmin/login/page.tsx` importa de
  `web/app/components/` como `'../../components/Button'` (2 níveis
  acima: `login/` → `superadmin/` → `app/`). `web/app/redefinir-senha/page.tsx`
  e `web/app/login/page.tsx` importam como `'../components/Button'`
  (1 nível acima).
