# Throttle/lockout de login de campanha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bloquear tentativas repetidas de login de campanha (mesmo
identificador, mesma campanha) depois de 5 falhas em 15 minutos —
mitigação de brute-force sem serviço externo nem fluxo de enrollment.

**Architecture:** Reaproveita o `audit_log` já existente (populado por
`registrar_evento_auth` desde o S1) em vez de um contador separado — uma
nova função Postgres (`contar_falhas_login_recentes`, `SECURITY DEFINER`,
com índice composto na mesma migration) conta falhas recentes por
identificador+campanha. `loginCampanha` (orquestrador puro,
`web/lib/auth/login.ts`) ganha um passo de checagem logo no início, antes
de qualquer resolução de CPF ou chamada ao Supabase Auth. Tentativas
bloqueadas são logadas sob uma `acao` distinta (`'login.bloqueado'`) que
nunca entra na contagem — evita que hammering durante o bloqueio mantenha
a conta bloqueada indefinidamente (vetor de DoS contra o próprio usuário).

**Tech Stack:** Postgres 17 (Supabase), TypeScript, Vitest,
`mcp__supabase__apply_migration`/`execute_sql`.

## Global Constraints

- **ANTES DE TOCAR CÓDIGO EM `web/`:** ler `web/node_modules/next/dist/docs/`
  (Next.js 16.2.9 tem breaking changes — regra do `web/AGENTS.md`). Esta
  fatia não mexe em rotas Next.js, mas a regra é do projeto inteiro.
- Spec de referência:
  `docs/superpowers/specs/2026-07-07-throttle-login-campanha-design.md`.
- Migration mais recente é `0050`; esta fatia usa `0051`.
- **Nunca chamar `apply_migration` mais de uma vez pra mesma migration** —
  iterar com `execute_sql` + `CREATE OR REPLACE`, só 1 `apply_migration`
  final.
- Limiar: `LIMITE_FALHAS = 5`, `JANELA_MINUTOS = 15` — constantes
  exportadas de `web/lib/auth/login.ts`, nunca números soltos.
- Chave do throttle: `identificador_chave` = e-mail normalizado
  (`trim().toLowerCase()`) OU HMAC do CPF (via `cpfHmac`, já existente) —
  nunca CPF cru. Nomenclatura: `identificador_chave` no banco/jsonb,
  `identificadorChave` em TypeScript, `p_identificador_chave` em
  parâmetro de função Postgres.
- Tentativa bloqueada usa `acao = 'login.bloqueado'` (nunca
  `'login.falha'`) — a consulta de contagem só olha `'login.falha'`, então
  bloqueios nunca se auto-alimentam.
- Escopo só login de campanha (`loginCampanha`). Login do Superadmin fica
  de fora desta fatia (sem infraestrutura de auditoria própria hoje).
- Corrida entre contar e registrar é aceita, não corrigida (sem lock/
  `SERIALIZABLE`) — ver decisão 9 do spec.
- Commits frequentes; mensagens estilo do repo (`feat: ...`, `test: ...`).

---

## Contexto de código existente (não repetir nas tasks)

- `public.audit_log` (migration `0004`): `id bigint`, `campanha_id uuid NOT
  NULL`, `actor_id uuid`, `acao text NOT NULL`, `entidade text`,
  `entidade_id text`, `antes jsonb`, `depois jsonb`, `criado_em timestamptz
  NOT NULL DEFAULT now()`. Append-only (sem UPDATE/DELETE pra
  `authenticated`/`anon`; `service_role` não tem essa revogação, pode
  inserir/deletar — usado nesta fatia só pra fixture de teste, nunca em
  produção).
- `public.registrar_evento_auth(p_campanha_id uuid, p_actor_id uuid,
  p_acao text, p_meta jsonb DEFAULT '{}'::jsonb) RETURNS void` (migration
  `0009`) — já existe, **não muda de assinatura** nesta fatia. Grants:
  `REVOKE ALL FROM authenticated, anon, public` + `GRANT EXECUTE TO
  service_role` (via wiring do app, não chamado diretamente por
  `authenticated`).
