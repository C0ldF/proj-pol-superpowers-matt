# S6 — Módulos & entitlements

Data: 2026-07-04
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Depende de S0 (tabela
`campanha`, coluna `modulos_habilitados` já existe desde a fundação). ADR
coberto: 0018 (módulos pagos por Campanha).

## Objetivo

Construir a infraestrutura de entitlements por módulo: enum de módulos
válidos, função de checagem reutilizável (`SECURITY DEFINER`, mesmo padrão
anti-spoofing do S4/S5), um script CLI pra habilitar/desabilitar módulo por
campanha (sem UI), e **uma rota nova e mínima protegida pelo gate, como
prova de conceito fim-a-fim**. Nenhum módulo pago real (Comunicação, IA) é construído nesta
fatia — ambos seguem diferidos pelo roadmap. Sem painel/login Superadmin
(débito conhecido desde o S1, fora de escopo aqui).

## Decisões desta fatia

1. **Enum `public.modulo_enum`** com os 2 nomes já previstos no roadmap/ADR
   0018: `'comunicacao'`, `'ia'`. Extensível via migration futura quando um
   módulo real virar código — não há motor de cadastro de módulo dinâmico
   (YAGNI, só 2 nomes conhecidos hoje). Enum em vez de `text` livre: elimina
   erro de digitação, valida automaticamente no próprio Postgres (cast
   inválido já falha, sem `IF`/`RAISE` manual — mesmo raciocínio do
   `granularidade_calor_enum` do S4), e deixa o contrato entre aplicação e
   banco explícito.
2. **Checagem via função SQL `SECURITY DEFINER`, não leitura direta do
   client.** `public.campanha` tem RLS ligado **sem nenhuma policy** pra
   `authenticated`/`anon` (`0003_campanha_rls.sql` — deny total; só
   `service_role` lê a tabela direto, ou a view `campanha_publica` com 3
   colunas não-PII). Logo o client autenticado não consegue ler
   `modulos_habilitados` direto — precisa de uma função elevada, mesmo
   padrão de todas as agregações do S2-S5.
   `public.actor_tem_modulo(p_modulo public.modulo_enum) RETURNS boolean` —
   lê `auth.uid()` internamente pra resolver `campanha_id` (via
   `usuario_campanha`, igual `ranking_liderancas`/`evolucao_pessoas`), testa
   se o módulo está no array `modulos_habilitados` **usando o operador `?`
   do PostgreSQL, que verifica a existência de um elemento num array JSONB
   de strings** (`modulos_habilitados ? p_modulo::text`). `p_modulo` **não é
   identidade** — é só o nome do módulo perguntado, então recebê-lo como
   parâmetro explícito não abre brecha de spoofing (a função ainda resolve a
   campanha do próprio `auth.uid()`, nunca de um id externo). Retorna
   `false` (não erro) quando o actor não tem `usuario_campanha` — mesmo
   padrão de defesa das outras funções desta família.
3. **Helper Next.js `requireModulo(modulo)`**, chamado explicitamente dentro
   do handler da rota — mesmo estilo do `authenticatedRpc` (S5). Contrato:
   `requireModulo(modulo: 'comunicacao' | 'ia'): Promise<NextResponse | null>`
   — retorna um `NextResponse` pronto pra `return` imediato quando bloqueado
   (401 sem sessão, 403 sem módulo habilitado), ou `null` quando liberado (o
   handler continua normalmente). Sem middleware central — nenhuma outra
   checagem de acesso no projeto usa middleware central hoje (autenticação é
   sempre verificada dentro do próprio route handler via `ssrClient`), então
   introduzir um mecanismo novo só pra isso quebraria a consistência do
   projeto sem necessidade real ainda (só 1 rota vai usar isso nesta fatia).
4. **Toggle só via script CLI**, sem UI/painel. `web/scripts/modulos/` —
   mesmo padrão dos scripts `web/scripts/tre/*` do S3 (orquestrador puro +
   CLI fino, `service_role`, roda fora do app). Dois scripts:
   `habilitar.ts --campanha <id> --modulo <comunicacao|ia>` e
   `desabilitar.ts` (mesmos argumentos). **A mutação do array não é
   read-modify-write feito em JS** (ler o array, montar o novo array no
   script, mandar um `UPDATE` com o resultado) — isso abre uma condição de
   corrida real: dois scripts rodando perto um do outro podem ler o mesmo
   estado antigo e um `UPDATE` sobrescrever o resultado do outro (script A
   lê `[]`, script B lê `[]`, A grava `[comunicacao]`, B grava `[ia]` —
   `comunicacao` some). Em vez disso, a mutação mora em 2 funções SQL
   (`habilitar_modulo`/`desabilitar_modulo`, ver Schema abaixo) que fazem
   **um único `UPDATE`** calculando o novo valor a partir do valor atual da
   própria linha — Postgres serializa `UPDATE`s concorrentes na mesma linha
   via lock de linha, então não há corrida. O script vira só uma casca fina
   chamando a função certa via `execute_sql`/RPC com `service_role`; nenhuma
   lógica de array mora no TypeScript. Idempotente nos dois sentidos
   (habilitar um módulo já habilitado não duplica; desabilitar um módulo já
   ausente não erra) — garantido pela própria função SQL.
