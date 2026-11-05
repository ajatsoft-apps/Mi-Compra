alter table public.market_price_observations
  add column if not exists origin text,
  add column if not exists packaging text,
  add column if not exists legal_name text,
  add column if not exists enriched_at date;

alter table public.market_price_staging
  add column if not exists origin text,
  add column if not exists packaging text,
  add column if not exists legal_name text,
  add column if not exists enriched_at date;

create or replace function public.publish_market_price_snapshot(
  p_import_id uuid,
  p_source_revision text,
  p_source_url text,
  p_chain text,
  p_zone text,
  p_captured_at date,
  p_expected_count integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_snapshot_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;

  select count(*) into v_count
  from public.market_price_staging
  where import_id = p_import_id;

  if v_count < 500 or v_count <> p_expected_count then
    raise exception 'incomplete_snapshot: expected %, received %', p_expected_count, v_count;
  end if;

  if exists (
    select 1 from public.market_price_staging
    where import_id = p_import_id
      and (chain <> p_chain or zone <> p_zone or captured_at <> p_captured_at)
  ) then
    raise exception 'snapshot_metadata_mismatch';
  end if;

  insert into public.market_price_snapshots (
    source, source_license, source_url, source_revision, chain, zone, captured_at, row_count
  ) values (
    'opencesta', 'ODbL-1.0', p_source_url, p_source_revision, p_chain, p_zone, p_captured_at, v_count
  )
  on conflict (source, chain, zone, captured_at) do update
    set source_url = excluded.source_url,
        source_revision = excluded.source_revision,
        imported_at = now(),
        row_count = excluded.row_count
  returning id into v_snapshot_id;

  delete from public.market_price_observations where snapshot_id = v_snapshot_id;

  insert into public.market_price_observations (
    snapshot_id, sku, product_name, brand, ean, category, subcategory,
    unit_price, reference_price, reference_format, unit_size, size_format,
    tax_pct, is_pack, is_discounted, product_url, thumbnail_url,
    origin, packaging, legal_name, enriched_at,
    captured_at, captured_at_ts
  )
  select
    v_snapshot_id, sku, product_name, brand, ean, category, subcategory,
    unit_price, reference_price, reference_format, unit_size, size_format,
    tax_pct, is_pack, is_discounted, product_url, thumbnail_url,
    origin, packaging, legal_name, enriched_at,
    captured_at, captured_at_ts
  from public.market_price_staging
  where import_id = p_import_id;

  delete from public.market_price_staging where import_id = p_import_id;

  delete from public.market_price_snapshots
  where source = 'opencesta'
    and chain = p_chain
    and zone = p_zone
    and captured_at < p_captured_at - 180;

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'source', 'opencesta',
    'chain', p_chain,
    'zone', p_zone,
    'captured_at', p_captured_at,
    'row_count', v_count
  );
end;
$$;