- `web/lib/auth/login.ts` — conteúdo atual completo (Task 2 modifica este
  arquivo):
  ```typescript
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
- `web/lib/auth/login.test.ts` — conteúdo atual completo (Task 2 reescreve
  este arquivo, preservando os 6 testes existentes — o factory `deps()`
  precisa ganhar `contarFalhasRecentes` no default, e `cpfHmac` precisa
  virar sensível ao argumento pra permitir testar a decisão 4 do spec):
  ```typescript
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
      expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.anything());
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
- `web/lib/auth/build-login-deps.ts` — conteúdo atual completo (Task 2
  modifica este arquivo):
  ```typescript
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
        const { data: claimsData, error: claimsError } = await ssr.auth.getClaims();
        if (claimsError || !claimsData) return null;
        const meta = claimsData.claims.app_metadata as { campanha_id?: string };
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

---

### Task 1: Migration — índice + `contar_falhas_login_recentes`

**Files:**
- Create: `supabase/migrations/0051_contar_falhas_login_recentes.sql`

**Interfaces:**
- Produces: `public.contar_falhas_login_recentes(p_campanha_id uuid,
  p_identificador_chave text, p_janela_minutos int) RETURNS bigint`.
  Task 2 chama via `adminClient().rpc('contar_falhas_login_recentes', ...)`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0051_contar_falhas_login_recentes.sql

-- Índice composto: cobre exatamente o WHERE de contar_falhas_login_recentes
-- (igualdade em campanha_id/acao/identificador_chave, intervalo em criado_em).
-- Entra desde já, não como otimização futura — audit_log é append-only e só
-- cresce (todo evento de toda campanha desde o S1).
CREATE INDEX IF NOT EXISTS audit_log_login_falha_idx ON public.audit_log (
  campanha_id,
  acao,
  (depois->>'identificador_chave'),
  criado_em DESC
);

CREATE OR REPLACE FUNCTION public.contar_falhas_login_recentes(
  p_campanha_id uuid,
  p_identificador_chave text,
  p_janela_minutos int
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.audit_log
  WHERE campanha_id = p_campanha_id
    AND acao = 'login.falha'
    AND depois->>'identificador_chave' = p_identificador_chave
    AND criado_em > now() - (p_janela_minutos || ' minutes')::interval;
$$;

REVOKE ALL ON FUNCTION public.contar_falhas_login_recentes(uuid, text, int)
  FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.contar_falhas_login_recentes(uuid, text, int)
  TO service_role;
```

- [ ] **Step 2: Aplicar via `mcp__supabase__apply_migration`**

`name`: `contar_falhas_login_recentes`, `query`: conteúdo do Step 1.

- [ ] **Step 3: Criar fixture (2 campanhas reais, sem usuário — só precisa de `campanha_id` válido pra satisfazer a FK de `audit_log`)**

```sql
INSERT INTO public.campanha (subdominio, nome, cargo, abrangencia, municipio_id, data_eleicao)
VALUES ('throttle-fixture-a', 'Throttle Fixture A', 'prefeito', 'municipal', 2211001, '2028-10-01')
RETURNING id;
-- anote como <campanha_a_id>

INSERT INTO public.campanha (subdominio, nome, cargo, abrangencia, municipio_id, data_eleicao)
VALUES ('throttle-fixture-b', 'Throttle Fixture B', 'prefeito', 'municipal', 2211001, '2028-10-01')
RETURNING id;
-- anote como <campanha_b_id>
```

- [ ] **Step 4: Inserir linhas sintéticas de `audit_log` cobrindo os 5 casos de teste**

Substitua `<campanha_a_id>`/`<campanha_b_id>` pelos valores do Step 3.

