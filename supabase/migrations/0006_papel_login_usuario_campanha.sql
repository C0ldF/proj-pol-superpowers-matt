-- S1 Task 1: enum de papel-base e tabela de membership (fonte do claim do hook).
create type public.papel_login as enum ('gestor', 'coordenador', 'lideranca', 'colaborador');

create table public.usuario_campanha (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  campanha_id uuid not null references public.campanha (id),
  papel       public.papel_login not null,
  cpf_hmac    text not null,
  criado_em   timestamptz not null default now(),
  unique (campanha_id, cpf_hmac)
);

alter table public.usuario_campanha enable row level security;

-- Ninguém do app (anon/authenticated) acessa diretamente; fonte só p/ o hook e seed.
revoke all on table public.usuario_campanha from authenticated, anon, public;

-- O Custom Access Token Hook roda como supabase_auth_admin e precisa ler.
grant select on table public.usuario_campanha to supabase_auth_admin;
create policy "auth_admin_le_usuario_campanha" on public.usuario_campanha
  as permissive for select to supabase_auth_admin using (true);

-- service_role (seed/provisão server-side) escreve e lê. service_role ignora RLS,
-- mas ainda precisa de GRANT de tabela.
grant select, insert, update, delete on table public.usuario_campanha to service_role;
