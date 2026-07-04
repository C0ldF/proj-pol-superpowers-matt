-- 0044_ranking_liderancas.sql
--
-- Nota de correção (achada via verificação com fixture real, Task 1/S5):
-- o texto original do brief usava identificadores não qualificados
-- (`pessoa_id`, `subarvore_count`) dentro do corpo da função. Como esses
-- mesmos nomes são também os parâmetros OUT de RETURNS TABLE, o Postgres
-- reporta "column reference is ambiguous" (42702) ao tentar resolver:
--   1) `SELECT campanha_id, papel, pessoa_id INTO ... FROM
--      public.usuario_campanha` — pessoa_id colide com o OUT parameter;
--   2) dentro da CTE `totais`, `sum(subarvore_count)` e
--      `count(DISTINCT pessoa_id)` colidem da mesma forma.
-- Corrigido qualificando toda referência com o alias da tabela/CTE de
-- origem (`uc.pessoa_id`, `ramos.subarvore_count`, `sub.pessoa_id`).
CREATE OR REPLACE FUNCTION public.ranking_liderancas()
RETURNS TABLE (
  pessoa_id       uuid,
  nome            text,
  subarvore_count integer,
  soma_ramos      integer,
  total_real      integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id uuid;
  v_papel       public.papel_login;
  v_pessoa_id   uuid;
  v_topo        boolean;
BEGIN
  SELECT uc.campanha_id, uc.papel, uc.pessoa_id INTO v_campanha_id, v_papel, v_pessoa_id
    FROM public.usuario_campanha uc WHERE uc.user_id = auth.uid();
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  v_topo := v_papel IN ('gestor', 'coordenador');

  -- Recursão sobre vinculo é segura contra ciclo: trg_vinculo_ciclo_check
  -- (S2, migration 0017) bloqueia no INSERT qualquer vínculo que criaria um
  -- ciclo — mesma garantia da qual subarvore_count/pessoa_em_subarvore_do_actor
  -- (S2) já dependem sem checagem própria.
  RETURN QUERY
  WITH RECURSIVE ramos_raw AS (
    -- Gestor/coordenador: líderes de topo (vínculo próprio sem responsável
    -- acima). Liderança: só os subordinados diretos dela.
    SELECT DISTINCT ON (v.pessoa_id) v.pessoa_id, v.id AS vinculo_id
      FROM public.vinculo v
     WHERE v.campanha_id = v_campanha_id
       AND (
         (v_topo AND v.responsavel_id IS NULL)
         OR (NOT v_topo AND v.responsavel_id = v_pessoa_id)
       )
     ORDER BY v.pessoa_id, v.criado_em ASC
  ),
  ramos AS (
    -- Nota de performance: subarvore_count roda uma recursão própria POR
    -- ramo (não uma recursão só compartilhada entre todos) — mesmo
    -- trade-off já aceito em forca_por_area (S4) e evolucao_pessoas (Task
    -- 2) na escala MVP. Com centenas/milhares de líderes de topo, isso vira
    -- candidato natural de otimização (ex.: uma única passada recursiva
    -- calculando o tamanho de sub-árvore de todo mundo de uma vez, em vez
    -- de N chamadas independentes) — fora de escopo aqui.
    SELECT r.pessoa_id, p.nome, public.subarvore_count(r.vinculo_id) AS subarvore_count
      FROM ramos_raw r
      JOIN public.pessoa p ON p.id = r.pessoa_id
  ),
  sub AS (
    -- União recursiva de todos os descendentes de todos os ramos, dedupada
    -- por UNION (não UNION ALL) — base pro total_real. responsavel_id É
    -- pessoa_id (FK real: vinculo.responsavel_id uuid REFERENCES
    -- pessoa(id), supabase/migrations/0017_vinculo.sql linha 5) — não é o
    -- id de um outro vínculo, então o JOIN v2.responsavel_id = rr.pessoa_id
    -- compara a mesma entidade dos dois lados.
    SELECT v2.pessoa_id FROM public.vinculo v2
      JOIN ramos_raw rr ON v2.responsavel_id = rr.pessoa_id
     WHERE v2.campanha_id = v_campanha_id
    UNION
    SELECT v3.pessoa_id FROM public.vinculo v3
      JOIN sub ON sub.pessoa_id = v3.responsavel_id
     WHERE v3.campanha_id = v_campanha_id
  ),
  totais AS (
    SELECT
      coalesce((SELECT sum(ramos.subarvore_count) FROM ramos), 0)::integer AS soma_ramos,
      coalesce((SELECT count(DISTINCT sub.pessoa_id) FROM sub), 0)::integer AS total_real
  )
  SELECT ramos.pessoa_id, ramos.nome, ramos.subarvore_count,
         totais.soma_ramos, totais.total_real
    FROM ramos, totais
   ORDER BY ramos.subarvore_count DESC, ramos.nome ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.ranking_liderancas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ranking_liderancas() TO authenticated;
