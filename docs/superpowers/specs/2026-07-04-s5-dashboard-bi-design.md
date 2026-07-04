# S5 — Dashboard BI determinístico

Data: 2026-07-04
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Depende de S2
(Pessoa/Vínculo, grafo, `subarvore_count`, `pessoa_em_subarvore_do_actor`) e
S4 (Mapa de calor — reusa `mapa_calor_agregado`), ambos já mergeados na main.
ADR coberto: 0013 fase 1 (BI determinístico, sem LLM).

## Objetivo

Entregar a segunda tela autenticada do sistema: um dashboard com 3 blocos —
ranking de lideranças por sub-árvore, evolução temporal do número de
pessoas, e alertas por regra fixa (sem motor configurável, sem IA). Full-
stack nesta fatia, mesmo padrão do S4 (SQL + rota Next.js + página real).

## Decisões desta fatia

1. **Ranking = líderes por tamanho de sub-árvore, não áreas geográficas.**
   Sujeito do ranking = toda `pessoa` referenciada como `responsavel_id`
   por pelo menos um `vinculo` (isto é, tem subordinados diretos — o campo
   `responsavel_id` pertence ao vínculo, não à pessoa). Métrica = reusa
   `subarvore_count(vinculo_id)` já existente (S2, migration 0016) —
   contagem recursiva de descendentes, qualquer `papel_vinculo`, sem
   recontar o próprio líder.
2. **Visibilidade do ranking, mesma regra do S4:** gestor/coordenador veem
   o ranking geral, definido como **apenas os líderes de topo — vínculos
   cujo `responsavel_id IS NULL`** (o "líder de topo" é um conceito do
   vínculo, não da pessoa: a mesma pessoa pode ter outro vínculo em que
   *não* é topo). Liderança vê só o ranking dos seus subordinados diretos
   (vínculos cujo `responsavel_id` referencia a pessoa do actor).
3. **Nota "soma dos ramos ≠ total" (ADR 0003).** Para o conjunto de ramos
   exibido (líderes de topo, no caso gestor/coordenador; subordinados
   diretos, no caso liderança): `soma_ramos` = soma de `subarvore_count` de
   cada ramo mostrado; `total_real` = contagem distinta de pessoas
   presentes na união recursiva de todos os ramos exibidos (deduplicando
   apoiadores compartilhados entre ramos). A diferença `soma_ramos -
   total_real` é o número de pessoas compartilhadas por mais de um ramo.
4. **Ordenação do ranking:** `subarvore_count DESC`; em empate, nome da
   liderança `ASC` — evita ordem instável entre requests.
5. **Evolução temporal = evolução acumulada do número de pessoas ao longo
   do tempo**, considerando tanto inserções (`criado_em`) quanto remoções
   (`deleted_at`) — não é só contagem de inserções. Derivado direto de
   `pessoa.criado_em`/`deleted_at`, sem tabela de snapshot (mesmo padrão
   "sem cache" do S4), expressão:

   ```
   total(T) = count(pessoa) WHERE criado_em <= T
                              AND (deleted_at IS NULL OR deleted_at > T)
   ```

   Bucket diário, 90 pontos —
   últimos 90 dias **incluindo o dia atual** (hoje + 89 dias anteriores).
   Escopo de visibilidade igual ao ranking (sub-árvore pra liderança,
   campanha inteira pra gestor/coordenador). **Referência temporal =
   `CURRENT_DATE`, nunca `now()`** — garante que a curva não muda conforme
   o horário do dia em que a query roda (resultado determinístico durante
   todo o dia).
6. **Alertas — regras fixas, sem motor configurável (YAGNI: sem tabela de
   regra/limiar por campanha):**
   - **Área**: reusa `mapa_calor_agregado('zona')` (só granularidade zona
     no MVP — toggle bairro nos alertas é não-objetivo). Alerta quando
     `potencial da área > média simples de potencial` **E**
     `penetracao < 0.05` (área com potencial acima da média mas
     baixíssima conversão em apoiador). A média é calculada sobre
     **todas** as zonas retornadas por `mapa_calor_agregado('zona')` —
     nenhuma zona é excluída do cálculo por ter potencial baixo (a própria
     função já não retorna zona sem nenhum local elegível ao calor, então
     não há caso de potencial zero a decidir incluir ou excluir).
   - **Liderança estagnada**: líder com tenure ≥ 30 dias (desde
     `criado_em` do próprio vínculo, isto é, desde que virou líder) **e**
     nenhuma inserção de pessoa na sub-árvore **em qualquer profundidade**
     (`criado_em` de qualquer descendente, direto ou indireto) nos últimos
     30 dias. Tenure mínimo evita falso-positivo em líder recém-criado.
   - Visibilidade: mesma regra do ranking — gestor/coordenador veem todos
     os alertas (área + liderança-estagnada, campanha inteira); liderança
     vê só o alerta de estagnação sobre si mesma e sobre sub-líderes
     diretos dela. Alerta de área não tem versão "escopo sub-árvore" — não
     é exibido pra liderança (não é um conceito de sub-árvore, é
     geográfico).
7. **Nav shell mínimo**: header simples com links Mapa de Calor ↔
   Dashboard. Sem logout — não existe rota de sign-out ainda; implementá-la
   seria escopo novo fora desta fatia.
8. **Gráfico com Recharts** (dependência nova no projeto). Layout: página
   única, seções empilhadas — Alertas no topo (mais urgente), Evolução no
   meio, Ranking embaixo. Sem abas.
9. **3 RPCs públicas independentes**, mesmo padrão anti-spoofing do
   `mapa_calor_agregado` (`auth.uid()` lido internamente, nunca recebido
   como parâmetro): `ranking_liderancas()`, `evolucao_pessoas()`,
   `dashboard_alertas()`.