```sql
-- 3 falhas DENTRO da janela de 15 min, chave 'chave-teste-1', campanha A
INSERT INTO public.audit_log (campanha_id, acao, entidade, depois, criado_em)
VALUES
  ('<campanha_a_id>', 'login.falha', 'auth', '{"identificador_chave":"chave-teste-1"}'::jsonb, now() - interval '2 minutes'),
  ('<campanha_a_id>', 'login.falha', 'auth', '{"identificador_chave":"chave-teste-1"}'::jsonb, now() - interval '5 minutes'),
  ('<campanha_a_id>', 'login.falha', 'auth', '{"identificador_chave":"chave-teste-1"}'::jsonb, now() - interval '10 minutes');

-- 1 falha FORA da janela (20 min atrás), mesma chave/campanha — não deve contar
INSERT INTO public.audit_log (campanha_id, acao, entidade, depois, criado_em)
VALUES ('<campanha_a_id>', 'login.falha', 'auth', '{"identificador_chave":"chave-teste-1"}'::jsonb, now() - interval '20 minutes');

-- 2 bloqueios DENTRO da janela, mesma chave/campanha — NUNCA devem contar
INSERT INTO public.audit_log (campanha_id, acao, entidade, depois, criado_em)
VALUES
  ('<campanha_a_id>', 'login.bloqueado', 'auth', '{"identificador_chave":"chave-teste-1"}'::jsonb, now() - interval '1 minute'),
  ('<campanha_a_id>', 'login.bloqueado', 'auth', '{"identificador_chave":"chave-teste-1"}'::jsonb, now() - interval '30 seconds');

-- 1 falha mesma chave, DENTRO da janela, mas OUTRA campanha (B) — não deve contar pra A
INSERT INTO public.audit_log (campanha_id, acao, entidade, depois, criado_em)
VALUES ('<campanha_b_id>', 'login.falha', 'auth', '{"identificador_chave":"chave-teste-1"}'::jsonb, now() - interval '1 minute');
```

- [ ] **Step 5: Verificar via `execute_sql`**

```sql
-- Caso principal: 3 falhas dentro da janela pra chave-teste-1/campanha A.
SELECT public.contar_falhas_login_recentes('<campanha_a_id>', 'chave-teste-1', 15);
-- esperado: 3 (não 4 — exclui a falha de 20 min atrás; não 5 — exclui os 2 bloqueios;
-- não 4 — exclui a falha da campanha B)

-- Chave nunca usada: zero falhas.
SELECT public.contar_falhas_login_recentes('<campanha_a_id>', 'chave-nunca-usada', 15);
-- esperado: 0

-- Confirma isoladamente que campanha B não vê as falhas de A.
SELECT public.contar_falhas_login_recentes('<campanha_b_id>', 'chave-teste-1', 15);
-- esperado: 1 (só a própria falha de B)
```

- [ ] **Step 6: `EXPLAIN ANALYZE` confirma uso do índice**

```sql
EXPLAIN ANALYZE
SELECT count(*)
FROM public.audit_log
WHERE campanha_id = '<campanha_a_id>'
  AND acao = 'login.falha'
  AND depois->>'identificador_chave' = 'chave-teste-1'
  AND criado_em > now() - interval '15 minutes';
```

Expected: o plano mostra `Index Scan` ou `Index Only Scan` usando
`audit_log_login_falha_idx`, não `Seq Scan`.

- [ ] **Step 7: `get_advisors(type=security)`**

Confirmar zero alertas novos além do padrão já aceito (`SECURITY DEFINER`
executável por `service_role`, mesma categoria das outras funções desta
família).

- [ ] **Step 8: Limpar a fixture**

```sql
DELETE FROM public.audit_log WHERE campanha_id IN ('<campanha_a_id>', '<campanha_b_id>');
DELETE FROM public.campanha WHERE id IN ('<campanha_a_id>', '<campanha_b_id>');
```

- [ ] **Step 9: Salvar cópia e commitar**

```bash
git add supabase/migrations/0051_contar_falhas_login_recentes.sql
git commit -m "feat: contar_falhas_login_recentes + índice de audit_log"
```

---

### Task 2: `loginCampanha` — checagem de throttle

**Files:**
- Modify: `web/lib/auth/login.ts`
- Modify: `web/lib/auth/login.test.ts`
- Modify: `web/lib/auth/build-login-deps.ts`

**Interfaces:**
- Consumes: `contar_falhas_login_recentes` (Task 1, via
  `adminClient().rpc(...)`).
- Produces: `LoginDeps.contarFalhasRecentes(campanhaId, identificadorChave):
  Promise<number>`; `identificadorParaChave(identificador, cpfHmac):
  IdentificadorResolvido`; `LIMITE_FALHAS`/`JANELA_MINUTOS` (constantes
  exportadas de `login.ts`). Nenhuma task futura consome isso.

- [ ] **Step 1: Escrever o teste (reescreve `login.test.ts` inteiro — preserva os 6 testes existentes com pequenos ajustes de asserção, ajusta o `cpfHmac` do factory pra ser sensível ao argumento, adiciona um describe novo pra `identificadorParaChave` e 4 testes novos em `loginCampanha`)**

