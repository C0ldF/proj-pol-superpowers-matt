CREATE TABLE public.municipio (
  cod_ibge   integer     PRIMARY KEY,
  nome       text        NOT NULL,
  uf         char(2)     NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.municipio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.municipio FROM anon, public;

-- seed: único município usado nesta fatia (CSV real é de Teresina)
INSERT INTO public.municipio (cod_ibge, nome, uf) VALUES (2211001, 'TERESINA', 'PI');
