create type cargo as enum ('vereador', 'prefeito', 'deputado_estadual');
create type abrangencia as enum ('municipal', 'estadual');
create type campanha_status as enum ('ativa', 'suspensa', 'encerrada');

create table public.campanha (
  id uuid primary key default gen_random_uuid(),
  subdominio text not null unique,
  nome text not null,
  cargo cargo not null,
  abrangencia abrangencia not null,
  municipio_id bigint,
  uf char(2),
  status campanha_status not null default 'ativa',
  data_eleicao date not null,
  suspensa_em timestamptz,
  modulos_habilitados jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint abrangencia_geo check (
    (abrangencia = 'municipal' and municipio_id is not null and uf is null)
    or (abrangencia = 'estadual' and uf is not null and municipio_id is null)
  )
);
