alter table public.trama_catalogs
  add column if not exists logo text not null default '';

alter table public.trama_catalogs
  drop constraint if exists trama_catalogs_logo_check;

alter table public.trama_catalogs
  add constraint trama_catalogs_logo_check check (
    logo = ''
    or logo ~ '^https://[^[:space:]]+$'
    or logo ~ '^storage:product-images/[0-9a-f-]{36}/catalog-logos/[0-9a-f-]{36}\.(jpg|png|webp|avif)$'
  );

grant select(logo) on public.trama_catalogs to anon;
