# S0 — Fundação multi-tenant (espinha backend)

Data: 2026-06-28
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Primeira a ser construída.
ADRs cobertos: 0001, 0010, 0014, 0015 (+ contrato de claim que habilita 0004/0008).

## Objetivo

Estabelecer a base sobre a qual todas as outras fatias se apoiam: isolamento
multi-tenant por RLS, registro de campanhas com ciclo de vida, log de auditoria
imutável e PostGIS — tudo aplicado direto no projeto **Supabase na nuvem** via
MCP. Nenhuma UI além de `/health`.

## Alvo de infraestrutura

- **Projeto Supabase (cloud):** `axcftjqdjvknrpqzrxls` (org `hzucdcptinqcgepwvpih`),
  região `sa-east-1` (São Paulo) — satisfaz a residência no Brasil exigida pela
  ADR 0010. Postgres 17.
- Migrations aplicadas via `mcp__supabase__apply_migration` (uma migration por
  passo, nomeada). Cópia de cada migration versionada no repo em
  `supabase/migrations/` para histórico e auditoria.
- Verificação e testes via `mcp__supabase__execute_sql`.
- Advisors de segurança conferidos ao fim via `mcp__supabase__get_advisors`
  (RLS faltante, políticas frouxas).

## Não-objetivos (ficam para outras fatias)

- Auth real, login CPF→e-mail, hook que **preenche** as claims → S1.
- Tabelas Pessoa/Vínculo e recorte de auditoria por sub-árvore → S2.
- Tabelas de referência TRE/bairro e pipeline → S3.
- Qualquer UI de operação, painel Superadmin real → posterior.

## Schema

### `campanha`
A fronteira de isolamento (ADR 0001) e portadora do ciclo de vida (ADR 0015).

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `subdominio` | text unique not null | fachada DNS wildcard (ADR 0001) |
| `nome` | text not null | exibição/branding |
| `cargo` | enum `cargo` | vereador \| prefeito \| deputado_estadual (ADR 0005) |
| `abrangencia` | enum `abrangencia` | municipal \| estadual (derivada do cargo) |
| `municipio_id` | bigint null | preenchido se municipal; FK lógica p/ S3 |
| `uf` | char(2) null | preenchido se estadual |
| `status` | enum `campanha_status` | ativa \| suspensa \| encerrada (ADR 0015) |
| `data_eleicao` | date not null | âncora de retenção/expurgo (ADR 0014/0015) |
| `suspensa_em` | timestamptz null | início da carência de 30 dias |
| `modulos_habilitados` | jsonb not null default '[]' | entitlements S6 já nascem aqui (ADR 0018) |
| `criado_em` / `atualizado_em` | timestamptz | |

Check: `(abrangencia='municipal' and municipio_id is not null and uf is null)
or (abrangencia='estadual' and uf is not null)`.

### `audit_log` (append-only, imutável — ADR 0014)

| coluna | tipo | nota |
|---|---|---|
| `id` | bigint identity pk | |
| `campanha_id` | uuid not null | escopo de isolamento |
| `actor_id` | uuid null | quem agiu (auth.users); null = sistema |
| `acao` | text not null | ex.: pessoa.criada, vinculo.removido, login.falha |
| `entidade` | text null | tabela/tipo do alvo |
| `entidade_id` | text null | id do alvo |
| `antes` | jsonb null | estado anterior quando relevante |
| `depois` | jsonb null | estado posterior quando relevante |
| `criado_em` | timestamptz not null default now() | |

Imutabilidade: `revoke update, delete on audit_log from authenticated, anon`.
Sem policy de UPDATE/DELETE (default deny já barra; revoke reforça). Inserção via
função `SECURITY DEFINER` em fatias futuras; em S0 só a estrutura e a garantia
append-only. Recorte por sub-árvore é adicionado no S2 (não há árvore ainda); em
S0 a visibilidade é por `campanha_id`.

