# S1 — Auth & papéis

Data: 2026-06-29
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Depende do S0
([fundação multi-tenant](./2026-06-28-s0-fundacao-design.md)), já merjado.
ADRs cobertos: 0008 (parcial — ver Não-objetivos), 0004 (parcial — base no token;
autoridade per-ramo fica no S2). Apoia-se no contrato de claim congelado no S0
e no isolamento por RLS (ADR 0001) e na residência/cripto (ADR 0010).

## Objetivo

Dar identidade e sessão aos usuários de campanha: login por CPF (traduzido para
e-mail) ou e-mail, sobre o Supabase Auth; um *Custom Access Token Hook* que
preenche `app_metadata.campanha_id` e `app_metadata.papel` — fazendo o RLS do S0
finalmente operar com token real; recuperação de senha; e o login **preso ao
subdomínio**. Toda a lógica server-side roda no app Next já scaffoldado no S0.

## Decisões desta fatia

1. **Fonte do claim:** tabela de membership mínima `usuario_campanha`
   (`user_id, campanha_id, papel, cpf_hmac`) é a fonte-de-verdade que o hook lê.
   O Vínculo (ADR 0004), que carrega a autoridade per-ramo real, chega no S2 e
   passa a derivar/substituir o papel — em S1 o token leva apenas o papel-base
   campaign-level.
2. **CPF→e-mail:** o índice cego HMAC do CPF (ADR 0010) é **puxado para o S1**,
   já que o login é seu primeiro consumidor. CPF nunca é gravado em claro; só
   `cpf_hmac`. S2 reusa o mesmo mecanismo para Pessoa.
3. **Camada server:** a lógica de login (HMAC, lookup, `signInWithPassword`,
   audit) vive em route handler / server action no app Next do S0. O hook de
   token é, por exigência do Supabase, uma função Postgres à parte.
4. **Blindagem:** rate-limit **só per-IP nativo do Supabase**
   (`sign_in_sign_ups`). Captcha e throttle/lockout por CPF/e-mail são
   **diferidos** (decisão do produto; ADR 0008 atendida parcialmente).
5. **Superadmin / provisão:** sem login de Superadmin e sem rota de
   provisionamento no S1. Usuários de teste são criados por script/seed via
   Admin API (`service_role`). Superadmin segue só `service_role`; painel e
   login próprios ficam no roadmap posterior.

## Não-objetivos (ficam para outras fatias)

- Tabelas Pessoa/Vínculo, grafo e **autoridade per-ramo** (ADR 0004 completa) → S2.
- Painel Superadmin, login de Superadmin e UI de provisionamento de usuários →
  posterior.
- **Captcha** e **rate-limit/lockout por CPF/e-mail** (ADR 0008) → diferidos.
- **2FA** → fora do escopo (decisão de produto, ADR 0008).

## Schema (migrations Postgres)

Migrations aplicadas no projeto cloud `axcftjqdjvknrpqzrxls` via
`mcp__supabase__apply_migration` (uma por passo, nomeada), com cópia versionada
em `supabase/migrations/`. Verificação via `mcp__supabase__execute_sql`.

### enum `papel_login`

`gestor | coordenador | lideranca | colaborador` — exatamente o contrato
congelado no S0. Apoiador não tem login (ADR 0004), logo não aparece aqui.

### tabela `usuario_campanha`

Ponte entre `auth.users` e `campanha`; fonte do claim lida pelo hook.

| coluna | tipo | nota |
|---|---|---|
| `user_id` | uuid PK, FK → `auth.users(id)` on delete cascade | um login = uma linha (ADR 0008: login preso a 1 campanha) |
| `campanha_id` | uuid not null, FK → `campanha(id)` | campanha do login |
| `papel` | `papel_login` not null | papel-base levado ao token |
| `cpf_hmac` | text not null | hex do HMAC-SHA256 do CPF (índice cego, ADR 0010); nunca CPF em claro |
| `criado_em` | timestamptz not null default now() | |

- `unique (campanha_id, cpf_hmac)` — o mesmo humano em duas campanhas usa dois
  `auth.users` distintos (sigilo entre rivais, ADR 0008); o CPF pode repetir
  entre campanhas, mas não dentro de uma.
- RLS ligado. `revoke all on usuario_campanha from authenticated, anon;`. Única
  policy permissiva: `select` para `supabase_auth_admin` (o hook precisa ler;
  ninguém mais). Escrita só por `service_role` (seed/provisão).

