# S4 — Mapa de calor

Data: 2026-07-03
Fatia do [roadmap](./2026-06-28-roadmap-decomposicao.md). Depende de S2
(Pessoa/Vínculo, secao_id, sub-árvore) e S3 (Ingestão TRE — local_votacao,
secao, elegivel_calor), ambos já mergeados na main.
ADRs cobertos: 0005 (abrangência), 0006 (mapa ancorado na seção, três
camadas), 0012 (MapLibre + OSM).

## Objetivo

Construir o mapa de calor eleitoral: agregação de Força (apoiadores meus),
Potencial (aptos do TRE) e Penetração (Força/Potencial) por área geográfica
(bairro ou zona eleitoral), respeitando a visibilidade por sub-árvore já
estabelecida no S2, renderizado numa página real (MapLibre GL + tiles OSM).
É a primeira tela autenticada do sistema além de login — hoje só existem
rotas de API e as páginas de auth.

## Decisões desta fatia

1. **Full-stack nesta fatia.** Agregação SQL + endpoint Next.js + página com
   mapa renderizando de verdade — não uma fatia só de backend sem nada pra
   mostrar.
2. **Só abrangência municipal por agora.** Todo dado real disponível (S3,
   Teresina) e as campanhas seed do S0 são municipais. Estadual (mapa por
   município + drill-down pra bairro/zona de uma cidade, ADR 0005) fica
   não-objetivo — entra quando houver uma campanha estadual real pra testar
   contra dado de múltiplos municípios.
3. **Duas granularidades, com toggle na tela: bairro e zona.** Zona usa
   `zona_id` (FK limpa desde o S3). Bairro usa
   `normalizar_texto(bairro_nome_original)` — não `bairro_oficial_id`, que
   ficou intencionalmente `NULL` em todo `local_votacao` real (decisão do S3:
   o CSV de locais de votação nunca casa bairro). Agregar pelo texto cru
   normalizado evita reabrir essa decisão; variações de grafia do mesmo
   bairro no CSV viram grupos separados — aceito como limitação conhecida do
   MVP, não bloqueia a fatia.
4. **Três funções, uma pública.** `potencial_por_area` e `forca_por_area`
   calculam cada métrica isoladamente (testáveis sozinhas via `execute_sql`,
   reusáveis por dashboards futuros); `mapa_calor_agregado` — a única
   `GRANT`ada pra `authenticated` — só junta as duas e calcula Penetração.
   Mesmo padrão de composição de funções `SECURITY DEFINER` pequenas já usado
   no S2. Retorna `{area_id, area_nome, forca, potencial, penetracao,
   ponto_geojson}` por linha, ordenado por `area_nome` (saída determinística)
   — o frontend troca de camada (Força/Potencial/Penetração) sem novo fetch.
5. **Potencial** = soma de `secao.aptos` de locais com `elegivel_calor=true`
   (regra 1 do ADR 0011, herdada do S3), agrupado pela granularidade.
6. **Força** = contagem de `pessoa` com `secao_id` preenchido na mesma área
   — **qualquer papel_vinculo** (liderança conta como eleitor também, não só
   quem tem papel `apoiador`), não só a base cadastrada.
7. **Penetração** = `forca / potencial`; `NULL` (não zero, não erro) quando
   `potencial = 0` na área — "sem dado" em vez de número enganoso.
8. **Visibilidade por sub-árvore, mesma regra do S2 (ADR 0004).** `gestor` e
   `coordenador` veem a Força agregada da campanha inteira; qualquer outro
   papel só conta, na contagem de Força, quem está na própria sub-árvore
   (reusa `pessoa_em_subarvore_do_actor`, já existe desde o S2). Potencial
   nunca é filtrado por sub-árvore — é dado oficial do TRE, sempre o mesmo
   pra todo mundo que pode ver o mapa.
9. **Sem cache/materialização.** Query live a cada request — campanhas MVP
   (<10k pessoas, mesmo teto assumido no S2) tornam isso viável sem
   complexidade extra; upgrade pra materialização é incremental se algum dia
   for preciso.
