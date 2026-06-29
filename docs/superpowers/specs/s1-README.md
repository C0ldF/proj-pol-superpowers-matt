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

> Qual via foi usada será confirmada e registrada no momento da habilitação (step live do Task 12).

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

**Nota de execução:** `@supabase/supabase-js` precisa ser resolvível. O pacote está instalado em `web/node_modules`. Execute o seed a partir de `web/` ou instale a dependência na raiz do repo antes de rodar.

```bash
# a partir de web/
cd web && node ../supabase/seed/s1_seed_usuarios.mjs

# ou a partir da raiz (após npm i @supabase/supabase-js na raiz)
node supabase/seed/s1_seed_usuarios.mjs
```

A execução live (Steps 3–6 do Task 12: rodar seed, verificar claims, testar isolamento RLS, rodar advisors) está pendente e será feita quando `CPF_HMAC_KEY` e o Auth hook estiverem configurados.
