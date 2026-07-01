CREATE TABLE public.vinculo (
  id            uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id   uuid               NOT NULL REFERENCES public.campanha(id),
  pessoa_id     uuid               NOT NULL REFERENCES public.pessoa(id),
  responsavel_id uuid              REFERENCES public.pessoa(id),
  papel         public.papel_vinculo NOT NULL,
  criado_por    uuid               REFERENCES auth.users(id),
  criado_em     timestamptz        NOT NULL DEFAULT now(),
  CONSTRAINT vinculo_sem_autoloop  CHECK (pessoa_id <> responsavel_id),
  CONSTRAINT vinculo_unique_aresta UNIQUE (campanha_id, pessoa_id, responsavel_id)
);

CREATE INDEX vinculo_pessoa_idx       ON public.vinculo (pessoa_id);
CREATE INDEX vinculo_responsavel_idx  ON public.vinculo (responsavel_id);
CREATE INDEX vinculo_campanha_idx     ON public.vinculo (campanha_id);

-- ============================================================
-- Trigger: anti-ciclo
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_vinculo_ciclo_check_fn()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.responsavel_id IS NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    WITH RECURSIVE anc AS (
      SELECT v.responsavel_id AS pid
        FROM public.vinculo v
       WHERE v.pessoa_id = NEW.responsavel_id AND v.campanha_id = NEW.campanha_id
      UNION ALL
      SELECT v2.responsavel_id FROM public.vinculo v2
        JOIN anc ON anc.pid = v2.pessoa_id
       WHERE v2.campanha_id = NEW.campanha_id AND v2.responsavel_id IS NOT NULL
    )
    SELECT 1 FROM anc WHERE pid = NEW.pessoa_id
  ) THEN
    RAISE EXCEPTION 'ciclo detectado: inserir pessoa=% sob responsavel=% criaria ciclo',
      NEW.pessoa_id, NEW.responsavel_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vinculo_ciclo_check
  BEFORE INSERT ON public.vinculo
  FOR EACH ROW EXECUTE FUNCTION public.trg_vinculo_ciclo_check_fn();

REVOKE ALL ON FUNCTION public.trg_vinculo_ciclo_check_fn() FROM public, authenticated, anon;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vinculo FROM anon, public;

CREATE POLICY "vinculo_select" ON public.vinculo
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND public.actor_pode_ver_pessoa(auth.uid(), pessoa_id)
  );

CREATE POLICY "vinculo_insert" ON public.vinculo
  FOR INSERT TO authenticated
  WITH CHECK (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND public.actor_pode_criar_vinculo_sob(auth.uid(), responsavel_id, papel)
  );

-- UPDATE direto bloqueado; mudanças estruturais via SECURITY DEFINER (realocar_subarvore)
CREATE POLICY "vinculo_update" ON public.vinculo
  FOR UPDATE TO authenticated USING (false);

CREATE POLICY "vinculo_delete" ON public.vinculo
  FOR DELETE TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND public.actor_pode_remover_vinculo(auth.uid(), id)
  );
