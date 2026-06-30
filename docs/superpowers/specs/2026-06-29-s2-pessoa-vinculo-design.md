# S2 — Pessoa & Vínculo (grafo)

Data: 2026-06-29
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Depende do S1
([auth & papéis](./2026-06-29-s1-auth-papeis-design.md)), já merjado.
ADRs cobertos: 0003, 0004, 0009, 0016. Apoia-se no isolamento RLS (ADR 0001),
criptografia/residência (ADR 0010) e audit log (ADR 0014) do S0.

## Objetivo

Construir o grafo Pessoa ↔ Vínculo que dá substância à autoridade per-ramo
prometida pela ADR 0004. Ao término do S2 o sistema pode cadastrar pessoas reais,
posicioná-las na rede política da campanha, aplicar visibilidade por sub-árvore no
RLS e derivar o papel-base do token a partir dos Vínculos ativos.

## Decisões desta fatia

1. **Travessia do grafo:** Recursive CTE encapsulado em funções `SECURITY DEFINER`.
   Sem closure table ou ltree. Performance adequada para campanhas de MVP
   (< ~10k nós); upgrade para closure table é incremental sem mudança de contrato.
2. **Provisão de login:** manual pelo Gestor. Criar Pessoa + Vínculo não provisiona
   `auth.users` automaticamente. FK `usuario_campanha.pessoa_id` preenchida só no
   ato de provisão (via service_role no server).
3. **Sync de papel no token:** trigger em `vinculo` atualiza
   `usuario_campanha.papel = MAX(papel ativo)` após cada mutação. Hook do S1
   **não muda** — continua lendo `usuario_campanha.papel`.
4. **Título de eleitor:** duplo armazenamento — `titulo_hmac` (HMAC blind, dedup)
   + `titulo_enc` (AES-GCM cifrado, exibição/exportação LGPD Art. 18).
5. **Campos LGPD:** no schema desde o S2 (`base_legal`, `data_coleta`,
   `origem_coleta`, `consentimento_dado_em`, `consentimento_revogado_em`,
   `deleted_at`). Endpoints de acesso/exportação/revogação diferidos.
6. **Realocação órfã:** síncrona 2-etapas — dry-run retorna count; confirm executa
   `realocar_subarvore` em transação. Diálogo obrigatório quando count ≥ 50.
   Exclusão em cascata é proibida (ADR 0016).
7. **Autoridade de primeiro registrante:** quem cadastrou a Pessoa primeiro pode
   remover Vínculos posteriores da mesma Pessoa (ou transferir cedendo o próprio
   Vínculo). Evento auditado + notificação para o removido.
8. **Dedup duplo:** servidor tenta título primeiro, depois CPF. Qualquer match
   dispara confirmação de vínculo compartilhado.
9. **Notificação in-app:** tabela `notificacao` simples. Email/push diferidos.
10. **`papel_vinculo` enum novo:** inclui `apoiador` (sem login). `papel_login`
    (S1) não muda.

## Não-objetivos

- Endpoints LGPD (acesso, exportação, revogação de consentimento) → sprint LGPD posterior.
- Painel de gestão de notificações → S5/posterior.
- Seção/Zona eleitoral FK (`secao_id` nullable, preenchida no S3).
- Entitlements de módulo (ADR 0018) → S6.
- Email/push de notificação → roadmap S6.
- Login de Apoiador → ADR 0004 proíbe.

## Novas variáveis de ambiente (servidor — fora do banco)

| Variável | Uso |
|---|---|
| `TITULO_HMAC_KEY` | HMAC-SHA256 do título de eleitor (blind index) |
| `TITULO_ENC_KEY` | AES-GCM para cifrar/decifrar título (display/exportação) |

`CPF_HMAC_KEY` já existe do S1 — reutilizada em `pessoa.cpf_hmac`.

## Schema (migrations 0011–0017)

### Novos enums

