CREATE TYPE public.granularidade_calor_enum AS ENUM ('zona', 'bairro');

-- Nenhum índice hoje tem zona_id como coluna líder em local_votacao (só
-- aparece como 2ª coluna da unique importacao_id+zona_id+num_local, inútil
-- pra GROUP BY zona_id isolado) — necessário pro padrão de query do S4.
CREATE INDEX local_votacao_zona_idx ON public.local_votacao (zona_id);
