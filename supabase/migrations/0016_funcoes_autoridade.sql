-- Forward references: vinculo table is created in Task 6 (migration 0017).
-- SQL-language functions validate their bodies at creation time, so we disable
-- that check here. PL/pgSQL functions already defer resolution to execution time.
SET LOCAL check_function_bodies = off;

-- ============================================================
-- 1. actor_papel_base — lê papel do JWT (gate grosso)
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_papel_base(actor_uid uuid)
RETURNS public.papel_login
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT papel FROM public.usuario_campanha WHERE user_id = actor_uid LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.actor_papel_base(uuid) FROM public, authenticated, anon;

-- ============================================================
-- 2. pessoa_em_subarvore_do_actor — recursive CTE de sub-árvore
-- ============================================================
CREATE OR REPLACE FUNCTION public.pessoa_em_subarvore_do_actor(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor_campanha_id uuid;
BEGIN
  SELECT campanha_id INTO actor_campanha_id
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF actor_campanha_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    WITH RECURSIVE sub AS (
      SELECT v.pessoa_id
        FROM public.vinculo v
        JOIN public.usuario_campanha uc ON uc.pessoa_id = v.responsavel_id
       WHERE uc.user_id = actor_uid AND v.campanha_id = actor_campanha_id
      UNION ALL
      SELECT v2.pessoa_id
        FROM public.vinculo v2
        JOIN sub ON sub.pessoa_id = v2.responsavel_id
       WHERE v2.campanha_id = actor_campanha_id
    )
    SELECT 1 FROM sub WHERE pessoa_id = target_pessoa_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.pessoa_em_subarvore_do_actor(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 3. actor_pode_ver_pessoa
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_ver_pessoa(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p public.papel_login;
  actor_camp uuid;
  target_camp uuid;
BEGIN
  SELECT papel, campanha_id INTO p, actor_camp
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF p IS NULL THEN RETURN false; END IF;

  SELECT campanha_id INTO target_camp FROM public.pessoa WHERE id = target_pessoa_id;
  IF target_camp IS DISTINCT FROM actor_camp THEN RETURN false; END IF;

  IF p IN ('gestor', 'colaborador') THEN RETURN true; END IF;
  RETURN public.pessoa_em_subarvore_do_actor(actor_uid, target_pessoa_id);
END;
$$;
REVOKE ALL ON FUNCTION public.actor_pode_ver_pessoa(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 4. actor_pode_editar_pessoa
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_editar_pessoa(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.actor_pode_ver_pessoa(actor_uid, target_pessoa_id);
$$;
REVOKE ALL ON FUNCTION public.actor_pode_editar_pessoa(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 5. actor_pode_criar_vinculo_sob
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_criar_vinculo_sob(
  actor_uid          uuid,
  responsavel_id     uuid,
  novo_papel         public.papel_vinculo
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p         public.papel_login;
  actor_camp uuid;
  resp_camp  uuid;
  actor_pess uuid;
BEGIN
  SELECT papel, campanha_id, pessoa_id INTO p, actor_camp, actor_pess
    FROM public.usuario_campanha WHERE user_id = auth.uid();
  IF p IS NULL OR p = 'colaborador' THEN RETURN false; END IF;

  SELECT campanha_id INTO resp_camp FROM public.pessoa WHERE id = responsavel_id;
  IF resp_camp IS DISTINCT FROM actor_camp THEN RETURN false; END IF;

  IF p = 'gestor' THEN RETURN true; END IF;

  IF p = 'coordenador' THEN
    RETURN responsavel_id = actor_pess
        OR public.pessoa_em_subarvore_do_actor(auth.uid(), responsavel_id);
  END IF;

  -- liderança: só apoiador sob si mesma
  IF p = 'lideranca' THEN
    RETURN novo_papel = 'apoiador' AND responsavel_id = actor_pess;
  END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.actor_pode_criar_vinculo_sob(uuid, uuid, public.papel_vinculo) FROM public, authenticated, anon;

-- ============================================================
-- 6. actor_e_primeiro_registrante
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_e_primeiro_registrante(
  actor_uid        uuid,
  target_pessoa_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT criado_por = actor_uid
    FROM public.vinculo
   WHERE pessoa_id = target_pessoa_id
     AND campanha_id = (SELECT campanha_id FROM public.usuario_campanha WHERE user_id = actor_uid)
   ORDER BY criado_em ASC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.actor_e_primeiro_registrante(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 7. actor_pode_remover_vinculo
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_remover_vinculo(
  actor_uid         uuid,
  target_vinculo_id uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p          public.papel_login;
  actor_camp uuid;
  actor_pess uuid;
  v          record;
BEGIN
  SELECT papel, campanha_id, pessoa_id INTO p, actor_camp, actor_pess
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF p IS NULL THEN RETURN false; END IF;

  SELECT pessoa_id, responsavel_id, campanha_id INTO v
    FROM public.vinculo WHERE id = target_vinculo_id;
  IF NOT FOUND OR v.campanha_id IS DISTINCT FROM actor_camp THEN RETURN false; END IF;

  IF p = 'gestor' THEN RETURN true; END IF;
  IF public.actor_e_primeiro_registrante(actor_uid, v.pessoa_id) THEN RETURN true; END IF;
  IF p = 'coordenador' THEN RETURN public.actor_pode_ver_pessoa(actor_uid, v.pessoa_id); END IF;
  IF p = 'lideranca' THEN RETURN v.responsavel_id = actor_pess; END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.actor_pode_remover_vinculo(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 8. buscar_pessoa_duplicada — cross-sub-árvore, título → CPF
-- ============================================================
CREATE OR REPLACE FUNCTION public.buscar_pessoa_duplicada(
  p_campanha_id uuid,
  p_titulo_hmac text,
  p_cpf_hmac    text
) RETURNS SETOF public.pessoa
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r public.pessoa%ROWTYPE;
BEGIN
  IF p_titulo_hmac IS NOT NULL THEN
    SELECT * INTO r FROM public.pessoa
     WHERE campanha_id = p_campanha_id AND titulo_hmac = p_titulo_hmac AND deleted_at IS NULL LIMIT 1;
    IF FOUND THEN RETURN NEXT r; RETURN; END IF;
  END IF;
  IF p_cpf_hmac IS NOT NULL THEN
    SELECT * INTO r FROM public.pessoa
     WHERE campanha_id = p_campanha_id AND cpf_hmac = p_cpf_hmac AND deleted_at IS NULL LIMIT 1;
    IF FOUND THEN RETURN NEXT r; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.buscar_pessoa_duplicada(uuid, text, text) FROM public, authenticated, anon;

-- ============================================================
-- 9. subarvore_count — contagem de descendentes (dry-run)
-- ============================================================
CREATE OR REPLACE FUNCTION public.subarvore_count(p_vinculo_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; result integer;
BEGIN
  SELECT pessoa_id, campanha_id INTO v FROM public.vinculo WHERE id = p_vinculo_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  WITH RECURSIVE sub AS (
    SELECT cv.pessoa_id FROM public.vinculo cv
     WHERE cv.responsavel_id = v.pessoa_id AND cv.campanha_id = v.campanha_id
    UNION ALL
    SELECT cv2.pessoa_id FROM public.vinculo cv2 JOIN sub ON sub.pessoa_id = cv2.responsavel_id
     WHERE cv2.campanha_id = v.campanha_id
  )
  SELECT count(*)::integer INTO result FROM sub;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.subarvore_count(uuid) FROM public, authenticated, anon;

-- ============================================================
-- 10. realocar_subarvore — move filhos diretos para novo_responsavel
-- ============================================================
CREATE OR REPLACE FUNCTION public.realocar_subarvore(
  p_vinculo_id        uuid,
  p_novo_responsavel_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; n integer;
BEGIN
  SELECT pessoa_id, responsavel_id, campanha_id INTO v
    FROM public.vinculo WHERE id = p_vinculo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'vínculo não encontrado: %', p_vinculo_id; END IF;

  UPDATE public.vinculo
     SET responsavel_id = p_novo_responsavel_id
   WHERE responsavel_id = v.pessoa_id AND campanha_id = v.campanha_id AND id != p_vinculo_id;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.audit_entity (campanha_id, tabela, entidade_id, antes, depois)
  VALUES (
    v.campanha_id, 'vinculo', p_vinculo_id,
    jsonb_build_object('responsavel_id', v.responsavel_id, 'filhos_realocados', n),
    jsonb_build_object('novo_responsavel_id', p_novo_responsavel_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.realocar_subarvore(uuid, uuid) FROM public, authenticated, anon;

-- ============================================================
-- 11. criar_pessoa_com_vinculo — atômico: INSERT pessoa + vínculo
-- ============================================================
CREATE OR REPLACE FUNCTION public.criar_pessoa_com_vinculo(
  p_campanha_id       uuid,
  p_nome              text,
  p_titulo_hmac       text,
  p_titulo_enc        text,
  p_cpf_hmac          text,
  p_telefone          text,
  p_email_contato     text,
  p_base_legal        public.base_legal_enum,
  p_origem_coleta     public.origem_coleta_enum,
  p_responsavel_id    uuid,
  p_papel             public.papel_vinculo,
  p_criado_por        uuid,
  p_pessoa_id_existente uuid,  -- NULL = cria nova Pessoa; não-null = usa existente (compartilhado)
  p_actor_ip          inet,
  p_actor_ua          text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  nova_pessoa_id uuid;
  novo_vinculo_id uuid;
BEGIN
  IF p_pessoa_id_existente IS NOT NULL THEN
    nova_pessoa_id := p_pessoa_id_existente;
  ELSE
    INSERT INTO public.pessoa (
      campanha_id, nome, titulo_hmac, titulo_enc, cpf_hmac,
      telefone, email_contato, base_legal, origem_coleta
    ) VALUES (
      p_campanha_id, p_nome, p_titulo_hmac, p_titulo_enc, p_cpf_hmac,
      p_telefone, p_email_contato, p_base_legal, p_origem_coleta
    ) RETURNING id INTO nova_pessoa_id;

    INSERT INTO public.audit_entity (
      campanha_id, tabela, entidade_id, depois, actor_user_id, ip, user_agent
    ) VALUES (
      p_campanha_id, 'pessoa', nova_pessoa_id,
      jsonb_build_object('nome', p_nome, 'origem', p_origem_coleta),
      p_criado_por, p_actor_ip, p_actor_ua
    );
  END IF;

  INSERT INTO public.vinculo (
    campanha_id, pessoa_id, responsavel_id, papel, criado_por
  ) VALUES (
    p_campanha_id, nova_pessoa_id, p_responsavel_id, p_papel, p_criado_por
  ) RETURNING id INTO novo_vinculo_id;

  RETURN jsonb_build_object('pessoa_id', nova_pessoa_id, 'vinculo_id', novo_vinculo_id);
END;
$$;
REVOKE ALL ON FUNCTION public.criar_pessoa_com_vinculo FROM public, authenticated, anon;

-- ============================================================
-- Atualizar RLS de pessoa para usar actor_pode_ver_pessoa
-- ============================================================
DROP POLICY IF EXISTS "pessoa_tenant_select" ON public.pessoa;

CREATE POLICY "pessoa_select" ON public.pessoa
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND deleted_at IS NULL
    AND public.actor_pode_ver_pessoa(auth.uid(), id)
  );

DROP POLICY IF EXISTS "pessoa_update" ON public.pessoa;

CREATE POLICY "pessoa_update" ON public.pessoa
  FOR UPDATE TO authenticated
  USING (public.actor_pode_editar_pessoa(auth.uid(), id));

SET LOCAL check_function_bodies = on;
