alter table public.trama_catalog_orders
  add column if not exists stock_applied boolean not null default false;

create or replace function public.trama_apply_catalog_order_stock(
  p_catalog_id uuid,
  p_items jsonb,
  p_direction integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_catalog public.trama_catalogs%rowtype;
  v_state jsonb;
  v_line jsonb;
  v_product jsonb;
  v_variant jsonb;
  v_store_product jsonb;
  v_store_variant jsonb;
  v_qty integer;
  v_next_stock integer;
  v_products jsonb;
  v_movements jsonb;
begin
  if p_direction not in (-1, 1) then
    raise exception 'Movimentação de estoque inválida.';
  end if;

  select * into v_catalog
    from public.trama_catalogs
    where id = p_catalog_id
    for update;
  if not found then raise exception 'Catálogo não encontrado.'; end if;

  select state into v_state
    from public.trama_store_state
    where user_id = v_catalog.user_id
    for update;
  if not found then raise exception 'Estoque da loja não encontrado.'; end if;

  v_movements := coalesce(v_state->'movements', '[]'::jsonb);

  for v_line in select value from jsonb_array_elements(p_items) loop
    begin v_qty := (v_line->>'qty')::integer;
    exception when others then raise exception 'Quantidade inválida no pedido.'; end;
    if v_qty < 1 then raise exception 'Quantidade inválida no pedido.'; end if;

    select value into v_product
      from jsonb_array_elements(v_catalog.products)
      where value->>'id' = v_line->>'productId';
    select value into v_variant
      from jsonb_array_elements(v_product->'variants')
      where value->>'id' = v_line->>'variantId';
    if v_product is null or v_variant is null then
      raise exception 'Uma peça escolhida não está mais disponível.';
    end if;

    select value into v_store_product
      from jsonb_array_elements(v_state->'products')
      where value->>'id' = v_line->>'productId';
    select value into v_store_variant
      from jsonb_array_elements(v_store_product->'variants')
      where value->>'id' = v_line->>'variantId';
    if v_store_product is null or v_store_variant is null then
      raise exception 'A peça não foi encontrada no estoque principal.';
    end if;

    if p_direction = -1 and (
      (v_variant->>'stock')::integer < v_qty
      or (v_store_variant->>'stock')::integer < v_qty
    ) then
      raise exception 'Estoque insuficiente para %, % %.',
        v_product->>'name', v_variant->>'color', v_variant->>'size';
    end if;

    select jsonb_agg(
      case when product.value->>'id' = v_line->>'productId' then
        jsonb_set(
          product.value,
          '{variants}',
          (
            select jsonb_agg(
              case when variant.value->>'id' = v_line->>'variantId' then
                jsonb_set(
                  variant.value,
                  '{stock}',
                  to_jsonb((variant.value->>'stock')::integer + p_direction * v_qty)
                )
              else variant.value end
              order by variant.ordinality
            )
            from jsonb_array_elements(product.value->'variants') with ordinality variant(value, ordinality)
          )
        )
      else product.value end
      order by product.ordinality
    ) into v_products
    from jsonb_array_elements(v_catalog.products) with ordinality product(value, ordinality);
    v_catalog.products := v_products;

    select jsonb_agg(
      case when product.value->>'id' = v_line->>'productId' then
        jsonb_set(
          product.value,
          '{variants}',
          (
            select jsonb_agg(
              case when variant.value->>'id' = v_line->>'variantId' then
                jsonb_set(
                  variant.value,
                  '{stock}',
                  to_jsonb((variant.value->>'stock')::integer + p_direction * v_qty)
                )
              else variant.value end
              order by variant.ordinality
            )
            from jsonb_array_elements(product.value->'variants') with ordinality variant(value, ordinality)
          )
        )
      else product.value end
      order by product.ordinality
    ) into v_products
    from jsonb_array_elements(v_state->'products') with ordinality product(value, ordinality);
    v_state := jsonb_set(v_state, '{products}', v_products);

    v_next_stock := (v_store_variant->>'stock')::integer + p_direction * v_qty;
    v_movements := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'date', to_char(timezone('America/Fortaleza', now()), 'YYYY-MM-DD'),
      'product', v_product->>'name',
      'variant', concat(v_variant->>'color', ' · ', v_variant->>'size'),
      'qty', p_direction * v_qty,
      'reason', p_reason,
      'stockAfter', v_next_stock
    )) || v_movements;
  end loop;

  v_state := jsonb_set(v_state, '{movements}', v_movements);
  update public.trama_catalogs
    set products = v_catalog.products, updated_at = now()
    where id = v_catalog.id;
  update public.trama_store_state
    set state = v_state, revision = revision + 1, updated_at = now()
    where user_id = v_catalog.user_id;
