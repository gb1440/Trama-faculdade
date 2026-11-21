create table if not exists public.trama_catalogs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  enabled boolean not null default true,
  store_name text not null check (length(store_name) between 1 and 120),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,13}$'),
  city text not null default '',
  title text not null default 'Catálogo online',
  description text not null default '',
  price_mode text not null default 'Atacado' check (price_mode in ('Atacado','Varejo')),
  minimum_qty integer not null default 0 check (minimum_qty between 0 and 100000),
  minimum_value integer not null default 0 check (minimum_value between 0 and 100000000),
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),
  updated_at timestamptz not null default now()
);

create table if not exists public.trama_catalog_orders (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  catalog_id uuid not null references public.trama_catalogs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  number integer not null check (number > 0),
  status text not null default 'Novo' check (status in ('Novo','Em atendimento','Finalizado','Cancelado')),
  customer jsonb not null,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total_qty integer not null check (total_qty > 0),
  total bigint not null check (total > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_id, number),
  unique (catalog_id, request_id)
);

create index if not exists trama_catalog_orders_owner_created_idx on public.trama_catalog_orders(user_id, created_at desc);
create index if not exists trama_catalog_orders_catalog_status_idx on public.trama_catalog_orders(catalog_id, status);

alter table public.trama_catalogs enable row level security;
alter table public.trama_catalog_orders enable row level security;

drop policy if exists "catalogo publico habilitado" on public.trama_catalogs;
create policy "catalogo publico habilitado" on public.trama_catalogs for select using (enabled or auth.uid() = user_id);
drop policy if exists "dono cria catalogo" on public.trama_catalogs;
create policy "dono cria catalogo" on public.trama_catalogs for insert with check (auth.uid() = user_id);
drop policy if exists "dono atualiza catalogo" on public.trama_catalogs;
create policy "dono atualiza catalogo" on public.trama_catalogs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "dono consulta pedidos" on public.trama_catalog_orders;
create policy "dono consulta pedidos" on public.trama_catalog_orders for select using (auth.uid() = user_id);
drop policy if exists "dono atualiza pedidos" on public.trama_catalog_orders;
create policy "dono atualiza pedidos" on public.trama_catalog_orders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.trama_submit_catalog_order(p_slug text, p_request_id uuid, p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_catalog public.trama_catalogs%rowtype;
  v_existing public.trama_catalog_orders%rowtype;
  v_line jsonb;
  v_product jsonb;
  v_variant jsonb;
  v_customer jsonb;
  v_items jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_phone text;
  v_document text;
  v_qty integer;
  v_reserved integer;
  v_total_qty integer := 0;
  v_total bigint := 0;
  v_number integer;
  v_order public.trama_catalog_orders%rowtype;
begin
  select * into v_catalog from public.trama_catalogs where slug = lower(trim(p_slug)) and enabled for update;
  if not found then raise exception 'Catálogo não encontrado ou indisponível.'; end if;
  if p_request_id is null then raise exception 'Identificador do pedido inválido.'; end if;
  select * into v_existing from public.trama_catalog_orders where catalog_id = v_catalog.id and request_id = p_request_id;
  if found then return jsonb_build_object('order', to_jsonb(v_existing), 'store_name', v_catalog.store_name, 'whatsapp', v_catalog.whatsapp); end if;
  if jsonb_typeof(p_customer) <> 'object' or length(trim(coalesce(p_customer->>'name',''))) < 1 then raise exception 'Informe o nome do cliente.'; end if;
  v_phone := regexp_replace(coalesce(p_customer->>'whatsapp',''), '\D', '', 'g');
  if length(v_phone) not between 10 and 13 then raise exception 'Informe um WhatsApp válido com DDD.'; end if;
  if length(trim(coalesce(p_customer->>'city',''))) < 1 or upper(trim(coalesce(p_customer->>'uf',''))) !~ '^[A-Z]{2}$' then raise exception 'Informe cidade e UF.'; end if;
  v_document := regexp_replace(coalesce(p_customer->>'document',''), '\D', '', 'g');
  if length(v_document) not in (0,11,14) then raise exception 'Informe um CPF ou CNPJ válido.'; end if;
  if (select count(*) from public.trama_catalog_orders where catalog_id=v_catalog.id and customer->>'whatsapp'=v_phone and created_at > now()-interval '10 minutes') >= 5 then raise exception 'Aguarde alguns minutos antes de enviar outro pedido.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then raise exception 'Adicione pelo menos uma peça ao pedido.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_catalog.id::text, 0));
  for v_line in select value from jsonb_array_elements(p_items) loop
    select value into v_product from jsonb_array_elements(v_catalog.products) where value->>'id'=v_line->>'productId';
    if v_product is null then raise exception 'Uma peça escolhida não está mais disponível. Atualize o catálogo.'; end if;
    select value into v_variant from jsonb_array_elements(v_product->'variants') where value->>'id'=v_line->>'variantId';
    if v_variant is null then raise exception 'Uma combinação escolhida está esgotada. Atualize o catálogo.'; end if;
    if (v_line->>'variantId') = any(v_seen) then raise exception 'Agrupe a quantidade da mesma cor e tamanho.'; end if;
    v_seen := array_append(v_seen, v_line->>'variantId');
    begin v_qty := (v_line->>'qty')::integer; exception when others then raise exception 'Informe uma quantidade válida.'; end;
    if v_qty < 1 or v_qty > 100000 then raise exception 'Informe uma quantidade válida.'; end if;
    select coalesce(sum((item->>'qty')::integer),0) into v_reserved
      from public.trama_catalog_orders orders, jsonb_array_elements(orders.items) item
      where orders.catalog_id=v_catalog.id and orders.status in ('Novo','Em atendimento') and item->>'variantId'=v_line->>'variantId';
    if v_qty + v_reserved > (v_variant->>'stock')::integer then raise exception 'Estoque insuficiente para %, % %.', v_product->>'name', v_variant->>'color', v_variant->>'size'; end if;
    v_total_qty := v_total_qty + v_qty;
    v_total := v_total + v_qty * (v_product->>'price')::integer;
    v_items := v_items || jsonb_build_array(jsonb_build_object('productId',v_product->>'id','variantId',v_variant->>'id','name',v_product->>'name','color',v_variant->>'color','size',v_variant->>'size','qty',v_qty,'unitPrice',(v_product->>'price')::integer,'total',v_qty*(v_product->>'price')::integer));
  end loop;
  if exists(select 1 from jsonb_array_elements(v_catalog.products) product where (product->>'minimum')::integer > 0 and coalesce((select sum((item->>'qty')::integer) from jsonb_array_elements(v_items) item where item->>'productId'=product->>'id'),0) between 1 and (product->>'minimum')::integer-1) then raise exception 'Um produto não atingiu a quantidade mínima configurada.'; end if;
  if v_total_qty < v_catalog.minimum_qty or v_total < v_catalog.minimum_value then raise exception 'O pedido não atingiu o mínimo configurado pela loja.'; end if;
  v_customer := jsonb_build_object('name',left(trim(p_customer->>'name'),120),'whatsapp',v_phone,'city',left(trim(p_customer->>'city'),100),'uf',upper(trim(p_customer->>'uf')),'document',v_document);
  select coalesce(max(number),1000)+1 into v_number from public.trama_catalog_orders where catalog_id=v_catalog.id;
  insert into public.trama_catalog_orders(request_id,catalog_id,user_id,number,customer,items,total_qty,total) values(p_request_id,v_catalog.id,v_catalog.user_id,v_number,v_customer,v_items,v_total_qty,v_total) returning * into v_order;
  return jsonb_build_object('order',to_jsonb(v_order),'store_name',v_catalog.store_name,'whatsapp',v_catalog.whatsapp);