```typescript
// web/lib/auth/login.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loginCampanha, identificadorParaChave, type LoginDeps } from './login';

const CAMP = 'aaaaaaaa-0000-0000-0000-000000000001';

function deps(over: Partial<LoginDeps> = {}): LoginDeps {
  return {
    cpfHmac: (cpf: string) => `hmac-${cpf}`,
    resolverEmailPorCpf: vi.fn(async () => 'gestor@a.com'),
    campanhaIdPorSubdominio: vi.fn(async () => CAMP),
    signIn: vi.fn(async () => CAMP),
    signOut: vi.fn(async () => {}),
    registrarEvento: vi.fn(async () => {}),
    contarFalhasRecentes: vi.fn(async () => 0),
    ...over,
  };
}

describe('identificadorParaChave', () => {
  const hmac = (cpf: string) => `hmac-${cpf}`;

  it('e-mail: normaliza (trim+lowercase), não chama cpfHmac', () => {
    const cpfHmacSpy = vi.fn(hmac);
    const r = identificadorParaChave(' Gestor@A.com ', cpfHmacSpy);
    expect(r).toEqual({ tipo: 'email', chave: 'gestor@a.com' });
    expect(cpfHmacSpy).not.toHaveBeenCalled();
  });

  it('CPF válido: retorna o HMAC do CPF normalizado', () => {
    const r = identificadorParaChave('529.982.247-25', hmac);
    expect(r).toEqual({ tipo: 'cpf', chave: 'hmac-52998224725' });
  });

  it('CPF inválido (checksum errado): cpf_invalido, sem chamar cpfHmac', () => {
    const cpfHmacSpy = vi.fn(hmac);
    const r = identificadorParaChave('12345678900', cpfHmacSpy);
    expect(r).toEqual({ tipo: 'cpf_invalido' });
    expect(cpfHmacSpy).not.toHaveBeenCalled();
  });

  it('mesmo CPF válido produz sempre a mesma chave, com ou sem pontuação', () => {
    const r1 = identificadorParaChave('529.982.247-25', hmac);
    const r2 = identificadorParaChave('52998224725', hmac);
    expect(r1).toEqual(r2);
  });
});

describe('loginCampanha', () => {
  it('loga por CPF válido e audita sucesso com identificador_chave', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.registrarEvento).toHaveBeenCalledWith(
      'login.sucesso', CAMP, expect.objectContaining({ identificador_chave: 'hmac-52998224725' }),
    );
  });

  it('loga por e-mail direto (sem resolver CPF)', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
    expect(d.resolverEmailPorCpf).not.toHaveBeenCalled();
  });

  it('rejeita CPF inválido com falha genérica, sem checar throttle nem gravar identificador_chave', async () => {
    const d = deps();
    const r = await loginCampanha({ identificador: '12345678900', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.contarFalhasRecentes).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, { ip: undefined, motivo: 'cpf_invalido' });
  });

  it('rejeita senha errada (signIn null)', async () => {
    const d = deps({ signIn: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 'x', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'credenciais' }));
  });

  it('rejeita CPF não encontrado (resolver null) sem chamar signIn', async () => {
    const d = deps({ resolverEmailPorCpf: vi.fn(async () => null) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'cpf_nao_encontrado' }));
  });

  it('rejeita e desloga quando o token é de outra campanha', async () => {
    const d = deps({ signIn: vi.fn(async () => 'outra-campanha-id') });
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.signOut).toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith('login.falha', CAMP, expect.objectContaining({ motivo: 'subdominio' }));
  });

  it('bloqueia sem chamar resolverEmailPorCpf/signIn quando falhasRecentes >= LIMITE_FALHAS, audita login.bloqueado', async () => {
    const d = deps({ contarFalhasRecentes: vi.fn(async () => 5) });
    const r = await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(false);
    expect(d.resolverEmailPorCpf).not.toHaveBeenCalled();
    expect(d.signIn).not.toHaveBeenCalled();
    expect(d.registrarEvento).toHaveBeenCalledWith(
      'login.bloqueado', CAMP, expect.objectContaining({ identificador_chave: 'hmac-52998224725' }),
    );
    expect(d.registrarEvento).not.toHaveBeenCalledWith('login.falha', expect.anything(), expect.anything());
  });

  it('não bloqueia quando falhasRecentes < LIMITE_FALHAS (fluxo segue normal)', async () => {
    const d = deps({ contarFalhasRecentes: vi.fn(async () => 4) });
    const r = await loginCampanha({ identificador: 'gestor@a.com', senha: 's', subdominio: 'campanha-a' }, d);
    expect(r.ok).toBe(true);
  });

  it('inclui identificador_chave (e-mail normalizado) no meta de uma falha existente', async () => {
    const d = deps({ signIn: vi.fn(async () => null) });
    await loginCampanha({ identificador: ' Gestor@A.com ', senha: 'x', subdominio: 'campanha-a' }, d);
    expect(d.registrarEvento).toHaveBeenCalledWith(
      'login.falha', CAMP,
      expect.objectContaining({ motivo: 'credenciais', identificador_chave: 'gestor@a.com' }),
    );
  });

  it('a identificador_chave é a mesma pro mesmo CPF, mesmo com motivos de falha diferentes (prova também o caminho HMAC)', async () => {
    const cpfNaoEncontrado = deps({ resolverEmailPorCpf: vi.fn(async () => null) });
    await loginCampanha({ identificador: '529.982.247-25', senha: 's', subdominio: 'campanha-a' }, cpfNaoEncontrado);
    const metaCpfNaoEncontrado = vi.mocked(cpfNaoEncontrado.registrarEvento).mock.calls[0][2];

    const credenciaisErradas = deps({ signIn: vi.fn(async () => null) });
    await loginCampanha({ identificador: '529.982.247-25', senha: 'x', subdominio: 'campanha-a' }, credenciaisErradas);
    const metaCredenciais = vi.mocked(credenciaisErradas.registrarEvento).mock.calls[0][2];

    expect(metaCpfNaoEncontrado.identificador_chave).toBe(metaCredenciais.identificador_chave);
    expect(metaCpfNaoEncontrado.identificador_chave).toBe('hmac-52998224725');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd web && npx vitest run lib/auth/login.test.ts`
