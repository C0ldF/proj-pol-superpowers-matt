insert into public.campanha (subdominio, nome, cargo, abrangencia, municipio_id, uf, data_eleicao)
values
  ('campanha-a', 'Campanha A', 'vereador', 'municipal', 1219, null, '2028-10-01'),
  ('campanha-b', 'Campanha B', 'deputado_estadual', 'estadual', null, 'PI', '2026-10-04')
on conflict (subdominio) do nothing;