5. **Prova de conceito: `GET /api/modulos/comunicacao-preview`.** Rota nova,
   mínima, atrás do módulo `comunicacao` — retorna `200
   {preview: true}` quando o módulo está habilitado pra campanha do actor,
   `403 {erro: 'módulo não habilitado'}` quando não, `401` sem sessão. Essa
   rota **não é uma feature real** — é só a prova de que o mecanismo de gate
   funciona fim-a-fim (rota → helper → função SQL → coluna jsonb). Escolhida
   deliberadamente como rota nova em vez de proteger uma tela existente:
   núcleo (cadastro, árvore, mapa, dashboard, relatórios, auditoria) é
   **sempre liberado** por decisão do ADR 0018 — nenhuma tela hoje é
   legitimamente "paga", então fingir que é seria uma contradição da própria
   decisão que este ADR registra.
6. **Sem restrição de papel adicional.** Entitlement é por Campanha, não por
   papel — qualquer membro autenticado da campanha (gestor, coordenador,
   liderança, colaborador) com o módulo habilitado passa no gate. Restrição
   por papel, se algum dia necessária pra uma feature específica, é
   responsabilidade da própria feature (como já acontece em outras rotas),
   não do gate de módulo.

## Não-objetivos

- Painel/login Superadmin — débito conhecido desde o S1, fora de escopo.
- Módulos reais funcionais (Comunicação/WhatsApp/SMS, IA) — ambos diferidos
  pelo roadmap (ADR 0013 fase 2, ADR 0018).
- Middleware central de gate por rota — decisão 3 acima.
- UI de toggle de módulo — só CLI nesta fatia.
- Billing/cobrança automática — ADR 0015 já decidiu manual, fora do MVP.
- Cadastro dinâmico de novos nomes de módulo (motor de "criar módulo") — só
  os 2 nomes já conhecidos, YAGNI pra qualquer coisa além disso.

## Schema / Funções

Uma migration nova, reaproveitando a coluna `modulos_habilitados` já
existente desde o S0 (`0002_campanha.sql`, `jsonb NOT NULL DEFAULT
'[]'::jsonb`) — nenhuma alteração de coluna necessária.

### Enum `modulo_enum`

```sql
CREATE TYPE public.modulo_enum AS ENUM ('comunicacao', 'ia');
```

### `actor_tem_modulo(p_modulo)` — pública

```sql
CREATE OR REPLACE FUNCTION public.actor_tem_modulo(
  p_modulo public.modulo_enum
) RETURNS boolean
LANGUAGE sql STABLE STRICT SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.usuario_campanha uc
      JOIN public.campanha c ON c.id = uc.campanha_id
     WHERE uc.user_id = auth.uid()
       AND c.modulos_habilitados ? p_modulo::text
  );
$$;
REVOKE ALL ON FUNCTION public.actor_tem_modulo(public.modulo_enum) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actor_tem_modulo(public.modulo_enum) TO authenticated;
```

Sem `DECLARE`/`IF` — o `JOIN` já resolve o caso "sem `usuario_campanha`" pra
`false` sozinho (nenhuma linha casa, `EXISTS` retorna `false`), mais
idiomático que resolver a campanha numa variável à parte primeiro. `STRICT`
porque `p_modulo` é sempre obrigatório (sem valor default) — com `STRICT`,
uma chamada com `p_modulo IS NULL` retorna `NULL` sem nem executar o corpo,
em vez de rodar a query à toa contra um cast inválido.

`SELECT` direto em `public.campanha`/`public.usuario_campanha` dentro desta
função funciona porque ela é `SECURITY DEFINER` e roda com os privilégios do
seu proprietário — mesmo padrão adotado pelas demais funções elevadas do
projeto (não é uma regra geral de que todo `SECURITY DEFINER` bypassa RLS
automaticamente; depende do proprietário da função ter os privilégios
certos, o que já é o caso de toda função criada via `apply_migration` neste
projeto).

### `habilitar_modulo`/`desabilitar_modulo` — só `service_role`

Mutam `campanha.modulos_habilitados` num único `UPDATE` cada (atômico —
Postgres bloqueia a linha durante o `UPDATE`, então chamadas concorrentes
serializam em vez de perder uma escrita). `REVOKE ALL` de `authenticated`
inclusive — só `service_role` chama (que ignora `REVOKE`/RLS por natureza),
nunca exposta a um client logado. A ordem dos elementos no array não é
significativa (não há nenhuma leitura que dependa de ordem) — `habilitar`
concatena no fim, `desabilitar` reconstrói via `jsonb_agg` filtrando o
elemento removido, sem se preocupar em preservar posição relativa dos
demais.