10. **`mapa_calor_agregado` é `SECURITY DEFINER` com `GRANT EXECUTE TO
    authenticated`** (não `REVOKE`, ao contrário da maioria das funções do
    S3) — precisa ser chamada pelo próprio usuário logado via `ssrClient`,
    não por um script server-side com `service_role`. Mesma categoria de
    exceção documentada da `importacao_esta_publicada` (S3, Task 7): a
    função em si bypassa RLS internamente (pra poder ler `pessoa` fora da
    sub-árvore quando o papel permite), mas quem a invoca precisa ser
    `authenticated`.
11. **A função pública lê `auth.uid()` internamente, não recebe identidade
    como parâmetro.** Diferença importante da `importacao_esta_publicada`: lá
    não há personalização por usuário (só um fato público — lote publicado
    ou não), então receber um id como parâmetro não abre brecha. Aqui a
    visibilidade de Força É personalizada por quem chama — se
    `mapa_calor_agregado` recebesse `actor_uid` como argumento, qualquer
    cliente autenticado poderia chamar a RPC diretamente (PostgREST expõe
    toda função `GRANT`ada pra `authenticated` em `/rest/v1/rpc/...`, não só
    via a rota Next.js) passando o `uuid` de outra pessoa e ler a Força de
    outra campanha. Só a função pública lê `auth.uid()`; as duas funções
    internas (`potencial_por_area`/`forca_por_area`) continuam `REVOKE`d de
    `authenticated` — nunca chamáveis direto — e por isso podem manter
    `actor_uid` como parâmetro explícito sem risco, o que as deixa testáveis
    por impersonation via `execute_sql` como as funções do S2.
12. **Pré-requisito operacional, fora do escopo desta fatia:** o lote real de
    Teresina (S3) está em `pendente_revisao`, sem `tre:geocode` nem
    `tre:publicar` rodados — o mapa fica sem pontos até o Superadmin rodar
    essas duas fases (scripts já existem, prontos, do S3). Não é trabalho do
    S4, só uma nota operacional antes de qualquer demo.

## Não-objetivos

- Abrangência estadual (mapa por município + drill-down) — roadmap, quando
  houver campanha estadual real.
- Mapa de concentração de apoiadores por CEP residencial — `pessoa` não tem
  endereço estruturado (só `secao_id` desde o S2); ADR 0006 já decidiu que o
  calor eleitoral é ancorado por seção, não por CEP residencial — CEP serve
  só a um futuro "mapa de colaboradores" (contato), fora do calor. Fica pra
  fatia própria se/quando o schema de endereço em Pessoa for construído.
- "Voto por local" (resultado eleitoral por local de votação) — sem fonte de
  dado nem ADR; o CSV do TRE (S3) é cadastro, não boletim de urna.
- Cache/materialização de agregados — YAGNI no MVP (decisão 9).
- Dashboard/chrome de navegação maior — a página `/mapa-calor` é isolada,
  sem shell de app ao redor; um layout autenticado mais amplo é trabalho de
  outra fatia.
- Reconciliar variações de grafia do mesmo bairro no agrupamento por texto
  (decisão 3) — aceito como limitação conhecida, não resolvido aqui.

## Schema / Funções

Nenhuma tabela nova. Um enum + três funções.

### Enum `granularidade_calor_enum`

Substitui `text` + validação manual — inválido vira erro de cast do próprio
Postgres, sem `IF`/`RAISE` no corpo das funções:

```sql
CREATE TYPE public.granularidade_calor_enum AS ENUM ('zona', 'bairro');
```

### `potencial_por_area(p_granularidade)` — interna

```sql
CREATE OR REPLACE FUNCTION public.potencial_por_area(
  p_granularidade public.granularidade_calor_enum
) RETURNS TABLE (
  area_id text,
  area_nome text,
  potencial integer,
  ponto_geojson jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    CASE WHEN p_granularidade = 'zona' THEN lv.zona_id::text
         ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
    CASE WHEN p_granularidade = 'zona' THEN min(ze.numero)::text
         ELSE initcap(min(lv.bairro_nome_original)) END AS area_nome,
    sum(s.aptos)::integer AS potencial,
    -- ST_GeometricMedian, não ST_Centroid nem ST_PointOnSurface(ST_ConvexHull):
    -- centroide puro pode cair fora da área real (rio, vazio) se os locais
    -- estiverem espalhados/em duas regiões; o casco convexo resolve isso mas
    -- pode "inflar" a área e ainda assim pousar longe de qualquer local real
    -- (ex.: 3 locais formando um triângulo grande). Mediana geométrica
    -- minimiza a distância total até os locais reais — tende a cair dentro
    -- de um agrupamento de verdade, robusta a outlier isolado.
    extensions.ST_AsGeoJSON(
      extensions.ST_GeometricMedian(extensions.ST_Collect(lv.geo))
    )::jsonb AS ponto_geojson
  FROM public.local_votacao lv
  JOIN public.secao s ON s.local_id = lv.id
  JOIN public.zona_eleitoral ze ON ze.id = lv.zona_id
  WHERE lv.elegivel_calor = true
  GROUP BY 1;
$$;
REVOKE ALL ON FUNCTION public.potencial_por_area(public.granularidade_calor_enum) FROM public, authenticated, anon;
```

