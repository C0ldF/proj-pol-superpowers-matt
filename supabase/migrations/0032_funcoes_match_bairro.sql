CREATE OR REPLACE FUNCTION public.normalizar_texto(txt text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT lower(trim(extensions.unaccent(coalesce(txt, ''))));
$$;
REVOKE ALL ON FUNCTION public.normalizar_texto(text) FROM public, authenticated, anon;

CREATE OR REPLACE FUNCTION public.match_bairro_oficial(
  p_municipio_id integer,
  p_nome_bruto   text,
  p_limiar       numeric DEFAULT 0.4
) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT id FROM public.bairro_oficial
   WHERE municipio_id = p_municipio_id
     AND extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) >= p_limiar
   ORDER BY extensions.similarity(nome_normalizado, public.normalizar_texto(p_nome_bruto)) DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.match_bairro_oficial(integer, text, numeric) FROM public, authenticated, anon;