**`papel_vinculo`**: `gestor | coordenador | lideranca | colaborador | apoiador`
Distinto de `papel_login` (S1, sem `apoiador`). Vínculo usa `papel_vinculo`;
`usuario_campanha` continua com `papel_login`.

**`base_legal_enum`**: `consentimento | legitimointeresse | obrigacao_legal | outro`

**`origem_coleta_enum`**: `manual | importacao | api`

### Tabela `pessoa`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `campanha_id` | uuid not null FK → `campanha(id)` | isolamento RLS |
| `nome` | text not null | |
| `titulo_hmac` | text | HMAC-SHA256(título normalizado, `TITULO_HMAC_KEY`) |
| `titulo_enc` | text | AES-GCM cifrado (`TITULO_ENC_KEY`) — para exibição/exportação |
| `cpf_hmac` | text | HMAC-SHA256(cpf, `CPF_HMAC_KEY`) — mesma chave do S1 |
| `telefone` | text | normalizado (só dígitos) |
| `email_contato` | text | contato da Pessoa; distinto do email de login |
| `secao_id` | uuid nullable | FK → `secao(id)` — preenchida no S3 |
| `base_legal` | `base_legal_enum` not null default `'legitimointeresse'` | |
| `data_coleta` | timestamptz not null default now() | |
| `origem_coleta` | `origem_coleta_enum` not null default `'manual'` | |
| `consentimento_dado_em` | timestamptz | |
| `consentimento_revogado_em` | timestamptz | |
| `deleted_at` | timestamptz | soft-delete |
| `criado_em` | timestamptz not null default now() | |
| `atualizado_em` | timestamptz not null default now() | |

**Constraints:**
- `UNIQUE (campanha_id, titulo_hmac) WHERE titulo_hmac IS NOT NULL`
- `UNIQUE (campanha_id, cpf_hmac) WHERE cpf_hmac IS NOT NULL`
- `CHECK (pessoa_id <> responsavel_id)` — em `vinculo` (ver abaixo)

### Tabela `vinculo`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `campanha_id` | uuid not null FK → `campanha(id)` | |
| `pessoa_id` | uuid not null FK → `pessoa(id)` | quem está vinculado |
| `responsavel_id` | uuid nullable FK → `pessoa(id)` | NULL = raiz (Gestor sem pai) |
| `papel` | `papel_vinculo` not null | papel nesta posição |
| `criado_por` | uuid FK → `auth.users(id)` | auditoria + autoridade de prioridade |
| `criado_em` | timestamptz not null default now() | |

**Constraints:**
- `UNIQUE (campanha_id, pessoa_id, responsavel_id)`
- `CHECK (pessoa_id <> responsavel_id)`
- Ciclo prevenido por trigger BEFORE INSERT (recursive CTE)

### Tabela `notificacao`

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK | |
| `campanha_id` | uuid not null FK → `campanha(id)` | |
| `destinatario_user_id` | uuid not null FK → `auth.users(id)` | |
| `tipo` | text not null | ex.: `'vinculo_compartilhado'`, `'vinculo_removido_por_prioridade'` |
| `payload` | jsonb not null | dados do evento |
| `lido_em` | timestamptz | null = não lida |
| `criado_em` | timestamptz not null default now() | |

### Alteração em `usuario_campanha` (migration 0017)

```sql
ALTER TABLE usuario_campanha
  ADD COLUMN pessoa_id uuid REFERENCES pessoa(id) ON DELETE SET NULL;
```

Nullable. Preenchido no ato de provisão de login pelo Gestor.

## Funções SECURITY DEFINER

Todas: `search_path = ''`, `REVOKE EXECUTE FROM public, authenticated, anon`.

