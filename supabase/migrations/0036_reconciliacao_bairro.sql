CREATE TABLE public.bairro_reconciliacao_alerta (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id        uuid        NOT NULL REFERENCES public.campanha(id),
  bairro_local_id    uuid        NOT NULL REFERENCES public.bairro_local(id),
  bairro_oficial_id  uuid        NOT NULL REFERENCES public.bairro_oficial(id),
  similaridade       numeric,
  resolvido          boolean     NOT NULL DEFAULT false,
  resolucao          public.status_reconciliacao_enum,
  resolvido_por      text,
  resolvido_em       timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bairro_reconciliacao_campanha_idx ON public.bairro_reconciliacao_alerta (campanha_id);

ALTER TABLE public.bairro_reconciliacao_alerta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bairro_reconciliacao_alerta FROM anon, public;

CREATE POLICY "bairro_reconciliacao_alerta_select" ON public.bairro_reconciliacao_alerta
  FOR SELECT TO authenticated
  USING (
    campanha_id = (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'campanha_id'
    )::uuid
    AND (
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'papel'
    ) = 'gestor'
  );
-- INSERT/UPDATE só via funções SECURITY DEFINER abaixo (sem grant para authenticated)

CREATE OR REPLACE FUNCTION public.detectar_reconciliacao_bairro(p_importacao_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_municipio_id integer;
  v_count        integer := 0;
  rec            record;
BEGIN
  SELECT municipio_id INTO v_municipio_id FROM public.importacao_tre WHERE id = p_importacao_id;
  IF v_municipio_id IS NULL THEN RETURN 0; END IF;

  FOR rec IN
    SELECT bl.id AS bairro_local_id, bl.campanha_id, bo.id AS bairro_oficial_id,
           extensions.similarity(bl.nome_normalizado, bo.nome_normalizado) AS sim
      FROM public.bairro_local bl
      JOIN public.bairro_oficial bo ON bo.municipio_id = v_municipio_id
     WHERE bl.status != 'fundido'
       AND extensions.similarity(bl.nome_normalizado, bo.nome_normalizado) >= 0.4
       AND NOT EXISTS (
             SELECT 1 FROM public.bairro_reconciliacao_alerta a
              WHERE a.bairro_local_id = bl.id
                AND a.bairro_oficial_id = bo.id
                AND a.resolvido = false
           )
  LOOP
    INSERT INTO public.bairro_reconciliacao_alerta (
      campanha_id, bairro_local_id, bairro_oficial_id, similaridade
    ) VALUES (rec.campanha_id, rec.bairro_local_id, rec.bairro_oficial_id, rec.sim);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.detectar_reconciliacao_bairro(uuid) FROM public, authenticated, anon;

CREATE OR REPLACE FUNCTION public.resolver_reconciliacao_bairro(
  p_alerta_id uuid,
  p_resolucao public.status_reconciliacao_enum,
  p_operador  text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM public.bairro_reconciliacao_alerta WHERE id = p_alerta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'alerta não encontrado: %', p_alerta_id; END IF;

  IF p_resolucao = 'fundido' THEN
    UPDATE public.bairro_local SET status = 'fundido' WHERE id = v.bairro_local_id;
  END IF;

  UPDATE public.bairro_reconciliacao_alerta
     SET resolvido = true, resolucao = p_resolucao, resolvido_por = p_operador, resolvido_em = now()
   WHERE id = p_alerta_id;
END;
$$;
REVOKE ALL ON FUNCTION public.resolver_reconciliacao_bairro(uuid, public.status_reconciliacao_enum, text) FROM public, authenticated, anon;