Expected: FAIL — `identificadorParaChave` não existe ainda (erro de
import); `contarFalhasRecentes` não existe em `LoginDeps`/não é usado por
`loginCampanha`.

- [ ] **Step 3: Implementar**

```typescript
// web/lib/auth/login.ts
import { normalizarCpf, cpfValido } from '../cpf';

export const LIMITE_FALHAS = 5;
export const JANELA_MINUTOS = 15;

export interface LoginDeps {
  cpfHmac(cpf: string): string;
  resolverEmailPorCpf(subdominio: string, hmac: string): Promise<string | null>;
  campanhaIdPorSubdominio(subdominio: string): Promise<string | null>;
  signIn(email: string, senha: string): Promise<string | null>; // -> app_metadata.campanha_id ou null
  signOut(): Promise<void>;
  registrarEvento(acao: string, campanhaId: string | null, meta: Record<string, unknown>): Promise<void>;
  contarFalhasRecentes(campanhaId: string, identificadorChave: string): Promise<number>;
}

export interface LoginInput {
  identificador: string;
  senha: string;
  subdominio: string;
  ip?: string;
}

const ehEmail = (s: string) => s.includes('@');

export type IdentificadorResolvido =
  | { tipo: 'email'; chave: string }
  | { tipo: 'cpf'; chave: string }
  | { tipo: 'cpf_invalido' };

export function identificadorParaChave(
  identificador: string,
  cpfHmac: (cpf: string) => string,
): IdentificadorResolvido {
  if (ehEmail(identificador)) {
    return { tipo: 'email', chave: identificador.trim().toLowerCase() };
  }
  const cpf = normalizarCpf(identificador);
  if (!cpfValido(cpf)) {
    return { tipo: 'cpf_invalido' };
  }
  return { tipo: 'cpf', chave: cpfHmac(cpf) };
}

export async function loginCampanha(input: LoginInput, deps: LoginDeps): Promise<{ ok: boolean }> {
  const { identificador, senha, subdominio, ip } = input;
  const campanhaId = await deps.campanhaIdPorSubdominio(subdominio);
  if (!campanhaId) return { ok: false }; // middleware já deveria ter barrado

  const resolvido = identificadorParaChave(identificador, deps.cpfHmac);
  if (resolvido.tipo === 'cpf_invalido') {
    await deps.registrarEvento('login.falha', campanhaId, { ip, motivo: 'cpf_invalido' });
    return { ok: false };
  }

  const falhasRecentes = await deps.contarFalhasRecentes(campanhaId, resolvido.chave);
  if (falhasRecentes >= LIMITE_FALHAS) {
    await deps.registrarEvento('login.bloqueado', campanhaId, { ip, identificador_chave: resolvido.chave });
    return { ok: false };
  }

  const falha = async (motivo: string) => {
    await deps.registrarEvento('login.falha', campanhaId, { ip, motivo, identificador_chave: resolvido.chave });
    return { ok: false as const };
  };

  let email: string | null;
  if (resolvido.tipo === 'email') {
    email = resolvido.chave;
  } else {
    email = await deps.resolverEmailPorCpf(subdominio, resolvido.chave);
    if (!email) return falha('cpf_nao_encontrado');
  }

  const tokenCampanhaId = await deps.signIn(email, senha);
  if (!tokenCampanhaId) return falha('credenciais');

  if (tokenCampanhaId !== campanhaId) {
    await deps.signOut();
    return falha('subdominio');
  }

  await deps.registrarEvento('login.sucesso', campanhaId, { ip, identificador_chave: resolvido.chave });
  return { ok: true };
}
```