### Extensões
- `postgis` habilitado já na fundação (evita re-migração em S3/S4).
- HMAC do índice cego de CPF/título (ADR 0010) **não** é resolvido aqui: a ADR
  deixa o mecanismo (função server-side vs extensão) para o build do S2 e exige a
  chave **fora do banco**. S0 não habilita extensão de cripto preventivamente.

## RLS & contrato de claim

Padrão validado na doc oficial do Supabase (custom access token hook + leitura de
`auth.jwt()` em policy):

- **Contrato fixado nesta fatia** (preenchido pelo hook no S1):
  - `app_metadata.campanha_id` (uuid, string) — campanha do usuário logado.
  - `app_metadata.papel` (text) — papel canônico (gestor/coordenador/lideranca/colaborador).
- Toda tabela operacional carrega `campanha_id` e recebe:

```sql
alter table <t> enable row level security;
create policy "isolamento_campanha" on <t>
  for all to authenticated
  using ( campanha_id = (auth.jwt() -> 'app_metadata' ->> 'campanha_id')::uuid )
  with check ( campanha_id = (auth.jwt() -> 'app_metadata' ->> 'campanha_id')::uuid );
```

- **Default deny:** RLS ligado em toda tabela; nenhuma policy permissiva sobrando.
- **Superadmin:** opera via `service_role` (ignora RLS por design) num backend
  server-side separado, nunca pelo app das campanhas (decisão aprovada). S0 não
  cria policy de exceção `is_superadmin`.
- `campanha` em si: sem `campanha_id` próprio. Leitura pública restrita via view
  (abaixo); escrita só `service_role`.

## Subdomínio (resolução pré-auth)

- Middleware Next lê `host`, extrai subdomínio, resolve a campanha.
- Como a leitura ocorre **antes** do login, expõe-se uma **view pública mínima**
  `campanha_publica` com apenas `{ subdominio, nome, status }` (sem PII, sem
  `data_eleicao` nem módulos), legível por `anon`. Subdomínio inexistente →
  404; `status` ≠ ativa → tela de bloqueio/aviso (suspensa/encerrada).
- Middleware injeta o `subdominio`/`campanha_id` resolvido no request para o app
  selecionar a campanha. A barreira **real** continua sendo o RLS no banco
  (ADR 0001) — o middleware é fachada.

## Seed

- Inserir 2 campanhas de teste (`campanha-a`, `campanha-b`) com cargos/abrangências
  distintos, via `execute_sql`, para os testes de isolamento.
- Esqueleto do backend Superadmin: apenas documentar a env `SUPABASE_SECRET_KEY`
  (service_role) e o limite de que só ele escreve em `campanha`. Sem rota real.

## Testes (critério de pronto)

Executados via `mcp__supabase__execute_sql` simulando claims com
`set local request.jwt.claims`:

1. **Isolamento:** sessão com claim campanha A não lê linha de campanha B
   (query cruzada retorna 0 linhas).
2. **With check:** insert com `campanha_id` ≠ claim é rejeitado.
3. **Append-only:** UPDATE e DELETE em `audit_log` falham.
4. **View pública:** `anon` lê `campanha_publica` mas não a tabela `campanha`
   crua (sem PII vazando).
5. **Advisors limpos:** `get_advisors(type=security)` sem alerta de RLS faltante.

## Entregáveis

- Migrations no projeto cloud + cópia em `supabase/migrations/`.
- View `campanha_publica`.
- Middleware de subdomínio no scaffold Next (mínimo, sem outras telas).
- Seed de teste + script/registro dos testes de isolamento.
- README de S0 documentando o contrato de claim e a operação Superadmin via
  service_role.

## Riscos

- **Vazamento entre ramos/campanhas:** mitigado por default-deny + testes 1/2 +
  advisors. Risco principal da ADR 0004 — blindado já na fundação.
- **View pública expor demais:** mantida em 3 colunas não-PII; revisada no teste 4.
- **Claim ausente antes do S1:** policies usam coerção de claim; sem claim a
  query retorna vazio (deny), não erro — comportamento seguro até o hook do S1.