| Função | Descrição |
|---|---|
| `actor_papel_base(uid)` | Lê `usuario_campanha.papel` — gate grosso |
| `pessoa_em_subarvore_do_actor(uid, pessoa_id)` | Recursive CTE descendo dos vínculos do ator |
| `actor_pode_ver_pessoa(uid, pessoa_id)` | Gestor/Colaborador → true; Coord/Liderança → sub-árvore |
| `actor_pode_editar_pessoa(uid, pessoa_id)` | Igual ao ver; Colaborador exclui mutações estruturais |
| `actor_pode_criar_vinculo_sob(uid, responsavel_id)` | Gestor: qualquer nó; Coord: sub-árvore; Liderança: só apoiador sob si; Colaborador: false |
| `actor_pode_remover_vinculo(uid, vinculo_id)` | Gestor/Coord/Liderança (regras normais) + primeiro registrante |
| `actor_e_primeiro_registrante(uid, pessoa_id)` | true se `vinculo.criado_por = uid` tem o menor `criado_em` para a Pessoa |
| `buscar_pessoa_duplicada(camp_id, titulo_hmac, cpf_hmac)` | Tenta título primeiro, depois CPF; cross-sub-árvore dentro da campanha |
| `subarvore_count(vinculo_id)` | Conta descendentes recursivamente (dry-run) |
| `realocar_subarvore(vinculo_id, novo_responsavel_id)` | UPDATE filhos diretos → novo_responsavel; grava audit_log |

### `pessoa_em_subarvore_do_actor` (esboço SQL)

```sql
WITH RECURSIVE sub AS (
  SELECT v.pessoa_id
    FROM public.vinculo v
    JOIN public.usuario_campanha uc ON uc.pessoa_id = v.responsavel_id
   WHERE uc.user_id = actor_uid
     AND v.campanha_id = (SELECT campanha_id FROM public.usuario_campanha WHERE user_id = actor_uid)
  UNION ALL
  SELECT v2.pessoa_id
    FROM public.vinculo v2
    JOIN sub ON sub.pessoa_id = v2.responsavel_id
)
SELECT EXISTS (SELECT 1 FROM sub WHERE pessoa_id = target_pessoa_id);
```

### `buscar_pessoa_duplicada` (esboço SQL)

```sql
-- 1. tenta por título
SELECT * FROM public.pessoa
 WHERE campanha_id = $1 AND titulo_hmac = $2 AND deleted_at IS NULL
 LIMIT 1;
-- se encontrou → retorna

-- 2. tenta por CPF
SELECT * FROM public.pessoa
 WHERE campanha_id = $1 AND cpf_hmac = $3 AND deleted_at IS NULL
 LIMIT 1;
```

## Triggers

### `trg_vinculo_ciclo_check` — BEFORE INSERT ON `vinculo`

Recursive CTE: verifica se `NEW.responsavel_id` é descendente de `NEW.pessoa_id`.
Se sim: `RAISE EXCEPTION 'ciclo detectado'`.

### `trg_vinculo_sync_papel` — AFTER INSERT/UPDATE/DELETE ON `vinculo`

Recalcula `usuario_campanha.papel` para a Pessoa afetada:

```
MAX papel entre vínculos ativos (excluindo apoiador)
ordenação de prioridade para o token: gestor > coordenador > lideranca > colaborador
(colaborador é transversal — perde para qualquer papel de árvore)
→ UPDATE usuario_campanha SET papel = $max WHERE pessoa_id = affected_pessoa_id
```

Se nenhum vínculo com `papel >= lideranca` restar: grava
`'login.acesso_revogado'` em `audit_log` (desativação manual pelo Gestor).

### `trg_notificacao_vinculo_compartilhado` — AFTER INSERT ON `vinculo`

Se o Vínculo foi criado com flag `compartilhado = true` no contexto da transação:
insere `notificacao` para cada `user_id` dos responsáveis anteriores da Pessoa,
tipo `'vinculo_compartilhado'`.

## RLS Policies

`REVOKE ALL ON pessoa, vinculo, notificacao FROM anon, public`.

### `pessoa`