Nota: `identificadorParaChave` roda a decisão e-mail-vs-CPF (incluindo
`cpfValido`) uma única vez; `loginCampanha` reaproveita `resolvido.chave`
tanto pra checar o throttle quanto (no caminho CPF) pra chamar
`resolverEmailPorCpf` — nunca recalcula HMAC/normalização uma segunda vez.
Um CPF sintaticamente inválido nunca chega a gerar uma chave nem a chamar
`contarFalhasRecentes` — só o formato já é suficiente pra rejeitar.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd web && npx vitest run lib/auth/login.test.ts`
Expected: PASS — 14/14 (4 em `identificadorParaChave` + 10 em
`loginCampanha`, dos quais 6 já existiam antes desta task).

- [ ] **Step 5: Atualizar `buildLoginDeps` (wiring real, sem teste próprio — mesmo padrão já estabelecido pras outras deps deste arquivo)**

```typescript
// web/lib/auth/build-login-deps.ts
import { cookies } from 'next/headers';
import { adminClient } from '../supabase/server';
import { ssrClient } from '../supabase/ssr';
import { cpfHmac } from '../cpf-hmac';
import { JANELA_MINUTOS } from './login';
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
      const { data: claimsData, error: claimsError } = await ssr.auth.getClaims();
      if (claimsError || !claimsData) return null;
      const meta = claimsData.claims.app_metadata as { campanha_id?: string };
      return meta.campanha_id ?? null;
    },
    signOut: async () => { await ssr.auth.signOut(); },
    registrarEvento: async (acao, campanhaId, meta) => {
      await admin.rpc('registrar_evento_auth', {
        p_campanha_id: campanhaId, p_actor_id: null, p_acao: acao, p_meta: meta,
      });
    },
    contarFalhasRecentes: async (campanhaId, identificadorChave) => {
      const { data } = await admin.rpc('contar_falhas_login_recentes', {
        p_campanha_id: campanhaId,
        p_identificador_chave: identificadorChave,
        p_janela_minutos: JANELA_MINUTOS,
      });
      return Number(data ?? 0);
    },
  };
}
```

Nota: `Number(data ?? 0)` converte explicitamente o `bigint` retornado
pelo Postgres em vez de confiar em como o driver serializa o valor
(decisão 13 do spec).

- [ ] **Step 6: Rodar a suíte inteira do projeto**

Run: `cd web && npx vitest run`
Expected: todos os arquivos passam, incluindo os pré-existentes.

- [ ] **Step 7: Commit**

```bash
git add web/lib/auth/login.ts web/lib/auth/login.test.ts web/lib/auth/build-login-deps.ts
git commit -m "feat: loginCampanha bloqueia após 5 falhas em 15 minutos (throttle)"
```

---

### Task 3: Verificação end-to-end contra o projeto real

**Files:** nenhum arquivo de código novo — task de verificação.

**Interfaces:** nenhuma nova. Consome tudo das Tasks 1-2.

**Nota importante:** `buildLoginDeps()` chama `await cookies()` de
`next/headers` internamente — essa API só funciona dentro do ciclo de
vida de uma requisição Next.js real (depende de `AsyncLocalStorage`
interno do framework) e **lança exceção** se chamada por um script Node
solto fora desse contexto. Não dá pra testar `loginCampanha`/
`buildLoginDeps` chamando-os direto de um script — a verificação
end-to-end precisa passar pela rota HTTP de verdade, com o servidor de
desenvolvimento rodando. `web/middleware.ts` resolve o subdomínio a
partir do header `Host` (`web/lib/subdomain.ts`, aceita
`X.localhost` em dev) — `curl` permite sobrescrever esse header
explicitamente (`fetch()` do browser não permite; é por isso que `curl` é
usado aqui em vez de um script `fetch`).

- [ ] **Step 1: Criar fixture — 1 campanha real + 1 usuário real com senha conhecida**

```sql
INSERT INTO public.campanha (subdominio, nome, cargo, abrangencia, municipio_id, data_eleicao)
VALUES ('throttle-e2e', 'Throttle E2E', 'prefeito', 'municipal', 2211001, '2028-10-01')
RETURNING id;
-- anote como <campanha_id> (status default é 'ativa', middleware não bloqueia)
```

```javascript
// scratchpad: fixture-throttle-e2e.mjs
// Rodar com: node --env-file=web/.env.local fixture-throttle-e2e.mjs
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: user } = await admin.auth.admin.createUser({
  email: 'throttle-e2e@teste.local', password: 'SenhaForte!Throttle1', email_confirm: true,
});
console.log('user_id=', user.user.id);

