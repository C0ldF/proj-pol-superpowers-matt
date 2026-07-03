-- Erratum descoberto na Task 23/24: o CSV do TRE não deve depender de casar
-- bairro contra o JSON oficial (ADR 0011 original previa isso, mas o usuário
-- esclareceu que essa fatia é só pra alimentar o mapa de calor com
-- nome/endereco/lat-long/secoes — o match fuzzy fica só pra bairro_local
-- (ADR 0017, Tasks 8-9), não pro CSV). bairro_oficial_id vira opcional.
ALTER TABLE public.local_votacao ALTER COLUMN bairro_oficial_id DROP NOT NULL;