**`area_id` de bairro não é estável entre importações.** É
`normalizar_texto(bairro_nome_original)` — texto cru do CSV, não uma FK. Se
o TRE mudar a grafia de um bairro num ano seguinte ("Vila Operária" →
"Vila Operaria"), o `area_id` muda junto. Não afeta esta fatia (sem
cache/URL/favorito dependendo de `area_id` hoje), mas é uma limitação a
lembrar se algo depender desse id no futuro (analytics, links diretos).

**`area_nome` de bairro é estabilizado com `initcap(min(...))`.** O
agrupamento por `area_id` (via `normalizar_texto`) já junta "Centro" e
"CENTRO" corretamente numa linha só — mas sem tratamento, o texto exibido
seria o que a agregação escolhesse arbitrariamente (podendo variar entre
execuções conforme o plano de query). `min()` escolhe uma variante de forma
determinística; `initcap()` uniformiza a capitalização por cima disso, então
o resultado é sempre "Centro", nunca "CENTRO", independente de qual
variante o `min()` pegou.

### `forca_por_area(p_granularidade, p_actor_uid)` — interna

```sql
CREATE OR REPLACE FUNCTION public.forca_por_area(
  p_granularidade public.granularidade_calor_enum,
  p_actor_uid uuid
) RETURNS TABLE (
  area_id text,
  forca integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel public.papel_login;
BEGIN
  SELECT campanha_id, papel INTO v_campanha_id, v_papel
    FROM public.usuario_campanha WHERE user_id = p_actor_uid;
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    CASE WHEN p_granularidade = 'zona' THEN lv.zona_id::text
         ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
    count(p.id)::integer AS forca
  FROM public.pessoa p
  JOIN public.secao s ON s.id = p.secao_id
  JOIN public.local_votacao lv ON lv.id = s.local_id
  WHERE p.campanha_id = v_campanha_id
    AND p.deleted_at IS NULL
    AND (
      v_papel IN ('gestor', 'coordenador')
      OR public.pessoa_em_subarvore_do_actor(p_actor_uid, p.id)
    )
  GROUP BY 1;
END;
$$;
REVOKE ALL ON FUNCTION public.forca_por_area(public.granularidade_calor_enum, uuid) FROM public, authenticated, anon;
```

`REVOKE ... FROM authenticated` nas duas funções internas não impede
`mapa_calor_agregado` (abaixo) de chamá-las: `SECURITY DEFINER` eleva o
papel efetivo pra durante a execução, e chamadas aninhadas dentro dessa
execução são checadas contra esse papel elevado, não contra quem originou a
requisição — mesmo padrão já usado no S2 (funções `SECURITY DEFINER`
chamando outras). Só a função pública abaixo precisa estar acessível de
fora.

**Nota de performance:** `pessoa_em_subarvore_do_actor` roda uma vez por
`pessoa` candidata dentro do agregado (não uma vez só) — aceitável na escala
MVP (mesmo teto do S2, <10k nós), mesmo trade-off já documentado lá. Se um
dia migrar pra closure table, troca só o corpo desta função — a assinatura
pública (`mapa_calor_agregado`) não muda.

**Potencial nunca filtra por sub-árvore** — `potencial_por_area` não recebe
identidade nem toca `pessoa`; é dado oficial (S3), igual pra qualquer papel
que possa ver o mapa.

### `mapa_calor_agregado(granularidade)` — pública, a única exposta