end;
$$;

revoke all on function public.trama_submit_catalog_order(text,uuid,jsonb,jsonb) from public;
grant execute on function public.trama_submit_catalog_order(text,uuid,jsonb,jsonb) to anon, authenticated;
revoke select on public.trama_catalogs from anon;
grant select(slug,enabled,store_name,city,title,description,price_mode,minimum_qty,minimum_value,products,updated_at) on public.trama_catalogs to anon;
grant select on public.trama_catalogs to authenticated;
grant insert, update on public.trama_catalogs to authenticated;
grant select, update on public.trama_catalog_orders to authenticated;

create or replace function public.trama_sync_catalog_products()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_mode text;
begin
  select price_mode into v_mode from public.trama_catalogs where user_id=new.user_id;
  if not found then return new; end if;
  update public.trama_catalogs set
    products=coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',product->>'id','name',product->>'name','code',product->>'code','category',product->>'category','photo',product->>'photo',
        'price',case when v_mode='Varejo' then (product->>'retail')::integer else (product->>'wholesale')::integer end,
        'minimum',coalesce((product->>'orderMinimum')::integer,0),
        'variants',coalesce((select jsonb_agg(jsonb_build_object('id',variant->>'id','color',variant->>'color','size',variant->>'size','stock',(variant->>'stock')::integer)) from jsonb_array_elements(product->'variants') variant where (variant->>'stock')::integer>0),'[]'::jsonb)
      )) from jsonb_array_elements(new.state->'products') product
      where coalesce((product->>'catalogVisible')::boolean,true) and exists(select 1 from jsonb_array_elements(product->'variants') variant where (variant->>'stock')::integer>0)
    ),'[]'::jsonb), updated_at=now()
  where user_id=new.user_id;
  return new;
end;
$$;
drop trigger if exists trama_store_state_sync_catalog on public.trama_store_state;
create trigger trama_store_state_sync_catalog after update of state on public.trama_store_state for each row execute function public.trama_sync_catalog_products();

update storage.buckets set public=true where id='product-images';