```sql
CREATE OR REPLACE FUNCTION public.habilitar_modulo(
  p_campanha_id uuid,
  p_modulo public.modulo_enum
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.campanha
     SET modulos_habilitados = CASE
           WHEN modulos_habilitados ? p_modulo::text THEN modulos_habilitados
           ELSE modulos_habilitados || to_jsonb(p_modulo::text)
         END
   WHERE id = p_campanha_id;
$$;
REVOKE ALL ON FUNCTION public.habilitar_modulo(uuid, public.modulo_enum) FROM public, authenticated, anon;

CREATE OR REPLACE FUNCTION public.desabilitar_modulo(
  p_campanha_id uuid,
  p_modulo public.modulo_enum
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.campanha c
     SET modulos_habilitados = coalesce((
           SELECT jsonb_agg(elem)
             FROM jsonb_array_elements_text(c.modulos_habilitados) elem
            WHERE elem <> p_modulo::text
         ), '[]'::jsonb)
   WHERE c.id = p_campanha_id;
$$;
REVOKE ALL ON FUNCTION public.desabilitar_modulo(uuid, public.modulo_enum) FROM public, authenticated, anon;
```

## Camada Next.js

### `requireModulo(modulo)` — helper compartilhado

`web/lib/supabase/require-modulo.ts`:

```
1. ssrClient(cookieStore) — sessão do usuário logado
2. Se não autenticado → retorna NextResponse 401
3. supabase.rpc('actor_tem_modulo', { p_modulo: modulo })
4. Se false → retorna NextResponse 403 {erro: 'módulo não habilitado'}
5. Se true → retorna null (handler continua)
```

### `GET /api/modulos/comunicacao-preview`

```
const blocked = await requireModulo('comunicacao');
if (blocked) return blocked;
return NextResponse.json({ preview: true });
```

## Scripts CLI

`web/scripts/modulos/habilitar.ts --campanha <uuid> --modulo <comunicacao|ia>`
`web/scripts/modulos/desabilitar.ts --campanha <uuid> --modulo <comunicacao|ia>`

Ambos: `adminClient()` (`service_role`), chamam a RPC correspondente
(`habilitar_modulo`/`desabilitar_modulo`) via `execute_sql`/`.rpc(...)` —
nenhuma lógica de leitura/montagem de array no script, a mutação inteira
mora na função SQL (decisão 4 acima). Padrão orquestrador puro + CLI fino
do S3 (`web/scripts/tre/`).

## Testes (critério de pronto)

### Banco (via `execute_sql`, padrão S2-S5)

1. `actor_tem_modulo` retorna `false` pra campanha com `modulos_habilitados`
   contendo outros módulos mas não o perguntado.
2. `actor_tem_modulo` retorna `false` pra campanha com `modulos_habilitados
   = '[]'::jsonb` (array vazio) — caso distinto do teste 1, garante que o
   operador `?` não trata array vazio de forma especial/quebrada.
3. Retorna `true` depois de `habilitar_modulo` adicionar o módulo ao array.
4. Retorna `false` (não erro) pra usuário sem `usuario_campanha`.
5. Isolamento entre campanhas: campanha A com `comunicacao` habilitado,
   campanha B sem — actor de B nunca vê `true`.
6. `p_modulo` inválido (fora do enum) falha com erro de cast do Postgres, não
   precisa de validação manual.
7. `habilitar_modulo` idempotente: chamar 2x com o mesmo módulo não duplica
   elemento no array (`jsonb_array_length` não cresce na segunda chamada).
8. `desabilitar_modulo` idempotente: chamar num módulo já ausente não erra e
   não altera o array.
9. `habilitar_modulo`/`desabilitar_modulo` não executáveis por
   `authenticated` (`REVOKE ALL` inclui esse papel) — confirmar via
   `information_schema.role_routine_grants`, não só leitura do DDL.
10. `get_advisors(security)`: sem alerta novo além do WARN esperado
    (`actor_tem_modulo` executável por `authenticated`, mesma categoria já
    aceita das outras funções desta família — `habilitar_modulo`/
    `desabilitar_modulo` não geram esse WARN por não serem executáveis por
    `authenticated`).

### Scripts CLI

11. `habilitar.ts` chamado 2x com o mesmo módulo não duplica (delega pra
    teste 7, mas confirmando através do script real, não só da função).
12. `desabilitar.ts` chamado num módulo já ausente não erra (delega pra
    teste 8 através do script real).

### Camada Next.js

13. `GET /api/modulos/comunicacao-preview`: 401 sem sessão.
14. 403 com sessão de campanha sem o módulo habilitado.
15. 200 `{preview: true}` com sessão de campanha com o módulo habilitado.