## Custom Access Token Hook (função Postgres)

Padrão validado na doc oficial do Supabase (função SQL `STABLE` registrada como
hook em Auth):

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  rec record;
begin
  claims := event->'claims';
  select campanha_id, papel into rec
    from public.usuario_campanha
   where user_id = (event->>'user_id')::uuid;

  if jsonb_typeof(claims->'app_metadata') is null then
    claims := jsonb_set(claims, '{app_metadata}', '{}');
  end if;

  if rec.campanha_id is not null then
    claims := jsonb_set(claims, '{app_metadata, campanha_id}', to_jsonb(rec.campanha_id::text));
    claims := jsonb_set(claims, '{app_metadata, papel}', to_jsonb(rec.papel::text));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on table public.usuario_campanha to supabase_auth_admin;
revoke all on table public.usuario_campanha from authenticated, anon, public;
create policy "auth_admin_le_usuario_campanha" on public.usuario_campanha
  as permissive for select to supabase_auth_admin using (true);
```

- Sem linha → nenhuma claim de `app_metadata.campanha_id`/`papel` é adicionada →
  o RLS do S0 devolve vazio (deny-safe, comportamento já validado no S0), nunca
  erro.
- Hook habilitado na configuração de Auth do projeto (Authentication → Hooks →
  Custom Access Token).
- Honra **exatamente** o contrato congelado no S0
  (`app_metadata.campanha_id` uuid-como-string, `app_metadata.papel` texto).

## CPF→e-mail + índice cego HMAC

- `cpf_hmac = hex(HMAC-SHA256(cpf_normalizado, CPF_HMAC_KEY))`. `CPF_HMAC_KEY` vive
  em **variável de ambiente do server** (fora do banco — ADR 0010), nunca
  acessível ao hook Postgres nem ao cliente. `cpf_normalizado` = só dígitos.
- Dígitos verificadores do CPF validados no **cliente e no servidor**.
- Resolução de e-mail: dado `campanha_id` (do subdomínio) e `cpf_hmac`, lê
  `usuario_campanha` e cruza com `auth.users` usando `service_role` para obter o
  e-mail. Lookup sempre confinado à campanha do subdomínio.
- Quando o formulário recebe e-mail em vez de CPF, pula o HMAC, mas ainda exige
  que o usuário pertença à campanha do subdomínio.

## Fluxo de login (Next route handler / server action)

Server-side no app do S0. `campanha_id` vem do subdomínio resolvido pelo
middleware do S0 (request header — ver fix do S0 sobre header de request).

1. Recebe `{ identificador (CPF ou e-mail), senha }`.
2. Se CPF: valida dígitos; calcula `cpf_hmac`; resolve e-mail preso à campanha.
   Se e-mail: usa direto, exigindo pertencer à campanha.
3. `signInWithPassword(email, senha)` via cliente Supabase server-side.
4. Sucesso: o hook injeta as claims; o server **confere
   `token.app_metadata.campanha_id == campanha do subdomínio`** (defesa em
   profundidade) e grava os cookies de sessão.
5. Falha (CPF/e-mail inexistente, senha errada, campanha divergente): **erro
   genérico** — `"CPF/e-mail ou senha inválidos"`. Sem oráculo de enumeração.
6. **Auditoria:** grava `login.sucesso` / `login.falha` em `audit_log` (estrutura
   do S0) via função `SECURITY DEFINER` nova (`registrar_evento_auth` ou
   equivalente): `campanha_id`, `actor_id` (quando conhecido), `acao`
   (`login.sucesso`/`login.falha`); o IP e demais metadados vão no jsonb
   `depois` (a tabela `audit_log` do S0 não tem coluna de IP dedicada).

**Rate-limit:** confia no per-IP nativo do Supabase (`auth.rate_limit.sign_in_sign_ups`,
default 30 / 5 min por IP). Sem throttle por identidade nem captcha nesta fatia.

## Recuperação de senha

- Formulário aceita CPF ou e-mail → server resolve e-mail (HMAC ou direto) →
  `resetPasswordForEmail(email, { redirectTo })`.
- **Resposta sempre genérica** (ex.: "Se houver conta, enviamos instruções") —
  não revela existência de CPF/e-mail.
- Link de recuperação → página de definição de nova senha (`updateUser`), com a
  sessão de recovery do Supabase.

## Login preso ao subdomínio

- O middleware do S0 já resolve subdomínio→campanha e injeta no request.
- Novo no S1: após autenticado, o middleware/route exige
  `token.app_metadata.campanha_id == campanha do subdomínio`; divergência →
  rejeita e desloga. Bloqueia reuso da sessão da campanha A sob o subdomínio B
  (ADR 0008). A barreira real continua sendo o RLS no banco; isto é fachada
  reforçando a UX e cortando vazamento de sessão cross-tenant cedo.

## Papéis / escada no token

- Token leva o papel **campaign-level** (base), de `usuario_campanha.papel`.
- A autoridade **per-ramo / por sub-árvore** (ADR 0004) é construída no S2 sobre
  o Vínculo; o papel no token é um **gate grosso**, não a permissão final.
- Gestor e Colaborador têm escopo de campanha inteira; Coordenador e Liderança
  ganham recorte de sub-árvore no S2. Colaborador é transversal (equipe
  administrativa). Apoiador não tem login.

## Testes (critério de pronto)

Hook e claims verificados decodificando o JWT real emitido por um login de teste;
RLS verificado via sessão autenticada (não apenas `set local request.jwt.claims`).

1. **Hook:** após login, o JWT carrega `app_metadata.campanha_id` e
   `app_metadata.papel` corretos para o usuário.
2. **RLS com token real:** usuário da campanha A lê apenas linhas de A; query
   cruzada para B retorna 0 linhas (o teste do S0 agora roda fim-a-fim).
3. **CPF→e-mail:** lookup correto; banco contém apenas `cpf_hmac` (zero CPF em
   claro, conferido por inspeção da coluna); CPF/e-mail inexistente devolve o
   **mesmo erro genérico** que senha errada (sem oráculo).
4. **Subdomínio:** sessão emitida no subdomínio de A é rejeitada ao acessar o
   subdomínio de B.
5. **Recuperação:** fluxo de reset por e-mail funciona; resposta é genérica
   para CPF/e-mail existente e inexistente.
6. **Auditoria:** `login.sucesso` e `login.falha` aparecem em `audit_log` com
   `campanha_id` correto.
7. **Advisors:** `get_advisors(type=security)` sem alerta novo (RLS faltante,
   policy frouxa, função sem `search_path` fixo etc.).

## Entregáveis

- Migrations no projeto cloud + cópia em `supabase/migrations/`: enum
  `papel_login`, tabela `usuario_campanha` (+ RLS/grants), função
  `custom_access_token_hook`, função `SECURITY DEFINER` de auditoria de auth.
- Hook habilitado na configuração de Auth do projeto.
- App Next (sobre o scaffold do S0): route/server action de login, recuperação
  de senha, página de nova senha; reforço de subdomínio no middleware;
  utilitário HMAC server-side; validação de CPF cliente+servidor.
- Script de seed (`service_role` + Admin API) criando ao menos 1 Gestor por
  campanha de teste (`campanha-a`, `campanha-b`) com `cpf_hmac` e senha,
  habilitando os testes de isolamento fim-a-fim.
- README de S1 documentando `CPF_HMAC_KEY` (env, fora do banco), o hook, o
  fluxo de login e o que foi diferido (captcha, throttle por identidade, 2FA,
  Superadmin).

## Riscos

- **Enumeração de CPF/e-mail:** mitigada por erro genérico e lookup só
  server-side; sem throttle por identidade, resta a exposição coberta apenas
  pelo per-IP nativo — aceita conscientemente nesta fatia, captcha/throttle
  diferidos.
- **Vazamento da `CPF_HMAC_KEY`:** quebraria o índice cego; chave fica em env do
  server, fora do banco e do cliente, rotacionável (rotação exige recomputar
  `cpf_hmac` — documentar).
- **Hook mal configurado / sem claim:** comportamento deny-safe (RLS devolve
  vazio), mas quebra o login útil; coberto pelo teste 1/2.
- **Papel no token confundido com autoridade final:** o token é gate grosso;
  documentar que a checagem per-ramo é do S2 para não vazar poder entre ramos
  (risco principal da ADR 0004).
- **Reuso de sessão cross-tenant:** mitigado pelo reforço de subdomínio (teste 4)
  somado ao RLS por `campanha_id`.
