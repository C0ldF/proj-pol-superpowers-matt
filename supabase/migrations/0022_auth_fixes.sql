-- ============================================================
-- Fix 1: actor_pode_criar_vinculo_sob — use actor_uid parameter
--   (was using auth.uid() internally, which is wrong when called
--    from SECURITY DEFINER context with service_role client)
-- ============================================================
CREATE OR REPLACE FUNCTION public.actor_pode_criar_vinculo_sob(
  actor_uid          uuid,
  responsavel_id     uuid,
  novo_papel         public.papel_vinculo
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p          public.papel_login;
  actor_camp uuid;
  resp_camp  uuid;
  actor_pess uuid;
BEGIN
  SELECT papel, campanha_id, pessoa_id INTO p, actor_camp, actor_pess
    FROM public.usuario_campanha WHERE user_id = actor_uid;
  IF p IS NULL OR p = 'colaborador' THEN RETURN false; END IF;

  -- NULL responsavel_id = root vínculo; only gestor may create
  IF responsavel_id IS NULL THEN
    RETURN p = 'gestor';
  END IF;

  SELECT campanha_id INTO resp_camp FROM public.pessoa WHERE id = responsavel_id;
  IF resp_camp IS DISTINCT FROM actor_camp THEN RETURN false; END IF;

  IF p = 'gestor' THEN RETURN true; END IF;

  IF p = 'coordenador' THEN
    RETURN responsavel_id = actor_pess
        OR public.pessoa_em_subarvore_do_actor(actor_uid, responsavel_id);
  END IF;

  IF p = 'lideranca' THEN
    RETURN novo_papel = 'apoiador' AND responsavel_id = actor_pess;
  END IF;

  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.actor_pode_criar_vinculo_sob(uuid, uuid, public.papel_vinculo) FROM public, authenticated, anon;

-- ============================================================
-- Fix 2: criar_pessoa_com_vinculo — add authority check + return public_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.criar_pessoa_com_vinculo(
  p_campanha_id         uuid,
  p_nome                text,
  p_titulo_hmac         text,
  p_titulo_enc          text,
  p_cpf_hmac            text,
  p_telefone            text,
  p_email_contato       text,
  p_base_legal          public.base_legal_enum,
  p_origem_coleta       public.origem_coleta_enum,
  p_responsavel_id      uuid,
  p_papel               public.papel_vinculo,
  p_criado_por          uuid,
  p_pessoa_id_existente uuid,
  p_actor_ip            inet,
  p_actor_ua            text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  nova_pessoa_id  uuid;
  novo_vinculo_id uuid;
  nova_public_id  text;
BEGIN
  IF NOT public.actor_pode_criar_vinculo_sob(p_criado_por, p_responsavel_id, p_papel) THEN
    RAISE EXCEPTION 'não autorizado: actor % não pode criar vínculo % sob %',
      p_criado_por, p_papel, p_responsavel_id;
  END IF;

  IF p_pessoa_id_existente IS NOT NULL THEN
    nova_pessoa_id := p_pessoa_id_existente;
    SELECT public_id INTO nova_public_id FROM public.pessoa WHERE id = nova_pessoa_id;
  ELSE
    INSERT INTO public.pessoa (
      campanha_id, nome, titulo_hmac, titulo_enc, cpf_hmac,
      telefone, email_contato, base_legal, origem_coleta
    ) VALUES (
      p_campanha_id, p_nome, p_titulo_hmac, p_titulo_enc, p_cpf_hmac,
      p_telefone, p_email_contato, p_base_legal, p_origem_coleta
    ) RETURNING id, public_id INTO nova_pessoa_id, nova_public_id;

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

  RETURN jsonb_build_object(
    'pessoa_id', nova_pessoa_id,
    'vinculo_id', novo_vinculo_id,
    'public_id', nova_public_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.criar_pessoa_com_vinculo(uuid, text, text, text, text, text, text, public.base_legal_enum, public.origem_coleta_enum, uuid, public.papel_vinculo, uuid, uuid, inet, text) FROM public, authenticated, anon;

-- ============================================================
-- Fix 3: realocar_subarvore — validate destino belongs to same campanha
-- ============================================================
CREATE OR REPLACE FUNCTION public.realocar_subarvore(
  p_vinculo_id          uuid,
  p_novo_responsavel_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; n integer;
BEGIN
  SELECT pessoa_id, responsavel_id, campanha_id INTO v
    FROM public.vinculo WHERE id = p_vinculo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'vínculo não encontrado: %', p_vinculo_id; END IF;

  IF p_novo_responsavel_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vinculo
       WHERE pessoa_id = p_novo_responsavel_id AND campanha_id = v.campanha_id
    ) THEN
      RAISE EXCEPTION 'novo responsável % não pertence à campanha %',
        p_novo_responsavel_id, v.campanha_id;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.vinculo
       WHERE pessoa_id = p_novo_responsavel_id
         AND responsavel_id = v.pessoa_id
         AND campanha_id = v.campanha_id
    ) THEN
      RAISE EXCEPTION 'novo responsável % é filho direto de %, criaria ciclo após remoção',
        p_novo_responsavel_id, v.pessoa_id;
    END IF;
  END IF;

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
