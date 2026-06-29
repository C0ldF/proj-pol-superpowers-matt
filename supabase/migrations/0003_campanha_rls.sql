-- campanha não tem campanha_id próprio. Acesso de campanhas é via view pública
-- (leitura mínima) e escrita só por service_role. RLS ligado sem policy =
-- deny total para authenticated/anon; service_role faz bypass nativo.
alter table public.campanha enable row level security;
