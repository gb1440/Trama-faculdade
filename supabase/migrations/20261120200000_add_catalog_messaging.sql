create schema trama_events;
revoke all on schema trama_events from public, anon, authenticated;

create table trama_events.outbox (
  version bigint generated always as identity primary key,
  event_id uuid not null unique default gen_random_uuid(),
  catalog_id uuid not null references public.trama_catalogs(id) on delete cascade,
  catalog_slug text not null,
  event_type text not null,
  data jsonb not null,
  occurred_at timestamptz not null default clock_timestamp(),
  published_at timestamptz
);

create index trama_event_outbox_pending on trama_events.outbox(version) where published_at is null;

create table trama_events.site_updates (
  catalog_id uuid not null references public.trama_catalogs(id) on delete cascade,
  event_type text not null,
  entity_key text not null,
  version bigint not null,
  data jsonb not null,
  occurred_at timestamptz not null,
  primary key (catalog_id, event_type, entity_key)
);

-- Preserva a consulta de pedidos que já existiam antes da integração.
insert into trama_events.site_updates (catalog_id, event_type, entity_key, version, data, occurred_at)
select catalog_id, 'pedido.status_alterado', id::text, 0,
       jsonb_build_object('orderId', id, 'status', status), updated_at
from public.trama_catalog_orders;

create function trama_events.catalog_variants(products jsonb)
returns table (product_id text, variant_id text, stock jsonb)
language sql
immutable
set search_path = ''
as $$
  select product->>'id', variant->>'id', variant->'stock'
  from jsonb_array_elements(products) product
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(product->'variants') = 'array' then product->'variants' else '[]'::jsonb end
  ) variant
  where nullif(product->>'id','') is not null
    and nullif(variant->>'id','') is not null
    and jsonb_typeof(variant->'stock') = 'number';
$$;

create function trama_events.enqueue_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_products jsonb := '[]'::jsonb;
  current_products jsonb := '[]'::jsonb;
begin
  if tg_op = 'UPDATE' and old.enabled then previous_products := old.products; end if;
  if new.enabled then current_products := new.products; end if;
  if previous_products = current_products then return new; end if;

  insert into trama_events.outbox (catalog_id, catalog_slug, event_type, data)
  select new.id, new.slug, 'estoque.atualizado', jsonb_build_object(
    'productId', coalesce(next.product_id, prev.product_id),
    'variantId', coalesce(next.variant_id, prev.variant_id),
    'stock', coalesce(next.stock, '0'::jsonb)
  )
  from trama_events.catalog_variants(previous_products) prev
  full join trama_events.catalog_variants(current_products) next using (product_id, variant_id)
  where coalesce(prev.stock, '0'::jsonb) <> coalesce(next.stock, '0'::jsonb);

  return new;
end;
$$;

create trigger trama_enqueue_stock
after insert or update of products, enabled on public.trama_catalogs
for each row execute function trama_events.enqueue_stock();

create function trama_events.enqueue_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;

  insert into trama_events.outbox (catalog_id, catalog_slug, event_type, data)
  select new.catalog_id, catalog.slug, 'pedido.status_alterado',
         jsonb_build_object('orderId', new.id, 'status', new.status)
  from public.trama_catalogs catalog
  where catalog.id = new.catalog_id;
  return new;
end;
$$;

create trigger trama_enqueue_order
after insert or update of status on public.trama_catalog_orders
for each row execute function trama_events.enqueue_order();

create function public.trama_get_order_tracking(p_slug text, p_order_id uuid, p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', orders.id,
    'number', orders.number,
    'status', coalesce(updates.data->>'status', 'Novo'),
    'updatedAt', coalesce(updates.occurred_at, orders.created_at)
  )
  from public.trama_catalog_orders orders
  join public.trama_catalogs catalog on catalog.id = orders.catalog_id
  left join trama_events.site_updates updates on updates.catalog_id = catalog.id
    and updates.event_type = 'pedido.status_alterado' and updates.entity_key = orders.id::text
  where catalog.slug = p_slug and orders.id = p_order_id and orders.request_id = p_request_id;
$$;

revoke all on function public.trama_get_order_tracking(text, uuid, uuid) from public;
grant execute on function public.trama_get_order_tracking(text, uuid, uuid) to anon, authenticated;

create function public.trama_get_site_stock(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(updates.data || jsonb_build_object('entityVersion', updates.version) order by updates.version)
    from trama_events.site_updates updates
    where updates.catalog_id = catalog.id and updates.event_type = 'estoque.atualizado'
  ), '[]'::jsonb)
  from public.trama_catalogs catalog
  where catalog.slug = p_slug and catalog.enabled;
$$;

revoke all on function public.trama_get_site_stock(text) from public;
grant execute on function public.trama_get_site_stock(text) to anon, authenticated;
