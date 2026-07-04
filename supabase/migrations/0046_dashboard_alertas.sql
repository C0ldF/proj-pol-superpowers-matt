-- 0046_dashboard_alertas.sql

-- Interna: alerta de área. Só chamada pela pública abaixo, quando o papel
-- do actor qualifica (gestor/coordenador) — a checagem de papel mora na
-- função pública, não aqui, porque esta função sozinha não sabe "pra quem"
-- ela está rodando de forma independente de auth.uid() (mapa_calor_agregado
-- já é auth.uid()-only, então esta função herda a mesma restrição).
CREATE OR REPLACE FUNCTION public.dashboard_alertas_area()
RETURNS TABLE (alvo_id text, label text, detalhe jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  -- LANGUAGE sql não tem DECLARE — o limiar nomeado vira uma CTE de 1 linha
  -- em vez de constante plpgsql (mesmo espírito de v_dias_tenure_minimo /
  -- v_dias_janela_estagnacao em dashboard_alertas_lideranca: nomeado, não
  -- mágico solto no WHERE). Continua hardcoded por YAGNI (decisão 6 do
  -- spec, sem motor de regra configurável nesta fatia) — só a leitura muda.
  WITH parametros AS (
    SELECT 0.05::numeric AS limiar_penetracao
  ),
  areas AS (
    SELECT * FROM public.mapa_calor_agregado('zona')
  ),
  media AS (
    SELECT avg(potencial) AS media_potencial FROM areas
  )
  SELECT a.area_id, a.area_nome,
    jsonb_build_object(
      'potencial', a.potencial,
      'penetracao', a.penetracao,
      'media_potencial', round(m.media_potencial, 2)
    )
  FROM areas a, media m, parametros p
  WHERE a.potencial > m.media_potencial AND a.penetracao < p.limiar_penetracao;
$$;
REVOKE ALL ON FUNCTION public.dashboard_alertas_area() FROM public, authenticated, anon;

-- Interna: alerta de liderança estagnada. Recebe p_actor_uid explícito —
-- não depende de nenhuma função auth.uid()-only, então é diretamente
-- testável via execute_sql sem simular sessão (mesmo padrão do
-- forca_por_area, S4).
CREATE OR REPLACE FUNCTION public.dashboard_alertas_lideranca(p_actor_uid uuid)
RETURNS TABLE (alvo_id text, label text, detalhe jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_campanha_id             uuid;
  v_papel                   public.papel_login;
  v_pessoa_id               uuid;
  v_dias_tenure_minimo      constant integer := 30;
  v_dias_janela_estagnacao  constant integer := 30;
BEGIN
  SELECT uc.campanha_id, uc.papel, uc.pessoa_id INTO v_campanha_id, v_papel, v_pessoa_id
    FROM public.usuario_campanha uc WHERE uc.user_id = p_actor_uid;
  IF v_campanha_id IS NULL THEN RETURN; END IF;

  -- Recursão sobre vinculo é segura contra ciclo: trg_vinculo_ciclo_check
  -- (S2, migration 0017) bloqueia no INSERT qualquer vínculo que criaria um
  -- ciclo — mesma garantia já usada sem checagem própria em subarvore_count.
  --
  -- Visibilidade e "lider_desde" são calculados em 2 passos separados, não
  -- num só DISTINCT ON: uma pessoa pode ter MAIS DE UM vínculo como
  -- pessoa_id (ADR 0004 — "mesma pessoa comanda um ramo e é base em
  -- outro"), ex. Líder X reporta a CoordA (vínculo de dia 1) e TAMBÉM
  -- reporta à Liderança atual (vínculo de dia 10). Um DISTINCT ON
  -- (pessoa_id) ORDER BY criado_em ASC ficaria só com o vínculo do dia 1
  -- (sob CoordA) e o teste `v.responsavel_id = v_pessoa_id` nunca veria a
  -- relação com a Liderança atual — ela deixaria de ver um subordinado
  -- direto de verdade. Por isso a visibilidade usa EXISTS sobre TODOS os
  -- vínculos do candidato, não só o mais antigo.
  RETURN QUERY
  WITH candidatos AS (
    SELECT DISTINCT responsavel_id AS pessoa_id
      FROM public.vinculo
     WHERE campanha_id = v_campanha_id AND responsavel_id IS NOT NULL
  ),
  lideres AS (
    SELECT c.pessoa_id,
      (SELECT min(v.criado_em) FROM public.vinculo v
        WHERE v.pessoa_id = c.pessoa_id AND v.campanha_id = v_campanha_id) AS lider_desde
      FROM candidatos c
     WHERE v_papel IN ('gestor', 'coordenador')
        OR c.pessoa_id = v_pessoa_id
        OR EXISTS (
             SELECT 1 FROM public.vinculo v
              WHERE v.pessoa_id = c.pessoa_id
                AND v.responsavel_id = v_pessoa_id
                AND v.campanha_id = v_campanha_id
           )
  )
  SELECT l.pessoa_id::text, p.nome,
    jsonb_build_object('lider_desde', l.lider_desde)
  FROM lideres l
  JOIN public.pessoa p ON p.id = l.pessoa_id
  WHERE l.lider_desde::date <= CURRENT_DATE - v_dias_tenure_minimo
    AND NOT EXISTS (
      WITH RECURSIVE sub AS (
        SELECT v2.pessoa_id FROM public.vinculo v2
         WHERE v2.responsavel_id = l.pessoa_id AND v2.campanha_id = v_campanha_id
        UNION
        SELECT v3.pessoa_id FROM public.vinculo v3
          JOIN sub ON sub.pessoa_id = v3.responsavel_id
         WHERE v3.campanha_id = v_campanha_id
      )
      SELECT 1 FROM public.pessoa pd
       WHERE pd.id IN (SELECT pessoa_id FROM sub)
         AND pd.criado_em::date >= CURRENT_DATE - v_dias_janela_estagnacao
    );
END;
$$;
REVOKE ALL ON FUNCTION public.dashboard_alertas_lideranca(uuid) FROM public, authenticated, anon;

-- Pública: única GRANT'ada, lê auth.uid() uma vez e compõe as 2 internas —
-- mesmo padrão de composição do mapa_calor_agregado (S4).
CREATE OR REPLACE FUNCTION public.dashboard_alertas()
RETURNS TABLE (tipo text, alvo_id text, label text, detalhe jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_papel public.papel_login;
BEGIN
  SELECT papel INTO v_papel FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF v_papel IS NULL THEN RETURN; END IF;

  -- Alerta de área: só gestor/coordenador (não é conceito de sub-árvore).
  IF v_papel IN ('gestor', 'coordenador') THEN
    RETURN QUERY
    SELECT 'area'::text, a.alvo_id, a.label, a.detalhe
      FROM public.dashboard_alertas_area() a;
  END IF;

  RETURN QUERY
  SELECT 'lideranca_estagnada'::text, l.alvo_id, l.label, l.detalhe
    FROM public.dashboard_alertas_lideranca(auth.uid()) l;
END;
$$;
REVOKE ALL ON FUNCTION public.dashboard_alertas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_alertas() TO authenticated;
