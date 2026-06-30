# S1 — Auth & Papéis: README de operação

## Variáveis de ambiente (servidor — fora do banco)

| Variável | Onde configurar | Descrição |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → Settings → API → service_role key (ou env do servidor Next.js) | Chave service-role do projeto. Nunca exposta ao cliente. Usada pelo seed e por qualquer operação admin-side. |
| `CPF_HMAC_KEY` | Env do servidor Next.js / secret manager | Segredo HMAC-SHA256 para hash irreversível do CPF antes de gravar em `usuario_campanha.cpf_hmac`. Deve ter no mínimo 32 bytes aleatórios. Rotar requer re-hash de todos os registros. |

Ambas as variáveis devem estar presentes em `.env.local` (desenvolvimento) e nas variáveis de ambiente do ambiente de produção (ex.: Vercel / servidor). **Nunca commitar esses valores.**

---

## Custom Access Token Hook

O hook `public.custom_access_token_hook` adiciona `campanha_id` e `papel` ao `app_metadata` do JWT emitido pelo Supabase Auth, viabilizando as políticas RLS de isolamento multi-tenant.

### Como habilitar

**Opção 1 — Dashboard (recomendada para operação manual):**

1. Acesse o Dashboard do Supabase → **Authentication → Hooks**.
2. Em **Customize Access Token (JWT) Claims**, selecione a função `public.custom_access_token_hook`.
3. Salve. O hook passa a ser chamado a cada emissão/renovação de token.

**Opção 2 — Management API (para automação/CI):**

```http
PATCH /v1/projects/{ref}/config/auth
Authorization: Bearer <management-api-token>
Content-Type: application/json

{
  "hook_custom_access_token_enabled": true,
  "hook_custom_access_token_uri": "pg-functions://postgres/public/custom_access_token_hook"
}
```

> **Via usada (2026-06-29):** Opção 1 (Dashboard). Habilitação verificada fim-a-fim por login real — o JWT emitido por `signInWithPassword` carrega `app_metadata.campanha_id` e `app_metadata.papel` (ver seção *Verificação fim-a-fim*).

---

## Fluxo de login

1. O usuário acessa o subdomínio da campanha (ex.: `campanha-a.app.local`).
2. O middleware Next.js resolve o subdomínio e injeta o `campanha_id` no contexto da requisição.
3. Na tela de login, o usuário informa **CPF** ou **e-mail**.
   - Se informar CPF: o front calcula o HMAC-SHA256 do CPF usando `CPF_HMAC_KEY` e usa o hash para localizar o e-mail correspondente em `usuario_campanha` (via Server Action / API route com service-role).
   - Se informar e-mail: usa diretamente.
4. A autenticação é feita via `supabase.auth.signInWithPassword({ email, password })`.
5. Em caso de credencial inválida, exibe **mensagem de erro genérica** ("Credenciais inválidas") — sem revelar se o e-mail/CPF existe ou não.
6. O JWT emitido carrega `app_metadata.campanha_id` e `app_metadata.papel` via hook.
7. O middleware verifica que o `campanha_id` do JWT corresponde ao subdomínio atual. Se não corresponder, rejeita o acesso (subdomain lock).

---

## O que ficou diferido (fora do S1)

Os itens abaixo foram registrados como débito técnico (ADR 0008 — parcial) e serão endereçados em sprints futuras:

- **Captcha** no formulário de login (ex.: hCaptcha / Turnstile).
- **Rate-limit e lockout por CPF/e-mail** (throttle de tentativas de login).
- **2FA** (TOTP ou SMS).
- **Login e painel do Superadmin** (acesso cross-tenant para gestão da plataforma).

---

## Seed de usuários de teste

Script: `supabase/seed/s1_seed_usuarios.mjs`

Cria 1 Gestor por campanha (campanha-a e campanha-b) com CPF hasheado via HMAC.

**Env vars necessárias para rodar o seed:**
- `SUPABASE_URL` (ou `NEXT_PUBLIC_SUPABASE_URL`)
- `SUPABASE_SECRET_KEY`
- `CPF_HMAC_KEY`

**Nota de execução (importante):** `@supabase/supabase-js` está em `web/node_modules`, e o resolvedor de módulos ESM busca a dependência a partir do **diretório do próprio arquivo** (`supabase/seed/`), não do `cwd`. Por isso `cd web && node ../supabase/seed/...` **não** resolve a dependência. Use uma das vias abaixo:

```bash
# Via A (recomendada) — instalar a dep na raiz do repo, então rodar da raiz
npm i @supabase/supabase-js
node --env-file=web/.env.local supabase/seed/s1_seed_usuarios.mjs

# Via B — rodar uma cópia do script fisicamente dentro de web/ (resolve via web/node_modules)
cp supabase/seed/s1_seed_usuarios.mjs web/_seed_tmp.mjs
cd web && node --env-file=.env.local _seed_tmp.mjs && rm _seed_tmp.mjs
```

> `--env-file` (Node ≥ 20.6) carrega os segredos de `web/.env.local` sem exportá-los manualmente.

---

## Verificação fim-a-fim (Task 12 — executada 2026-06-29)

Todos os critérios de pronto do spec foram validados no projeto cloud `axcftjqdjvknrpqzrxls`:

1. **Seed:** `seed ok` para `gestor.a@teste.local` (campanha-a) e `gestor.b@teste.local` (campanha-b).
2. **Hook (função):** `custom_access_token_hook` produz `app_metadata = {campanha_id, papel:"gestor"}` correto para cada usuário semeado.
3. **Hook (login real):** `signInWithPassword(gestor.a@teste.local)` emite JWT cujo `app_metadata.campanha_id` = id da campanha A e `papel` = `gestor` — prova de que o Auth invoca o hook.
4. **Isolamento RLS com claim real:** sob a claim de A, apenas linhas de A são visíveis em `audit_log` (0 de B); idem para B. Isolamento multi-tenant fim-a-fim confirmado.
5. **Advisors (security):** nenhum alerta **novo** do S1 (todas as 4 funções com `search_path=''`; `usuario_campanha` com RLS+policy). Lints remanescentes são pré-existentes do S0 e intencionais: `security_definer_view` em `campanha_publica` (ERROR, por design), `rls_enabled_no_policy` em `campanha` (INFO, default-deny). Há ainda um WARN de config do Auth — `auth_leaked_password_protection` desabilitado (proteção HaveIBeenPwned); ligar é um toggle recomendado, deferido.
