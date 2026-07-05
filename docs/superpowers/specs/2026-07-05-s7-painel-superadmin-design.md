# S7 — Painel Superadmin (mínimo)

Data: 2026-07-05
Depende de S1 (`custom_access_token_hook`) e S6 (`habilitar_modulo`/`desabilitar_modulo`,
`web/lib/modulos.ts`, `web/scripts/modulos/toggle-modulo.ts`). Não está no
[roadmap original](./2026-06-28-roadmap-decomposicao.md) — decidida depois do S6,
motivada por um débito real: hoje só dá pra ligar/desligar módulo por campanha via
CLI/`execute_sql`, sem UI nenhuma.

## Objetivo

Login e painel Superadmin mínimos: uma identidade fora do escopo de qualquer
campanha, autenticada via Supabase Auth, com uma tela pra listar campanhas e
ligar/desligar módulo (S6) por campanha. Sem CRUD de campanha — continua manual
(`seed.sql`/`execute_sql`), fatia própria depois.

## Decisões desta fatia

1. **Identidade: tabela nova `public.superadmin(user_id uuid PRIMARY KEY
   REFERENCES auth.users(id))`.** Mesmo padrão de `usuario_campanha`
   (`0006_papel_login_usuario_campanha.sql`): RLS ligado sem policy pra
   `authenticated`/`anon` (deny total), só `service_role` e
   `supabase_auth_admin` (pro hook) leem. Sem colunas funcionais além do
   vínculo com `auth.users` — só `criado_em` pra auditoria operacional (ex.:
   "desde quando essa pessoa é superadmin"), nenhum outro dado. Não cabe em
   `usuario_campanha`
   (`campanha_id NOT NULL`) nem em `papel_login` (que é escopado por
   campanha) — Superadmin é "fora da campanha" por definição (ADR 0004,
   escada de papéis), precisa de uma tabela própria sem `campanha_id`.
2. **Claim no JWT via `custom_access_token_hook` atualizado.** A função já
   existe desde o S1 (`0007_custom_access_token_hook.sql`) e preenche
   `app_metadata.campanha_id`/`papel` a partir de `usuario_campanha`. Ganha
   um segundo `SELECT`, independente do primeiro: se `user_id` está em
   `superadmin`, seta `app_metadata.superadmin = true`. `CREATE OR REPLACE`
   numa migration nova — nunca se edita uma migration histórica já aplicada,
   mesma regra de todas as fatias anteriores. Um usuário pode em teoria ter
   os dois claims (`campanha_id` E `superadmin`) se alguém colocar a mesma
   pessoa nas duas tabelas — não é impedido ativamente (YAGNI: nenhum caso de
   uso real pede isso ainda), mas o painel Superadmin não depende de
   `campanha_id` estar ausente, só de `superadmin=true` estar presente.
3. **Checagem reutilizável: `public.actor_e_superadmin() RETURNS boolean`.**
   Pública, `SECURITY DEFINER`, `STABLE`, `search_path=''`, lê `auth.uid()`
   internamente — mesmo padrão anti-spoofing de `actor_tem_modulo` (S6): sem
   parâmetro de identidade. Corpo: `EXISTS(SELECT 1 FROM public.superadmin
   WHERE user_id = auth.uid())`. `REVOKE ALL FROM public, anon` + `GRANT
   EXECUTE TO authenticated` (mesma exceção de sempre: só ela precisa ser
   chamável pelo próprio usuário logado via `ssrClient`). **`SECURITY
   DEFINER` aqui não é só convenção — é necessário.** `superadmin` (decisão
   1) tem RLS deny-total pra `authenticated`; se a função fosse `SECURITY
   INVOKER`, ela rodaria com o papel de quem chamou (`authenticated`), a RLS
   filtraria toda linha da tabela pro `SELECT` interno, e a função sempre
   retornaria `false` — inclusive pro superadmin real. `SECURITY DEFINER`
   eleva o papel efetivo pra dentro da execução (papel do dono da função),
   igual a toda outra função desta família que lê tabela com RLS restritiva.

   **JWT autentica o login; o banco autoriza cada ação — duas fontes, dois
   papéis, de propósito.** O claim `app_metadata.superadmin` (decisão 2) só
   é conferido **no momento do login** (`getClaims()` logo após
   `signInWithPassword`, decisão 5) — ele não é consultado de novo depois
   disso. Toda rota/página protegida do painel (`requireSuperadmin()`,
   decisão 7, e a própria página do dashboard) chama `actor_e_superadmin()`
   a cada request, lendo a tabela `superadmin` **ao vivo**, nunca o JWT.
   Consequência prática: remover a linha de alguém em `superadmin` revoga a
   capacidade de fazer qualquer ação administrativa **imediatamente**, no
   próximo request — independente de o JWT em circulação ainda carregar
   `superadmin=true` (o JWT só volta a refletir a realidade depois de
   expirar/renovar, mas isso não importa, porque nenhuma rota confia nele
   pra autorizar, só pra saber quem está logado no momento do login). JWT =
   "quem é" (autenticação inicial); banco via `actor_e_superadmin()` =
   "pode fazer o quê agora" (autorização contínua, autoridade final).
