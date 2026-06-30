CREATE OR REPLACE FUNCTION public.inserir_usuario_campanha_provisionado(
  p_user_id     uuid,
  p_campanha_id uuid,
  p_cpf_hmac    text,
  p_pessoa_id   uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p_papel public.papel_login;
BEGIN
  -- resolve papel mais alto da pessoa (trigger sync assume que vínculo já existe)
  SELECT v.papel::text::public.papel_login INTO p_papel
    FROM public.vinculo v
    JOIN public.papel_prioridade pp ON pp.papel = v.papel
   WHERE v.pessoa_id = p_pessoa_id AND v.campanha_id = p_campanha_id
     AND v.papel != 'apoiador'
   ORDER BY pp.prioridade DESC LIMIT 1;

  IF p_papel IS NULL THEN
    RAISE EXCEPTION 'pessoa % não tem vínculo elegível para login', p_pessoa_id;
  END IF;

  INSERT INTO public.usuario_campanha (user_id, campanha_id, papel, cpf_hmac, pessoa_id)
  VALUES (p_user_id, p_campanha_id, p_papel, p_cpf_hmac, p_pessoa_id);
END;
$$;
REVOKE ALL ON FUNCTION public.inserir_usuario_campanha_provisionado FROM public, authenticated, anon;
