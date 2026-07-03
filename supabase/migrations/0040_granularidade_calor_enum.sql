CREATE TYPE public.granularidade_calor_enum AS ENUM ('zona', 'bairro');

CREATE INDEX local_votacao_zona_idx ON public.local_votacao (zona_id);
