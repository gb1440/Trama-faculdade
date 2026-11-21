-- Corrige o cancelamento de pedidos do catálogo que esgotaram uma variação.
--
-- Antes: a função procurava cada peça em trama_catalogs.products. Como o gatilho
-- trama_sync_catalog_products tira do catálogo as variações com estoque 0 (e os
-- produtos ocultos), cancelar um pedido que levou as últimas peças falhava com
-- "Uma peça escolhida não está mais disponível." e o estoque nunca voltava.
--
-- Agora o estoque principal (trama_store_state) é a única referência. O catálogo
-- é reconstruído pelo gatilho trama_store_state_sync_catalog quando o estado muda.
-- Na devolução (+1), uma variação apagada da loja é ignorada em vez de travar o
-- cancelamento.

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
    if v_qty is null or v_qty < 1 then raise exception 'Quantidade inválida no pedido.'; end if;

    v_store_product := null;
    v_store_variant := null;
    select value into v_store_product
      from jsonb_array_elements(v_state->'products')
      where value->>'id' = v_line->>'productId';
    select value into v_store_variant
      from jsonb_array_elements(v_store_product->'variants')
      where value->>'id' = v_line->>'variantId';

    if v_store_product is null or v_store_variant is null then
      if p_direction = 1 then
        continue;
      end if;
      raise exception 'Uma peça escolhida não está mais disponível.';
    end if;

    if p_direction = -1 and (v_store_variant->>'stock')::integer < v_qty then
      raise exception 'Estoque insuficiente para %, % %.',
        v_store_product->>'name', v_store_variant->>'color', v_store_variant->>'size';
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
    from jsonb_array_elements(v_state->'products') with ordinality product(value, ordinality);
    v_state := jsonb_set(v_state, '{products}', v_products);

    v_next_stock := (v_store_variant->>'stock')::integer + p_direction * v_qty;
    v_movements := jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'date', to_char(timezone('America/Fortaleza', now()), 'YYYY-MM-DD'),
      'product', v_store_product->>'name',
      'variant', concat(v_store_variant->>'color', ' · ', v_store_variant->>'size'),
      'qty', p_direction * v_qty,
      'reason', p_reason,
      'stockAfter', v_next_stock
    )) || v_movements;
  end loop;

  v_state := jsonb_set(v_state, '{movements}', v_movements);
  -- O gatilho trama_store_state_sync_catalog reconstrói trama_catalogs.products.
  update public.trama_store_state
    set state = v_state, revision = revision + 1, updated_at = now()
    where user_id = v_catalog.user_id;
end;
$$;

revoke all on function public.trama_apply_catalog_order_stock(uuid,jsonb,integer,text) from public, anon, authenticated;