end;
$$;

revoke all on function public.trama_apply_catalog_order_stock(uuid,jsonb,integer,text) from public, anon, authenticated;

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
      where orders.catalog_id=v_catalog.id
        and orders.status in ('Novo','Em atendimento')
        and not orders.stock_applied
        and item->>'variantId'=v_line->>'variantId';
    if v_qty + v_reserved > (v_variant->>'stock')::integer then raise exception 'Estoque insuficiente para %, % %.', v_product->>'name', v_variant->>'color', v_variant->>'size'; end if;
    v_total_qty := v_total_qty + v_qty;
    v_total := v_total + v_qty * (v_product->>'price')::integer;
    v_items := v_items || jsonb_build_array(jsonb_build_object('productId',v_product->>'id','variantId',v_variant->>'id','name',v_product->>'name','color',v_variant->>'color','size',v_variant->>'size','qty',v_qty,'unitPrice',(v_product->>'price')::integer,'total',v_qty*(v_product->>'price')::integer));
  end loop;
  if exists(select 1 from jsonb_array_elements(v_catalog.products) product where (product->>'minimum')::integer > 0 and coalesce((select sum((item->>'qty')::integer) from jsonb_array_elements(v_items) item where item->>'productId'=product->>'id'),0) between 1 and (product->>'minimum')::integer-1) then raise exception 'Um produto não atingiu a quantidade mínima configurada.'; end if;
  if v_total_qty < v_catalog.minimum_qty or v_total < v_catalog.minimum_value then raise exception 'O pedido não atingiu o mínimo configurado pela loja.'; end if;
  v_customer := jsonb_build_object('name',left(trim(p_customer->>'name'),120),'whatsapp',v_phone,'city',left(trim(p_customer->>'city'),100),'uf',upper(trim(p_customer->>'uf')),'document',v_document);
  select coalesce(max(number),1000)+1 into v_number from public.trama_catalog_orders where catalog_id=v_catalog.id;
  perform public.trama_apply_catalog_order_stock(v_catalog.id, v_items, -1, 'Pedido do catálogo #' || v_number);
  insert into public.trama_catalog_orders(request_id,catalog_id,user_id,number,customer,items,total_qty,total,stock_applied)
    values(p_request_id,v_catalog.id,v_catalog.user_id,v_number,v_customer,v_items,v_total_qty,v_total,true)
    returning * into v_order;
  return jsonb_build_object('order',to_jsonb(v_order),'store_name',v_catalog.store_name,'whatsapp',v_catalog.whatsapp);
end;
$$;

revoke all on function public.trama_submit_catalog_order(text,uuid,jsonb,jsonb) from public;
grant execute on function public.trama_submit_catalog_order(text,uuid,jsonb,jsonb) to anon, authenticated;

create or replace function public.trama_update_catalog_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.trama_catalog_orders%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Entre para atualizar o pedido.'; end if;
  if p_status not in ('Novo','Em atendimento','Finalizado','Cancelado') then raise exception 'Situação inválida.'; end if;
  select * into v_order from public.trama_catalog_orders
    where id = p_order_id and user_id = v_user_id
    for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v_order.status = p_status then return to_jsonb(v_order); end if;

  if p_status = 'Cancelado' and v_order.stock_applied then
    perform public.trama_apply_catalog_order_stock(v_order.catalog_id, v_order.items, 1, 'Cancelamento do pedido do catálogo #' || v_order.number);
    v_order.stock_applied := false;
  elsif v_order.status = 'Cancelado' and p_status <> 'Cancelado' and not v_order.stock_applied then
    perform public.trama_apply_catalog_order_stock(v_order.catalog_id, v_order.items, -1, 'Reativação do pedido do catálogo #' || v_order.number);
    v_order.stock_applied := true;
  end if;

  update public.trama_catalog_orders
    set status = p_status, stock_applied = v_order.stock_applied, updated_at = now()
    where id = v_order.id
    returning * into v_order;
  return to_jsonb(v_order);
end;
$$;

revoke all on function public.trama_update_catalog_order_status(uuid,text) from public, anon;
grant execute on function public.trama_update_catalog_order_status(uuid,text) to authenticated;
