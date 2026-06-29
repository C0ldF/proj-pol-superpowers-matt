create table public.audit_log (
  id bigint generated always as identity primary key,
  campanha_id uuid not null references public.campanha(id),
  actor_id uuid,
  acao text not null,
  entidade text,
  entidade_id text,
  antes jsonb,
  depois jsonb,
  criado_em timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- Isolamento por campanha via claim (preenchida pelo hook do S1).
create policy audit_select on public.audit_log
  for select to authenticated
  using ( campanha_id = (auth.jwt() -> 'app_metadata' ->> 'campanha_id')::uuid );

create policy audit_insert on public.audit_log
  for insert to authenticated
  with check ( campanha_id = (auth.jwt() -> 'app_metadata' ->> 'campanha_id')::uuid );

-- Append-only: sem UPDATE/DELETE para os papéis do app. Nem Gestor nem Superadmin.
revoke update, delete on public.audit_log from authenticated, anon;
