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
4. **Uma função só calcula os 3 números por área numa passada.**
   `mapa_calor_agregado(actor_uid, granularidade)` retorna
   `{area_id, area_nome, forca, potencial, penetracao, geo}` por linha — o
   frontend troca de camada (Força/Potencial/Penetração) sem novo fetch.
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
11. **Pré-requisito operacional, fora do escopo desta fatia:** o lote real de
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

Nenhuma tabela nova. Uma função:

### `mapa_calor_agregado(actor_uid uuid, granularidade text)`

```sql
CREATE OR REPLACE FUNCTION public.mapa_calor_agregado(
  actor_uid uuid,
  granularidade text
) RETURNS TABLE (
  area_id text,
  area_nome text,
  forca integer,
  potencial integer,
  penetracao numeric,
  geo extensions.geometry
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor_campanha_id uuid;
  actor_papel public.papel_login;
BEGIN
  SELECT campanha_id, papel INTO actor_campanha_id, actor_papel
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF actor_campanha_id IS NULL THEN RETURN; END IF;
  IF granularidade NOT IN ('zona', 'bairro') THEN
    RAISE EXCEPTION 'granularidade inválida: %', granularidade;
  END IF;

  RETURN QUERY
  WITH potencial_area AS (
    SELECT
      CASE WHEN granularidade = 'zona' THEN lv.zona_id::text
           ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
      CASE WHEN granularidade = 'zona' THEN ze.numero::text
           ELSE lv.bairro_nome_original END AS area_nome,
      sum(s.aptos) AS potencial,
      extensions.ST_Centroid(extensions.ST_Collect(lv.geo)) AS geo
    FROM public.local_votacao lv
    JOIN public.secao s ON s.local_id = lv.id
    JOIN public.zona_eleitoral ze ON ze.id = lv.zona_id
    WHERE lv.elegivel_calor = true
    GROUP BY 1, 2
  ),
  forca_area AS (
    SELECT
      CASE WHEN granularidade = 'zona' THEN lv.zona_id::text
           ELSE public.normalizar_texto(lv.bairro_nome_original) END AS area_id,
      count(p.id) AS forca
    FROM public.pessoa p
    JOIN public.secao s ON s.id = p.secao_id
    JOIN public.local_votacao lv ON lv.id = s.local_id
    WHERE p.campanha_id = actor_campanha_id
      AND p.deleted_at IS NULL
      AND (
        actor_papel IN ('gestor', 'coordenador')
        OR public.pessoa_em_subarvore_do_actor(actor_uid, p.id)
      )
    GROUP BY 1
  )
  SELECT
    pa.area_id, pa.area_nome,
    coalesce(fa.forca, 0)::integer,
    pa.potencial::integer,
    CASE WHEN pa.potencial > 0 THEN coalesce(fa.forca, 0)::numeric / pa.potencial ELSE NULL END,
    pa.geo
  FROM potencial_area pa
  LEFT JOIN forca_area fa ON fa.area_id = pa.area_id;
END;
$$;
REVOKE ALL ON FUNCTION public.mapa_calor_agregado(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mapa_calor_agregado(uuid, text) TO authenticated;
```

**Nota de performance:** `pessoa_em_subarvore_do_actor` roda uma vez por
`pessoa` candidata dentro do agregado (não uma vez só) — aceitável na escala
MVP (mesmo teto do S2, <10k nós), mesmo trade-off já documentado lá; upgrade
pra closure table beneficia os dois lugares ao mesmo tempo se um dia for
preciso.

**Potencial nunca filtra por sub-árvore** — `potencial_area` não depende de
`actor_uid` nem de `pessoa`; é dado oficial (S3), igual pra qualquer papel
que possa ver o mapa.

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
4. supabase.rpc('mapa_calor_agregado', { actor_uid: user.id, granularidade })
5. Retorna array de { area_id, area_nome, forca, potencial, penetracao, geo }
   (geo como GeoJSON via cast ST_AsGeoJSON no retorno, ou no client)
```

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
   não erro nem zero
6. **Granularidade zona vs bairro:** mesma pessoa/local aparece agrupado
   diferente conforme o parâmetro; `area_nome` bate (número da zona vs texto
   do bairro)
7. **`granularidade` inválida:** função lança exceção clara
8. **`get_advisors(security)`:** sem alerta novo além do WARN esperado
   (`mapa_calor_agregado` executável por `authenticated`, mesma categoria já
   aceita da `importacao_esta_publicada`)

### Camada Next.js

9. **401 sem sessão:** `GET /api/mapa-calor` sem cookie de sessão
10. **200 com dados reais:** sessão de gestor de uma campanha com dado real
    (Teresina, após geocode+publish manual) retorna array não-vazio
11. **Página redireciona sem sessão:** acessar `/mapa-calor` deslogado vai
    pro login
