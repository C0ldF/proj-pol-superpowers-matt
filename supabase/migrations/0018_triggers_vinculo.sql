-- ============================================================
-- Trigger: sync usuario_campanha.papel usando papel_prioridade
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_vinculo_sync_papel_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  aff_pessoa_id  uuid;
  aff_camp_id    uuid;
  novo_papel     public.papel_login;
BEGIN
  IF TG_OP = 'DELETE' THEN
    aff_pessoa_id := OLD.pessoa_id; aff_camp_id := OLD.campanha_id;
  ELSE
    aff_pessoa_id := NEW.pessoa_id; aff_camp_id := NEW.campanha_id;
  END IF;

  -- papel de maior prioridade excluindo apoiador (cast para papel_login é seguro
  -- porque papel_login é subconjunto de papel_vinculo sem 'apoiador')
  SELECT v.papel::text::public.papel_login INTO novo_papel
    FROM public.vinculo v
    JOIN public.papel_prioridade pp ON pp.papel = v.papel
   WHERE v.pessoa_id = aff_pessoa_id AND v.campanha_id = aff_camp_id
     AND v.papel != 'apoiador'
   ORDER BY pp.prioridade DESC LIMIT 1;

  IF novo_papel IS NOT NULL THEN
    UPDATE public.usuario_campanha
       SET papel = novo_papel
     WHERE pessoa_id = aff_pessoa_id;
  ELSE
    -- sem vínculo elegível para login: sinaliza no audit_log
    INSERT INTO public.audit_log (campanha_id, actor_id, acao, depois)
    SELECT uc.campanha_id, aff_pessoa_id, 'login.acesso_revogado',
           jsonb_build_object('pessoa_id', aff_pessoa_id)
      FROM public.usuario_campanha uc WHERE uc.pessoa_id = aff_pessoa_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_vinculo_sync_papel
  AFTER INSERT OR UPDATE OR DELETE ON public.vinculo
  FOR EACH ROW EXECUTE FUNCTION public.trg_vinculo_sync_papel_fn();

-- ============================================================
-- Trigger: notificação para responsáveis anteriores (vínculo compartilhado)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_notificacao_vinculo_compartilhado_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE rec record;
BEGIN
  -- notifica responsáveis cujo vínculo com essa pessoa já existia ANTES deste INSERT
  FOR rec IN
    SELECT DISTINCT uc.user_id, uc.campanha_id
      FROM public.vinculo v
      JOIN public.usuario_campanha uc ON uc.pessoa_id = v.responsavel_id
     WHERE v.pessoa_id  = NEW.pessoa_id
       AND v.campanha_id = NEW.campanha_id
       AND v.id         != NEW.id
       AND (v.criado_por IS DISTINCT FROM NEW.criado_por)
  LOOP
    INSERT INTO public.notificacao (campanha_id, destinatario_user_id, tipo, payload)
    VALUES (
      NEW.campanha_id, rec.user_id, 'vinculo_compartilhado',
      jsonb_build_object(
        'pessoa_id',          NEW.pessoa_id,
        'novo_responsavel_id', NEW.responsavel_id,
        'novo_criado_por',    NEW.criado_por
      )
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notificacao_vinculo_compartilhado
  AFTER INSERT ON public.vinculo
  FOR EACH ROW EXECUTE FUNCTION public.trg_notificacao_vinculo_compartilhado_fn();

-- ============================================================
-- Security: Restrict trigger function execution to SECURITY DEFINER only
-- ============================================================
REVOKE ALL ON FUNCTION public.trg_vinculo_sync_papel_fn() FROM public, authenticated, anon;
REVOKE ALL ON FUNCTION public.trg_notificacao_vinculo_compartilhado_fn() FROM public, authenticated, anon;
