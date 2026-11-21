create table if not exists public.trama_store_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.trama_store_state enable row level security;
revoke all on table public.trama_store_state from anon, authenticated;
grant select, insert, update on table public.trama_store_state to authenticated;

drop policy if exists "trama_select_own_store" on public.trama_store_state;
create policy "trama_select_own_store" on public.trama_store_state
for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "trama_insert_own_store" on public.trama_store_state;
create policy "trama_insert_own_store" on public.trama_store_state
for insert to authenticated with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "trama_update_own_store" on public.trama_store_state;
create policy "trama_update_own_store" on public.trama_store_state
for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create sequence if not exists public.trama_sku_seq as bigint start with 1;
revoke all on sequence public.trama_sku_seq from public, anon;
grant usage, select on sequence public.trama_sku_seq to authenticated;

create or replace function public.trama_next_sku() returns text
language sql volatile security invoker set search_path = '' as $$
  select case when (select auth.uid()) is null then null
    else 'TRM-' || lpad(nextval('public.trama_sku_seq')::text, 6, '0') end
$$;

revoke execute on function public.trama_next_sku() from public, anon;
grant execute on function public.trama_next_sku() to authenticated;