```sql
-- SELECT: tenant isolation + sub-árvore + não deletados
POLICY "pessoa_select" FOR SELECT TO authenticated
  USING (
    (jwt->'app_metadata'->>'campanha_id')::uuid = campanha_id
    AND deleted_at IS NULL
    AND public.actor_pode_ver_pessoa(auth.uid(), id)
  );

-- INSERT: qualquer papel com login (Colaborador incluso)
POLICY "pessoa_insert" FOR INSERT TO authenticated
  WITH CHECK ((jwt->'app_metadata'->>'campanha_id')::uuid = campanha_id);

-- UPDATE: actor tem autoridade sobre a Pessoa
POLICY "pessoa_update" FOR UPDATE TO authenticated
  USING (public.actor_pode_editar_pessoa(auth.uid(), id));

-- DELETE: proibido para authenticated (soft-delete via UPDATE)
POLICY "pessoa_delete" FOR DELETE TO authenticated
  USING (false);
```

### `vinculo`

```sql
-- SELECT: quem vê a Pessoa vê o Vínculo
POLICY "vinculo_select" FOR SELECT TO authenticated
  USING (
    (jwt->'app_metadata'->>'campanha_id')::uuid = campanha_id
    AND public.actor_pode_ver_pessoa(auth.uid(), pessoa_id)
  );

-- INSERT: checa autoridade de criação sob o responsável
POLICY "vinculo_insert" FOR INSERT TO authenticated
  WITH CHECK (
    (jwt->'app_metadata'->>'campanha_id')::uuid = campanha_id
    AND public.actor_pode_criar_vinculo_sob(auth.uid(), responsavel_id)
  );

-- UPDATE direto: bloqueado (mudanças via funções SECURITY DEFINER)
POLICY "vinculo_update" FOR UPDATE TO authenticated
  USING (false);

-- DELETE: regras normais + primeiro registrante
POLICY "vinculo_delete" FOR DELETE TO authenticated
  USING (
    (jwt->'app_metadata'->>'campanha_id')::uuid = campanha_id
    AND public.actor_pode_remover_vinculo(auth.uid(), id)
  );
```

### `notificacao`

```sql
-- destinatário vê só as próprias
POLICY "notificacao_select" FOR SELECT TO authenticated
  USING (destinatario_user_id = auth.uid());

-- marcar como lida
POLICY "notificacao_update" FOR UPDATE TO authenticated
  USING (destinatario_user_id = auth.uid())
  WITH CHECK (destinatario_user_id = auth.uid());

-- INSERT/DELETE: só via triggers (sem grant para authenticated)
```

## Riscos e defesas em profundidade

| Risco | Defesa |
|---|---|
| Escalada lateral entre ramos | `pessoa_em_subarvore_do_actor` parte dos próprios vínculos do ator; never global |
| Colaborador comandando árvore | `vinculo INSERT` policy + `actor_pode_criar_vinculo_sob` retorna false |
| UPDATE direto em `vinculo` bypassando trigger de ciclo | `vinculo_update USING (false)` — toda mutação estrutural via função SECURITY DEFINER |
| Apoiador com login residual | Trigger registra evento; Gestor desativa manualmente |
| Acesso cross-campanha | Tenant isolation em todas as policies + RLS do S0 |
| Dedup falho (CPF igual, título diferente) | `buscar_pessoa_duplicada` tenta título primeiro, depois CPF — dois níveis de detecção |

## Camada Next.js — fluxos server-side

### `POST /api/pessoas`

1. Valida campos; normaliza título e CPF (só dígitos)
2. Computa `titulo_hmac`, `titulo_enc` (AES-GCM), `cpf_hmac` server-side
3. Chama `buscar_pessoa_duplicada(campanha_id, titulo_hmac, cpf_hmac)` via service_role
4. Match por título → `409 { match_por: 'titulo', pessoa_existente: { id, nome, responsavel_nome } }`
5. Match por CPF → `409 { match_por: 'cpf', pessoa_existente: { ... } }`
6. Usuário confirma vínculo compartilhado → INSERT `vinculo` com flag de compartilhamento; trigger dispara notificação
7. Sem match → INSERT `pessoa` + INSERT `vinculo` em transação