4. **Rota do painel: `/superadmin/*` no domínio raiz, sem subdomínio.**
   `web/middleware.ts` hoje já deixa passar livre quando não há subdomínio
   (`if (!subdominio) { ...; return NextResponse.next(...) }`) — nenhuma
   mudança de middleware necessária. `/superadmin/login` (página + rota de
   login) e `/superadmin/dashboard` (página protegida) vivem ali. Proteção
   de sessão dentro da própria página/rota (checagem de `ssrClient` +
   `actor_e_superadmin()`), mesmo padrão de toda outra checagem de acesso do
   projeto — sem middleware central novo (mesma decisão já tomada pro gate
   de módulo no S6).
5. **Login: email+senha direto via `signInWithPassword`, sem CPF/subdomínio.**
   Superadmin não é uma "pessoa" de campanha nenhuma — não tem título de
   eleitor nem vínculo. Mesmo formato de orquestrador puro do `loginCampanha`
   (S1, `web/lib/auth/login.ts`): `signIn(email, senha)` retorna se o login
   teve sucesso E o claim `superadmin` verdadeiro (via `getClaims()`, não
   `user.app_metadata` bruto — mesma lição do bug corrigido no S1: claims
   custom só existem no JWT emitido, não em `auth.users.raw_app_meta_data`).
   Se `signIn` retornar falso (credenciais erradas OU claim ausente), a
   sessão é sempre encerrada (`signOut()`) antes de reportar erro genérico —
   mesmo padrão de segurança do `loginCampanha` (nunca vaza "senha certa mas
   sem permissão" vs "senha errada", sempre a mesma mensagem).
6. **Dashboard: lista campanhas + toggle de módulo, reusando o S6 inteiro.**
   `GET /api/superadmin/campanhas` retorna `{id, nome, subdominio,
   modulos_habilitados}[]` de todas as campanhas, via `adminClient()`
   (`service_role`) — só depois de confirmar `actor_e_superadmin()`
   verdadeiro na sessão atual. `POST /api/superadmin/modulos` (body
   `{campanhaId, modulo, acao}`) reusa **sem modificar**
   `toggleModulo`/`ToggleModuloDeps`/`buildToggleModuloDeps` (S6,
   `web/scripts/modulos/toggle-modulo.ts` e
   `web/scripts/modulos/build-toggle-modulo-deps.ts`) — a rota só valida
   `isModulo`/`acao`, chama `toggleModulo(...)`, e traduz o resultado
   (sucesso `200`, erro lançado `400` com a mensagem). Nenhuma função SQL
   nova pra mutação — o S6 já cobre isso.
7. **`requireSuperadmin()` — helper compartilhado, mesmo formato do
   `requireModulo` (S6).** `web/lib/supabase/require-superadmin.ts`:
   `checarSuperadmin()` (interno, discriminated union `{status:'ok'} |
   {status:'sem-sessao'} | {status:'nao-e-superadmin'} | {status:'erro',
   mensagem}`) alimentando `requireSuperadmin(): Promise<NextResponse|null>`
   — as 2 rotas do dashboard (campanhas, modulos) chamam esse helper antes
   de tocar `adminClient()`. Mesma razão de DRY do S6: 2 consumidores já
   justificam extrair a checagem uma vez.
8. **Criação do primeiro Superadmin: script CLI, sem UI de autocadastro.**
   `web/scripts/superadmin/cli/criar.ts --email <email> --senha <senha>` —
   usa `adminClient().auth.admin.createUser(...)` (Admin SDK, mesmo
   mecanismo usado nas fixtures de teste de S2-S6) pra criar o `auth.users`,
   depois insere a linha em `public.superadmin`. Mesmo padrão orquestrador
   puro + `build*Deps` + CLI fino dos scripts `modulos:*`/`tre:*`.

## Não-objetivos

- CRUD de campanha (criar/editar/suspender) — continua manual, fatia própria
  depois.
- Middleware central — decisão 4 acima.
- 2FA/captcha/throttle no login do Superadmin — mesmo débito já conhecido do
  login de campanha desde o S1, não resolvido aqui também.
- UI de criar/remover Superadmin — só CLI (decisão 8).
- Qualquer módulo pago real (Comunicação/IA) — inalterado, diferidos.
- Auditoria de ações do Superadmin (quem habilitou qual módulo quando) — o
  `audit_log`/`registrar_evento_auth` existentes são escopados por
  `campanha_id`; estender esse mecanismo pra ações fora de campanha é
  trabalho novo, fora do MVP desta fatia.
- Impedir ativamente um usuário de ser Superadmin E membro de campanha ao
  mesmo tempo — decisão 2 acima, YAGNI.

## Schema / Funções

Duas migrations novas.

### `superadmin` (tabela) + `actor_e_superadmin()`

```sql
-- 0049_superadmin.sql
CREATE TABLE public.superadmin (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id),
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.superadmin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.superadmin FROM authenticated, anon, public;

-- O hook (rodando como supabase_auth_admin) precisa ler, mesmo padrão de
-- usuario_campanha (0006_papel_login_usuario_campanha.sql).
GRANT SELECT ON TABLE public.superadmin TO supabase_auth_admin;
CREATE POLICY "auth_admin_le_superadmin" ON public.superadmin
  AS PERMISSIVE FOR SELECT TO supabase_auth_admin USING (true);

-- service_role (script de criação) escreve e lê.
GRANT SELECT, INSERT, DELETE ON TABLE public.superadmin TO service_role;

CREATE OR REPLACE FUNCTION public.actor_e_superadmin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.superadmin WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.actor_e_superadmin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actor_e_superadmin() TO authenticated;
```

### `custom_access_token_hook` — atualizado (2º claim independente)

```sql
-- 0050_custom_access_token_hook_superadmin.sql
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  rec record;
  eh_superadmin boolean;
BEGIN
  claims := event->'claims';

  SELECT campanha_id, papel INTO rec
    FROM public.usuario_campanha WHERE user_id = (event->>'user_id')::uuid;

  SELECT EXISTS (
    SELECT 1 FROM public.superadmin WHERE user_id = (event->>'user_id')::uuid
  ) INTO eh_superadmin;

  IF jsonb_typeof(claims->'app_metadata') IS NULL THEN
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  END IF;

  IF rec.campanha_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{app_metadata, campanha_id}', to_jsonb(rec.campanha_id::text));
    claims := jsonb_set(claims, '{app_metadata, papel}', to_jsonb(rec.papel::text));
  END IF;

  IF eh_superadmin THEN
    claims := jsonb_set(claims, '{app_metadata, superadmin}', 'true'::jsonb);
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
```

O bloco `campanha_id`/`papel` é **idêntico** ao já existente desde o S1 — só
o bloco `eh_superadmin` é novo, independente (nenhuma condição cruzada entre
os dois). `LANGUAGE plpgsql` (era implicitamente permitido antes — a versão
original também é `plpgsql`), sem mudança de linguagem.

**Sem necessidade de "limpar" claim antigo antes de preencher.** `claims :=
event->'claims'` no início da função não é o JWT anterior do usuário — é a
baseline que o próprio Supabase Auth calcula na hora de emitir CADA token
novo (login ou refresh), antes de invocar o hook. Cada invocação começa de
uma base fresca; o hook só ADICIONA campos condicionalmente, nunca carrega
um `superadmin=true` de uma execução anterior. Se alguém deixa de ser
superadmin, o próximo token emitido pra essa pessoa (próximo login ou
refresh) simplesmente não passa pelo `IF eh_superadmin THEN` — o claim não
aparece, sem precisar de remoção explícita. Um JWT **já emitido antes** da
remoção continua com o claim antigo até expirar/renovar — mas isso é
exatamente o cenário que a decisão 3 acima já cobre (o banco, não o JWT, é
quem autoriza cada ação).

## Camada Next.js

### Login

`web/lib/auth/login-superadmin.ts` (orquestrador puro, mesmo formato de
`web/lib/auth/login.ts`):

```
LoginSuperadminDeps = { signIn(email, senha): Promise<boolean>; signOut(): Promise<void> }

loginSuperadmin(input: {email, senha}, deps): Promise<{ok: boolean}>
  1. ehSuperadmin = await deps.signIn(input.email, input.senha)
  2. se !ehSuperadmin: await deps.signOut(); retorna {ok: false}
  3. retorna {ok: true}
```

`web/lib/auth/build-login-superadmin-deps.ts`:

```
signIn(email, senha):
  1. ssr.auth.signInWithPassword({email, password: senha})
  2. se error/!user: retorna false
  3. ssr.auth.getClaims() — decodifica os claims REAIS da sessão (não
     user.app_metadata bruto — mesma lição do bug do S1)
  4. retorna claims.app_metadata.superadmin === true
signOut(): ssr.auth.signOut()
```

`POST /api/superadmin/login` (`web/app/api/superadmin/login/route.ts`) —
mesmo contrato de erro genérico do login de campanha (nunca distingue
"senha errada" de "não é superadmin"):

```
1. body: {email, senha}
2. loginSuperadmin({email, senha}, buildLoginSuperadminDeps())
3. !ok → 401 {erro: 'e-mail ou senha inválidos'}
4. ok → 200 {ok: true}
```

`web/app/superadmin/login/page.tsx` — página simples (form email+senha,
sem estilo, mesmo nível de acabamento de `/mapa-calor`/`/dashboard`),
`POST` pro endpoint acima, redireciona pra `/superadmin/dashboard` em caso
de sucesso.

### `requireSuperadmin` + rotas do dashboard

`web/lib/supabase/require-superadmin.ts` — mesmo formato exato de
`web/lib/supabase/require-modulo.ts` (S6):

```
checarSuperadmin() [interno]:
  1. ssrClient(cookies()) → auth.getUser()
  2. sem user → {status: 'sem-sessao'}
  3. supabase.rpc('actor_e_superadmin')
  4. error → {status: 'erro', mensagem: error.message}
  5. data falso → {status: 'nao-e-superadmin'}
  6. data true → {status: 'ok'}

requireSuperadmin(): Promise<NextResponse | null>
  ok → null; sem-sessao → 401; nao-e-superadmin → 403; erro → 500
```

`GET /api/superadmin/campanhas` (`web/app/api/superadmin/campanhas/route.ts`):

```
1. bloqueado = await requireSuperadmin(); se bloqueado, retorna
2. adminClient().from('campanha').select('id, nome, subdominio, modulos_habilitados')
3. retorna o array (200)
```

`POST /api/superadmin/modulos` (`web/app/api/superadmin/modulos/route.ts`):

```
1. bloqueado = await requireSuperadmin(); se bloqueado, retorna
2. body: {campanhaId, modulo, acao}
3. valida acao ∈ {'habilitar','desabilitar'} e isModulo(modulo) — 400 se inválido
4. toggleModulo(acao, campanhaId, modulo, buildToggleModuloDeps())  — reusa o S6
5. erro lançado → 400 {erro: mensagem}; sucesso → 200 {ok: true}
```

`web/app/superadmin/dashboard/page.tsx` — server component, checa sessão +
`actor_e_superadmin()` via `ssrClient` (mesmo padrão sem redirect das
páginas anteriores — mostra mensagem simples se bloqueado), renderiza
`DashboardSuperadminClient` (client component: busca
`/api/superadmin/campanhas`, lista campanhas com checkbox por módulo,
`onChange` chama `POST /api/superadmin/modulos`; um botão "Sair" chama
`POST /api/superadmin/logout` e redireciona pra `/superadmin/login`).

**Toggle é pessimista, não otimista.** O checkbox só reflete o novo estado
depois da resposta `200` de `POST /api/superadmin/modulos` — fica
desabilitado/"carregando" entre o clique e a resposta, e volta ao estado
anterior se a chamada falhar. Mais simples de implementar corretamente que
otimista (sem precisar reverter um estado já mostrado em caso de erro), e a
frequência de uso (ligar/desligar módulo é raro, não é uma interação de
alta cadência) não justifica a complexidade extra de um toggle otimista.

`POST /api/superadmin/logout` (`web/app/api/superadmin/logout/route.ts`):

```
1. ssrClient(cookies()).auth.signOut()
2. retorna 200 {ok: true}
```

Sem checagem de `requireSuperadmin()` aqui — encerrar a própria sessão deve
funcionar mesmo que o claim/registro de superadmin já tenha sido revogado
(a pessoa ainda quer conseguir sair).

## Scripts CLI

`web/scripts/superadmin/cli/criar.ts --email <email> --senha <senha>` —
mesmo padrão orquestrador puro + `build*Deps` + CLI fino dos scripts
`modulos:*` (S6)/`tre:*` (S3):

```
criarSuperadmin(email, senha, deps): Promise<void>
  1. userId = await deps.criarAuthUser(email, senha)
  2. try: await deps.inserirSuperadmin(userId)
     catch (erroInsercao):
       await deps.removerAuthUser(userId)  // compensação: evita usuário órfão
       throw erroInsercao

buildCriarSuperadminDeps(): usa adminClient().auth.admin.createUser(...),
  adminClient().from('superadmin').insert(...), e
  adminClient().auth.admin.deleteUser(...) (compensação)
```

Se o passo 2 falhar (ex.: `user_id` já existe em `superadmin`, conflito de
PK), o `auth.users` criado no passo 1 fica órfão (autenticável, mas sem
nenhum privilégio) se não for revertido — o `catch` remove esse usuário
antes de propagar o erro, evitando esse estado inconsistente.

`npm run superadmin:criar -- --email ... --senha ...` (novo script em
`web/package.json`).

## Testes (critério de pronto)

### Banco (via `execute_sql`, padrão S1-S6)

1. `actor_e_superadmin()` retorna `false` pra usuário comum (com
   `usuario_campanha` mas sem linha em `superadmin`).
2. Retorna `true` depois de inserir o `user_id` em `superadmin`.
3. Retorna `false` (não erro) pra usuário sem sessão/`auth.uid()` nulo
   equivalente (mesmo padrão de defesa das outras funções desta família).
4. `custom_access_token_hook`: usuário só em `usuario_campanha` (não
   superadmin) → claims com `campanha_id`/`papel`, sem `superadmin`.
   Usuário só em `superadmin` (não `usuario_campanha`) → claims com
   `superadmin=true`, sem `campanha_id`/`papel`. Usuário em nenhuma das
   duas → claims sem nenhum dos dois blocos (comportamento idêntico ao
   S1 original pra esse caso).
5. `get_advisors(security)`: sem alerta novo além do WARN esperado
   (`actor_e_superadmin` executável por `authenticated`, mesma categoria já
   aceita das outras funções desta família).

### Camada Next.js

6. `POST /api/superadmin/login`: 401 com senha errada; 401 com senha certa
   de um usuário que NÃO é superadmin (mensagem idêntica ao caso anterior);
   200 com senha certa de um superadmin real.
7. `GET /api/superadmin/campanhas`: 401 sem sessão; 403 com sessão de
   usuário comum (não superadmin); 200 com array de campanhas pra sessão de
   superadmin real.
8. `POST /api/superadmin/modulos`: 401/403 mesma regra acima; 400 com
   `modulo`/`acao` inválidos (sem chamar `toggleModulo`); 400 com
   `campanhaId` inexistente (delega pra `toggleModulo`, já testado no S6);
   200 com toggle real bem-sucedido.
9. Página `/superadmin/dashboard` sem sessão/sem ser superadmin não lança
   erro (mesmo padrão sem redirect de `/mapa-calor`/`/dashboard`).
10. **Banco é a autoridade final, não o JWT** (prova da decisão 3): logar
    como superadmin real (sessão com JWT `superadmin=true` válido), depois
    `DELETE FROM superadmin WHERE user_id = ...` **sem gerar novo
    token/sessão** — `GET /api/superadmin/campanhas` com a MESMA sessão
    (mesmo JWT antigo, ainda com o claim `true`) deve retornar `403`, não
    `200`. Prova que `requireSuperadmin()` consulta `actor_e_superadmin()`
    (banco) a cada request, nunca confia no claim do JWT já emitido.
11. `POST /api/superadmin/logout`: sempre `200`, mesmo chamado sem sessão
    ativa ou depois de já ter sido removido de `superadmin` (não depende de
    `requireSuperadmin()`).

### Scripts CLI

12. `superadmin:criar` cria o `auth.users` + a linha em `superadmin`;
    rodar `actor_e_superadmin()` impersonando esse usuário logo depois
    confirma `true`.
13. `superadmin:criar` com inserção em `superadmin` forçada a falhar (ex.:
    `user_id` duplicado) reverte o `auth.users` recém-criado — confirmar
    que nenhum usuário órfão sobra depois do erro.