await admin.from('usuario_campanha').insert({
  user_id: user.user.id, campanha_id: '<campanha_id>', papel: 'gestor', cpf_hmac: 'fixture-throttle-e2e',
});

console.log('fixture pronta.');
```

- [ ] **Step 2: Subir o servidor de desenvolvimento**

```bash
cd web && npm run dev
```

Rodar em background; esperar até a saída confirmar que está pronto
(`Ready` / porta escutando, geralmente `http://localhost:3000`) antes do
próximo passo.

- [ ] **Step 3: 5 requisições com senha errada, depois uma 6ª com a senha certa — via `curl`, simulando o subdomínio pelo header `Host`**

```bash
for i in 1 2 3 4 5; do
  echo "tentativa $i (senha errada):"
  curl -s -o /dev/null -w "status=%{http_code}\n" \
    -X POST http://localhost:3000/api/auth/login \
    -H "Host: throttle-e2e.localhost:3000" \
    -H "Content-Type: application/json" \
    -d '{"identificador":"throttle-e2e@teste.local","senha":"senha-errada"}'
done

echo "6a tentativa (senha CERTA, deveria continuar bloqueado):"
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Host: throttle-e2e.localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"identificador":"throttle-e2e@teste.local","senha":"SenhaForte!Throttle1"}'
```

Expected: as 5 primeiras retornam `status=401`; a 6ª (com a senha CERTA)
também retorna `401` — confirma o bloqueio mesmo com credencial válida.

- [ ] **Step 4: Confirmar via `execute_sql` que a 6ª tentativa gerou `login.bloqueado`, não `login.falha`**

```sql
SELECT acao, depois FROM public.audit_log
WHERE campanha_id = '<campanha_id>'
ORDER BY criado_em DESC
LIMIT 1;
-- esperado: acao = 'login.bloqueado'
```

- [ ] **Step 5: Confirmar que a contagem de falhas não passou de 5 mesmo com a tentativa bloqueada**

```sql
SELECT public.contar_falhas_login_recentes(
  '<campanha_id>',
  (SELECT depois->>'identificador_chave' FROM public.audit_log
    WHERE campanha_id = '<campanha_id>' AND acao = 'login.falha' LIMIT 1),
  15
);
-- esperado: 5 (não 6 — a tentativa bloqueada não contou)
```

- [ ] **Step 6: Parar o servidor de desenvolvimento**

Encerrar o processo do `npm run dev` iniciado no Step 2.

- [ ] **Step 7: Limpar a fixture**

