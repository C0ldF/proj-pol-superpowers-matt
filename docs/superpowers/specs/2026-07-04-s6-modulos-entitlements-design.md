# S6 — Módulos & entitlements

Data: 2026-07-04
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Depende de S0 (tabela
`campanha`, coluna `modulos_habilitados` já existe desde a fundação). ADR
coberto: 0018 (módulos pagos por Campanha).

## Objetivo

Construir a infraestrutura de entitlements por módulo: enum de módulos
válidos, função de checagem reutilizável (`SECURITY DEFINER`, mesmo padrão
anti-spoofing do S4/S5), um script CLI pra habilitar/desabilitar módulo por
campanha (sem UI), e **uma rota nova e mínima gateada como prova de conceito
fim-a-fim**. Nenhum módulo pago real (Comunicação, IA) é construído nesta
fatia — ambos seguem diferidos pelo roadmap. Sem painel/login Superadmin
(débito conhecido desde o S1, fora de escopo aqui).

## Decisões desta fatia

1. **Enum `public.modulo_enum`** com os 2 nomes já previstos no roadmap/ADR
   0018: `'comunicacao'`, `'ia'`. Extensível via migration futura quando um
   módulo real virar código — não há motor de cadastro de módulo dinâmico
   (YAGNI, só 2 nomes conhecidos hoje).
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
   `modulos_habilitados ? p_modulo::text` (operador `?` do jsonb — existência
   de elemento num array de strings). `p_modulo` **não é identidade** — é só
   o nome do módulo perguntado, então recebê-lo como parâmetro explícito não
   abre brecha de spoofing (a função ainda resolve a campanha do próprio
   `auth.uid()`, nunca de um id externo). Retorna `false` (não erro) quando o
   actor não tem `usuario_campanha` — mesmo padrão de defesa das outras
   funções desta família.
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
   `desabilitar.ts` (mesmos argumentos) — fazem `UPDATE campanha SET
   modulos_habilitados = ...` adicionando/removendo o elemento do array
   jsonb, idempotente (habilitar um módulo já habilitado não duplica;
   desabilitar um módulo já ausente não erra).
5. **Prova de conceito: `GET /api/modulos/comunicacao-preview`.** Rota nova,
   mínima, atrás do módulo `comunicacao` — retorna `200
   {preview: true}` quando o módulo está habilitado pra campanha do actor,
   `403 {erro: 'módulo não habilitado'}` quando não, `401` sem sessão. Essa
   rota **não é uma feature real** — é só a prova de que o mecanismo de gate
   funciona fim-a-fim (rota → helper → função SQL → coluna jsonb). Escolhida
   deliberadamente como rota nova em vez de gatear uma tela existente:
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
BEGIN
  SELECT campanha_id INTO v_campanha_id
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_campanha_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.campanha
     WHERE id = v_campanha_id
       AND modulos_habilitados ? p_modulo::text
  );
END;
$$;
REVOKE ALL ON FUNCTION public.actor_tem_modulo(public.modulo_enum) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.actor_tem_modulo(public.modulo_enum) TO authenticated;
```

`SELECT` direto em `public.campanha` dentro desta função funciona porque
`SECURITY DEFINER` roda com o papel do dono da função (que bypassa a RLS de
`campanha` — mesma mecânica de qualquer outra função desta família que lê
tabela com RLS restritiva por dentro de uma função elevada).

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

Ambos: `adminClient()` (`service_role`), leem `modulos_habilitados` da
campanha, adicionam/removem o elemento (idempotente), fazem `UPDATE`.
Padrão orquestrador puro + CLI fino do S3 (`web/scripts/tre/`).

## Testes (critério de pronto)

### Banco (via `execute_sql`, padrão S2-S5)

1. `actor_tem_modulo` retorna `false` pra campanha sem o módulo no array.
2. Retorna `true` depois de um `UPDATE` adicionando o módulo ao array.
3. Retorna `false` (não erro) pra usuário sem `usuario_campanha`.
4. Isolamento entre campanhas: campanha A com `comunicacao` habilitado,
   campanha B sem — actor de B nunca vê `true`.
5. `p_modulo` inválido (fora do enum) falha com erro de cast do Postgres, não
   precisa de validação manual.
6. `get_advisors(security)`: sem alerta novo além do WARN esperado
   (`actor_tem_modulo` executável por `authenticated`, mesma categoria já
   aceita das outras funções desta família).

### Scripts CLI

7. `habilitar.ts` idempotente: rodar 2x com o mesmo módulo não duplica
   elemento no array.
8. `desabilitar.ts` idempotente: rodar num módulo já ausente não erra.

### Camada Next.js

9. `GET /api/modulos/comunicacao-preview`: 401 sem sessão.
10. 403 com sessão de campanha sem o módulo habilitado.
11. 200 `{preview: true}` com sessão de campanha com o módulo habilitado.
