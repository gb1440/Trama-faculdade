do $$
declare
  demo_user constant uuid := '6820a0ec-240a-48c5-a93c-a7da20cc3221';
  demo_variants constant jsonb := '[
    {"id":"camiseta-preta-m","color":"Preta","size":"M","stock":10},
    {"id":"camiseta-preta-g","color":"Preta","size":"G","stock":5}
  ]';
  demo_product constant jsonb := jsonb_build_object(
    'id', 'camiseta-basica', 'name', 'Camiseta básica', 'code', 'TRM-000001',
    'category', 'Camisetas', 'photo', '', 'variants', demo_variants
  );
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', demo_user, 'authenticated', 'authenticated',
    'equipe@example.com', extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (user_id, provider_id, provider, identity_data, created_at, updated_at)
  values (demo_user, demo_user::text, 'email', jsonb_build_object(
    'sub', demo_user::text, 'email', 'equipe@example.com', 'email_verified', true
  ), now(), now()) on conflict (provider_id, provider) do nothing;

  insert into public.trama_store_state (user_id, state)
  values (demo_user, jsonb_build_object(
    'settings', '{"name":"Loja Escola","minQty":0,"minValue":0}'::jsonb,
    'products', jsonb_build_array(demo_product ||
      '{"cost":2500,"retail":5990,"wholesale":4490,"minimum":2,"orderMinimum":0,"catalogVisible":true}'::jsonb)
  )) on conflict (user_id) do nothing;

  insert into public.trama_catalogs (user_id, slug, store_name, city, whatsapp, price_mode, products)
  values (demo_user, 'loja-escola', 'Loja Escola', 'Fortaleza / CE', '85000000000', 'Varejo',
    jsonb_build_array(demo_product || '{"price":5990,"minimum":0}'::jsonb)
  ) on conflict (user_id) do nothing;

  perform setval('public.trama_sku_seq', 1, true) from public.trama_sku_seq where not is_called;
end $$;