```sql
DELETE FROM public.audit_log WHERE campanha_id = '<campanha_id>';
DELETE FROM public.usuario_campanha WHERE campanha_id = '<campanha_id>';
DELETE FROM public.campanha WHERE id = '<campanha_id>';
```

```javascript
await admin.auth.admin.deleteUser('<user_id>');
```

- [ ] **Step 8: Documentar o resultado**

Anotar no relatório da task: o `status` HTTP de cada uma das 6 tentativas
(Step 3), a `acao` da 6ª linha do `audit_log` (Step 4), e o resultado da
recontagem (Step 5). Não rodar o teste de expiração da janela (esperar 15
minutos reais) — se quiser confirmar esse caso, ajustar `JANELA_MINUTOS`
temporariamente pra um valor pequeno só durante essa checagem manual, e
reverter depois (não commitar a alteração temporária).

---

## Self-Review

**1. Cobertura do spec:** decisão 1 (reaproveita `audit_log`, sem tabela
nova) → Task 1; decisão 2 (chave = identificador normalizado +
`campanha_id`) → Task 1 (schema) + Task 2 (`identificadorChave`); decisão
3 (5 falhas / 15 min, janela deslizante, bloqueia a 6ª tentativa) → Task 1
(função) + Task 2 (constantes); decisão 4 (`cpfValido` roda ANTES do
throttle; checagem de throttle antes de resolver CPF/chamar Auth) → Task 2
Step 3 (`identificadorParaChave` retorna `cpf_invalido` sem gerar chave;
`contarFalhasRecentes` só é chamado depois disso); decisão 5 (mensagem
genérica, sem revelar bloqueio) → Task 2 (rota HTTP não muda, `POST
/api/auth/login` já retorna sempre a mesma mensagem pra `{ok:false}`);
decisão 6 (`'login.bloqueado'` não conta) → Task 1 Step 4-5 (fixture prova
isso explicitamente) + Task 2 (`registrarEvento('login.bloqueado', ...)`);
decisão 7 (`SECURITY DEFINER`, só `service_role`) → Task 1; decisão 8
(constantes exportadas) → Task 2; decisão 9 (corrida aceita, sem lock) →
nenhuma task introduz lock/transação — confirmado por omissão; decisão 10
(índice na mesma migration, `IF NOT EXISTS`) → Task 1 Step 1+6; decisão 11
(`identificadorParaChave` extraído) → Task 2 Step 3; decisão 12 (sucesso
não reseta a contagem) → nenhuma task introduz reset — confirmado por
omissão, e o teste "bloqueia mesmo com senha certa" (Task 3) prova o caso
adjacente (bloqueio não depende de acertar a senha); decisão 13
(`Number(data ?? 0)`) → Task 2 Step 5; decisão 14 (`login.sucesso` grava
`identificador_chave`) → Task 2 Step 3. Os 19 itens de teste do spec →
cobertos: 1-10 (Task 2), 11-17 (Task 1), 18-19 (Task 3).
Não-objetivos: nenhuma task mexe no login do Superadmin, adiciona
captcha/2FA, desbloqueio manual, notificação, ou configuração por
campanha — confirmado por omissão.

**2. Placeholder scan:** nenhum "TBD"/"similar à Task N sem código". Toda
task tem SQL/TS completo, incluindo os 3 arquivos existentes reescritos
por inteiro em vez de diffs parciais.

**3. Consistência de tipos:** `LoginDeps.contarFalhasRecentes` (Task 2)
tem a mesma assinatura declarada na interface e implementada em
`buildLoginDeps` (Task 2) — `(campanhaId: string, identificadorChave:
string) => Promise<number>`. `IdentificadorResolvido`/
`identificadorParaChave` (Task 2 Step 3) são usados com o mesmo formato
discriminado (`{tipo:'email'|'cpf', chave}` | `{tipo:'cpf_invalido'}`)
tanto na implementação quanto no teste (Step 1). O nome do parâmetro RPC
(`p_identificador_chave`, Task 1) bate com o nome usado na chamada
`admin.rpc('contar_falhas_login_recentes', {p_identificador_chave: ...})`
(Task 2). `LIMITE_FALHAS`/`JANELA_MINUTOS` (Task 2, `login.ts`) são os
únicos lugares que definem esses números — a migration (Task 1) recebe
`p_janela_minutos` como parâmetro, não hardcoded, então não há um segundo
"15" duplicado em SQL.