### `GET /api/vinculos/:id/impacto` (dry-run)

Retorna `{ count: N, responsavel_acima: { id, nome } }`.
UI exibe diálogo de confirmação quando `count >= 50`.

### `DELETE /api/vinculos/:id`

Body: `{ destino_id?: uuid }` (null = responsável acima automático).
Chama `realocar_subarvore(vinculo_id, destino_id ?? responsavel_id)` + DELETE em transação.
Grava `audit_log`. Se remoção por prioridade: grava `'vinculo.removido_por_prioridade'` + notificação para o removido.

### `POST /api/pessoas/:id/provisionar-login`

Requer `papel = 'gestor'` no token.
service_role: `auth.admin.createUser` + INSERT `usuario_campanha(user_id, campanha_id, papel, cpf_hmac, pessoa_id)`.
Retorna senha temporária.

### `GET /api/notificacoes`

RLS filtra automaticamente. Retorna não lidas do ator.

### `PATCH /api/notificacoes/:id/ler`

UPDATE `lido_em = now()`. RLS garante acesso só ao destinatário.

## Testes (critério de pronto)

### Banco

1. **Dedup título**: Pessoa duplicada por título → constraint violation; `buscar_pessoa_duplicada` retorna match sem expor dados de outra campanha
2. **Dedup CPF**: Pessoa sem título mas CPF duplicado → `buscar_pessoa_duplicada` detecta por CPF; título diferente + CPF diferente → null (Pessoa nova)
3. **Anti-ciclo**: Vínculo que cria ciclo → trigger exception; Vínculo legítimo inserido normalmente
4. **Visibilidade sub-árvore**: Liderança A não vê Pessoas da sub-árvore de Liderança B; Gestor vê todas; Colaborador vê todas mas não cria Vínculos
5. **Colaborador sem comando de árvore**: INSERT direto em `vinculo` por Colaborador → RLS error
6. **Sync de papel**: Vínculo `gestor` criado → `usuario_campanha.papel = 'gestor'`; removido deixando `lideranca` → `papel = 'lideranca'`; todos removidos → evento `login.acesso_revogado` em `audit_log`
7. **Primeiro registrante**: A (T1) e B (T2) compartilham João; `actor_e_primeiro_registrante(A, João)` = true; A deleta vínculo de B → sucesso + notificação para B; B tenta deletar vínculo de A → RLS error
8. **Realocação órfã**: Remover Vínculo de Coordenador com 3 filhos → filhos realocados para responsável acima em transação única; sub-árvore intacta
9. **Notificação compartilhado**: B confirma segundo Vínculo de João → linha em `notificacao` para A; B não a vê (RLS)
10. **Soft-delete**: `deleted_at` setado → Pessoa some do SELECT; hard DELETE por authenticated → policy bloqueia
11. **`get_advisors(security)`**: sem alerta novo após migration 0015 e após 0016

### Camada Next.js

12. **Fluxo dedup**: POST com título duplicado → 409 `match_por: 'titulo'`; com CPF duplicado (sem título) → 409 `match_por: 'cpf'`; confirmação → Vínculo criado + notificação disparada
13. **HMAC/enc server-side**: banco não contém título nem CPF em claro; `titulo_enc` decifrável com `TITULO_ENC_KEY`; hashes one-way (inspeção de coluna)
14. **Dry-run**: GET `/impacto` retorna count correto sem alterar dados
15. **Provisão de login**: login com credenciais provisionadas emite JWT com `campanha_id` e `papel` corretos; `usuario_campanha.pessoa_id` aponta para a Pessoa
16. **Isolamento de tenant**: Pessoa da campanha A não aparece em query com token de campanha B