10. **Coleção vazia, não erro, quando não há dado.** As 3 RPCs retornam
    conjuntos vazios (ranking sem líderes, evolução com todos os pontos
    zerados, alertas sem nenhuma linha) quando não há dado visível ao
    usuário — nunca lançam exceção só por ausência de dado. Página exibe
    estado vazio ("nenhum líder ainda", "nenhum alerta no momento", etc.),
    não erro.

## Não-objetivos

- Motor de regra configurável (usuário cadastrando limiares) — YAGNI, sem
  pedido real ainda.
- IA/LLM sobre agregados (fase 2, ADR 0013) — diferido.
- Snapshot/materialização de métricas — mesmo YAGNI do S4 (decisão 9 lá).
- Toggle de granularidade (zona/bairro) nos alertas de área — só zona no
  MVP.
- Abas na UI — página única, seções empilhadas.
- Logout/sign-out — não existe ainda, fora de escopo desta fatia.
- Abrangência estadual — herdado do S4, sem campanha estadual real ainda.

## Schema / Funções

Nenhuma tabela, view materializada ou índice dedicado novo — índices de
apoio, se a implementação achar necessário, ficam a critério do plano.
Reusa `subarvore_count`, `pessoa_em_subarvore_do_actor`
e `mapa_calor_agregado` já existentes. Três funções novas, mesmo padrão
`SECURITY DEFINER SET search_path = ''` + `GRANT` só pra `authenticated`
lendo `auth.uid()` internamente (S4, decisão 11):

- `ranking_liderancas()` → retorna um único `jsonb`:
  `{ ramos: [{pessoa_id, nome, subarvore_count}, ...], soma_ramos: int,
  total_real: int }` — `jsonb` em vez de `TABLE` porque a nota
  (soma_ramos/total_real) é um resumo do conjunto inteiro, não uma coluna
  por linha; resolve escopo (líderes de topo vs subordinados diretos) a
  partir de `usuario_campanha.papel` do actor, igual ao padrão de
  `forca_por_area`. **`ramos` já vem ordenado pela função** conforme a
  decisão 4 (`subarvore_count DESC`, empate por nome `ASC`) — a API e o
  React só exibem, nunca reordenam.
- `evolucao_pessoas()` → `TABLE(dia date, total integer)`, 90 linhas
  (`generate_series` dos últimos 90 dias), escopo por sub-árvore/campanha
  igual ao ranking.
- `dashboard_alertas()` → `TABLE(tipo text, alvo_id text, label text,
  detalhe jsonb)` — une as 2 regras num só retorno, `tipo` diferencia
  `'area'` de `'lideranca_estagnada'`; `alvo_id` é o `area_id` (regra de
  área) ou `pessoa_id` (regra de liderança estagnada) conforme `tipo`.

Detalhamento exato de SQL (índices necessários, corpo de cada função) fica
pro plano de implementação — este spec fixa contrato e regra de negócio,
não o SQL literal.

## Camada Next.js

- `GET /api/dashboard/ranking`
- `GET /api/dashboard/evolucao`
- `GET /api/dashboard/alertas`

Mesmo padrão do `/api/mapa-calor`: `ssrClient(cookieStore)`, 401 sem
sessão, chama a RPC correspondente, retorna exatamente o payload que ela
produz — `/ranking` é um objeto (`{ramos, soma_ramos, total_real}`),
`/evolucao` e `/alertas` são arrays.

Página `/dashboard`: server component + checagem de sessão via `ssrClient`,
**sem redirect** (mesmo padrão de `/mapa-calor` — app ainda não tem página
de login). Componentes client: `RankingTable`, `EvolucaoChart` (Recharts,
linha, 90 pontos), `AlertasList`. Novo `NavShell` compartilhado entre
`/mapa-calor` e `/dashboard` (header com os 2 links).

## Testes (critério de pronto)

### Banco (via `execute_sql`, padrão S2/S3/S4)

1. Ranking geral (gestor/coordenador): retorna só líderes de topo
   (`responsavel_id IS NULL`), ordenado por `subarvore_count DESC`, empate
   por nome `ASC`.
2. Ranking liderança: retorna só subordinados diretos dela, mesma
   ordenação.
3. Nota soma≠total: cenário com apoiador compartilhado entre 2 ramos —
   `soma_ramos > total_real`, diferença bate com o número de compartilhados.
4. Evolução: pessoa criada e depois soft-deletada — ponto histórico antes
   da remoção ainda conta; ponto após não conta.
5. Evolução: escopo sub-árvore da liderança não inclui pessoa fora dela.
6. Alerta de área: zona com potencial > média das zonas E penetração <
   0.05 aparece; zona com penetração alta não aparece mesmo com potencial
   alto.
7. Alerta de liderança estagnada: líder com 35 dias de tenure e 0
   inserções em 30 dias aparece; líder com 10 dias de tenure não aparece
   mesmo sem inserção (falso-positivo evitado).
8. Isolamento entre campanhas: nenhuma das 3 RPCs vaza dado de outra
   campanha.
9. Spoofing bloqueado: confirmar que as 3 funções aceitam zero parâmetros
   de identidade (assinatura sem `actor_uid`/`uuid` de usuário) e resolvem
   o actor exclusivamente via `auth.uid()` interno — mesmo padrão do S4
   (teste 14 daquela fatia).
10. Coleção vazia sem erro: campanha nova sem líder/pessoa/alerta — as 3
    RPCs retornam vazio, não lançam exceção.

### Camada Next.js

11. 401 sem sessão nas 3 rotas.
12. 200 com payload válido (sessão válida de gestor de campanha).
13. Página `/dashboard` sem sessão não lança erro (mesmo padrão sem
    redirect do `/mapa-calor`).
