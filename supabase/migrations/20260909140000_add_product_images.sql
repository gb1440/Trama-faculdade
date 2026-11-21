do $migration$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'product-images',
    'product-images',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "trama_read_own_product_images" on storage.objects';
  execute $policy$
    create policy "trama_read_own_product_images" on storage.objects
    for select to authenticated
    using (
      bucket_id = 'product-images'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  $policy$;

  execute 'drop policy if exists "trama_upload_own_product_images" on storage.objects';
  execute $policy$
    create policy "trama_upload_own_product_images" on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'product-images'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  $policy$;

  execute 'drop policy if exists "trama_update_own_product_images" on storage.objects';
  execute $policy$
    create policy "trama_update_own_product_images" on storage.objects
    for update to authenticated
    using (
      bucket_id = 'product-images'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
      bucket_id = 'product-images'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  $policy$;

  execute 'drop policy if exists "trama_delete_own_product_images" on storage.objects';
  execute $policy$
    create policy "trama_delete_own_product_images" on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'product-images'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  $policy$;
end
$migration$;