```sql
CREATE OR REPLACE FUNCTION public.mapa_calor_agregado(
  granularidade public.granularidade_calor_enum
) RETURNS TABLE (
  area_id text,
  area_nome text,
  forca integer,
  potencial integer,
  penetracao numeric,
  ponto_geojson jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Só GRANT'ada pra authenticated (que sempre carrega um JWT válido), então
  -- auth.uid() NULL não deveria acontecer na prática — mas retorna vazio em
  -- vez de assumir, mesmo padrão de defesa do "sem campanha_id" abaixo.
  IF auth.uid() IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    pa.area_id, pa.area_nome,
    coalesce(fa.forca, 0),
    pa.potencial,
    CASE WHEN pa.potencial > 0
         THEN round(coalesce(fa.forca, 0)::numeric / pa.potencial, 4)
         ELSE NULL END,
    pa.ponto_geojson
  FROM public.potencial_por_area(granularidade) pa
  LEFT JOIN public.forca_por_area(granularidade, auth.uid()) fa ON fa.area_id = pa.area_id
  ORDER BY pa.area_nome;
END;
$$;
REVOKE ALL ON FUNCTION public.mapa_calor_agregado(public.granularidade_calor_enum) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mapa_calor_agregado(public.granularidade_calor_enum) TO authenticated;
```

`auth.uid()` (não um parâmetro) identifica quem está chamando — ver decisão
11. `round(..., 4)` fixa a precisão da Penetração (evita divergência de
representação entre Postgres/JSON/JS). `ORDER BY area_nome` torna a saída
determinística — sem isso o frontend recebe ordem arbitrária a cada request.

**Penetração normalmente cai em `[0, 1]`, mas isso não é garantido pelo
schema** — é a expectativa (Força é, na prática, um subconjunto do
Potencial), não um contrato. Nada impede um valor `> 1` com dado anômalo ou
de teste (ex.: staff da campanha cadastrado com `secao_id` de uma área onde
o TRE registra menos aptos que o esperado). O frontend não deve tratar
`penetracao > 1` como erro.

**Duas passagens completas da tabela (`potencial_por_area` e
`forca_por_area` cada uma faz seu próprio scan/agrupamento, unidas depois
por `LEFT JOIN`) em vez de uma única query combinada.** Escolha deliberada
de legibilidade sobre performance — na escala MVP (334 linhas reais) o custo
é irrelevante; combinar os dois em uma CTE só economizaria um scan às custas
de uma função bem maior e menos testável isoladamente.

### Índices

Já cobertos desde o S3, reaproveitados sem mudança: `secao_local_idx` (join
`secao→local_votacao`), PK de `secao`/`local_votacao` (joins via id).
Genuinamente novo pra este padrão de query: nenhum índice tem `zona_id` como
coluna líder de `local_votacao` hoje (só aparece como 2ª coluna da unique
`(importacao_id, zona_id, num_local)`, inútil pra `GROUP BY zona_id`
isolado) — adicionar:

```sql
CREATE INDEX local_votacao_zona_idx ON public.local_votacao (zona_id);
```

Deferido, não necessário nesta escala (334 linhas reais, Teresina): índice
parcial em `elegivel_calor` e composto em `pessoa(campanha_id, secao_id)` —
seriam otimização prematura num MVP deste tamanho; revisitar se/quando o
volume de dados justificar.

## RLS / Segurança

Nenhuma policy nova — a função já encapsula toda a lógica de visibilidade
internamente (é a mesma abordagem do S2: gate fica na função
`SECURITY DEFINER`, não em RLS de tabela). `local_votacao`/`secao` continuam
com a RLS do S3 (só visíveis via a própria função, que roda com privilégio
elevado — a leitura RLS normal dessas tabelas por `authenticated` já exige
`status='publicado'`, que é o estado que o lote precisa estar pra aparecer
aqui de qualquer forma).

## Camada Next.js

### `GET /api/mapa-calor?granularidade=zona|bairro`

```
1. ssrClient(cookieStore) — sessão do usuário logado
2. Se não autenticado → 401
3. Valida `granularidade` ∈ {zona, bairro} (default: zona)
4. supabase.rpc('mapa_calor_agregado', { granularidade })
   — sem actor_uid: auth.uid() resolve sozinho a partir da sessão do ssrClient
5. Retorna array de { area_id, area_nome, forca, potencial, penetracao, ponto_geojson }
   — ponto_geojson já pronto (function retorna jsonb), rota não toca PostGIS
```

