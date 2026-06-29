-- View SECURITY DEFINER (padrão: roda como owner = postgres), portanto ignora a
-- RLS de campanha e expõe apenas 3 colunas não-PII. NÃO marcar security_invoker.
create view public.campanha_publica as
  select subdominio, nome, status
  from public.campanha;

grant select on public.campanha_publica to anon, authenticated;
