-- Erratum descoberto no Task 20 rodando o CSV real do TRE: NUM_LOCAL só é
-- único DENTRO de uma zona eleitoral, não no município inteiro. A constraint
-- original (0029) não incluía zona_id — 169 dos 3555 registros reais
-- colidiam entre zonas diferentes e travavam o ingest com 23505.
ALTER TABLE public.local_votacao DROP CONSTRAINT local_votacao_unico;
ALTER TABLE public.local_votacao
  ADD CONSTRAINT local_votacao_unico UNIQUE (importacao_id, zona_id, num_local);