**Contrato da resposta** (um elemento do array por área):

```json
{
  "area_id": "3b7f...-zona-uuid",
  "area_nome": "12",
  "forca": 125,
  "potencial": 3200,
  "penetracao": 0.0391,
  "ponto_geojson": {
    "type": "Point",
    "coordinates": [-42.8034, -5.0892]
  }
}
```

`ponto_geojson` é sempre um `Point` — nunca um `Polygon`/`MultiPolygon` (daí
o nome `ponto_`, não `geojson` genérico: é a mediana geométrica dos locais
da área, um marcador, não o contorno da área). `penetracao` pode ser `null`
(área sem potencial) — ver seção anterior.

### Página `/mapa-calor`

Server component: checa sessão via `ssrClient`, redireciona pro login se
ausente (mesmo padrão de `/redefinir-senha`). Client component: MapLibre GL
+ tiles OSM (ADR 0012), busca `/api/mapa-calor`, plota um ponto/círculo por
área na cor da camada selecionada (seletor Força/Potencial/Penetração),
toggle bairro/zona (novo fetch ao trocar), popup ao clicar num ponto com os
3 números. Sem chrome de navegação além do necessário — página isolada.

## Testes (critério de pronto)

### Banco (via `execute_sql`, como S2/S3)

1. **Potencial correto:** local `elegivel_calor=false` não entra na soma;
   `elegivel_calor=true` entra
2. **Força correto:** pessoa sem `secao_id` não conta; pessoa com
   `secao_id` de outra campanha não conta (`campanha_id` filtra)
3. **Visibilidade — gestor:** vê Força de pessoas fora da própria sub-árvore
4. **Visibilidade — liderança:** só conta Força da própria sub-árvore (reusa
   cenário de teste do S2: Liderança A não vê sub-árvore de Liderança B —
   aqui, não CONTA na soma)
5. **Penetração NULL:** área com potencial=0 retorna `penetracao IS NULL`,
   não erro nem zero; **Penetração arredondada:** resultado tem no máximo 4
   casas decimais
6. **Granularidade zona vs bairro:** mesma pessoa/local aparece agrupado
   diferente conforme o parâmetro; `area_nome` bate (número da zona vs texto
   do bairro)
7. **`granularidade` inválida:** cast pro enum falha com erro claro do
   Postgres (não precisa de `RAISE` manual — o tipo já garante isso)
8. **`get_advisors(security)`:** sem alerta novo além do WARN esperado
   (`mapa_calor_agregado` executável por `authenticated`, mesma categoria já
   aceita da `importacao_esta_publicada`)
9. **Área sem geometria:** todos os locais de uma área com `geo IS NULL`
   (nenhum geocodificado ainda) → `ponto_geojson IS NULL` pra essa área, sem
   erro
10. **Campanha sem nenhuma pessoa:** `forca_por_area` retorna vazio;
    `mapa_calor_agregado` ainda retorna as áreas (via `potencial_por_area`)
    com `forca=0` — confirma que o `LEFT JOIN` não faz a área inteira sumir
11. **Campanha/lote sem locais elegíveis:** `potencial_por_area` vazio →
    função retorna 0 linhas (não erro)
12. **Isolamento entre campanhas:** duas campanhas com pessoas apontando pra
    seções dos mesmos locais (dado do TRE é global, não por campanha) — Força
    de uma nunca aparece na agregação da outra
13. **Usuário sem `usuario_campanha`:** chama a função autenticado mas sem
    vínculo de login algum → retorna vazio, não erro (mesmo branch de
    `v_campanha_id IS NULL`)
14. **Spoofing bloqueado:** não é possível verificar via SQL puro que a RPC
    pública ignora um `actor_uid` externo (ela não recebe esse parâmetro mais
    — a prova é estrutural: a assinatura de `mapa_calor_agregado` não tem
    esse argumento). Confirmar isso lendo a assinatura da função aplicada,
    não com um teste de comportamento.

### Camada Next.js

15. **401 sem sessão:** `GET /api/mapa-calor` sem cookie de sessão
16. **200 com dados reais:** sessão de gestor de uma campanha com dado real
    (Teresina, após geocode+publish manual) retorna array não-vazio
17. **Página redireciona sem sessão:** acessar `/mapa-calor` deslogado vai
    pro login
