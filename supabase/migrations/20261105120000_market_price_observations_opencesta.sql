create table public.market_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'opencesta' check (source = 'opencesta'),
  source_license text not null default 'ODbL-1.0' check (source_license = 'ODbL-1.0'),
  source_url text not null,
  source_revision text not null,
  chain text not null check (chain = 'mercadona'),
  zone text not null,
  captured_at date not null,
  imported_at timestamptz not null default now(),
  row_count integer not null check (row_count > 0),
  unique (source, chain, zone, captured_at)
);

create table public.market_price_observations (
  snapshot_id uuid not null references public.market_price_snapshots(id) on delete cascade,
  sku text not null,
  product_name text not null,
  brand text,
  ean text,
  category text not null default '',
  subcategory text not null default '',
  unit_price numeric(12,4) not null check (unit_price >= 0),
  reference_price numeric(12,4) check (reference_price is null or reference_price >= 0),
  reference_format text,
  unit_size numeric(12,4),
  size_format text,
  tax_pct numeric(6,3),
  is_pack boolean not null default false,
  is_discounted boolean not null default false,
  product_url text,
  thumbnail_url text,
  captured_at date not null,
  captured_at_ts timestamptz,
  primary key (snapshot_id, sku)
);

create index market_price_observations_name_idx
  on public.market_price_observations (snapshot_id, lower(product_name));
create index market_price_snapshots_lookup_idx
  on public.market_price_snapshots (chain, zone, captured_at desc);

create table public.market_price_staging (
  import_id uuid not null,
  chain text not null,
  zone text not null,
  sku text not null,
  product_name text not null,
  brand text,
  ean text,
  category text not null default '',
  subcategory text not null default '',
  unit_price numeric(12,4) not null check (unit_price >= 0),
  reference_price numeric(12,4) check (reference_price is null or reference_price >= 0),
  reference_format text,
  unit_size numeric(12,4),
  size_format text,
  tax_pct numeric(6,3),
  is_pack boolean not null default false,
  is_discounted boolean not null default false,
  product_url text,
  thumbnail_url text,
  captured_at date not null,
  captured_at_ts timestamptz,
  created_at timestamptz not null default now(),
  primary key (import_id, sku)
);

alter table public.market_price_snapshots enable row level security;
alter table public.market_price_observations enable row level security;
alter table public.market_price_staging enable row level security;

revoke all on public.market_price_snapshots, public.market_price_observations, public.market_price_staging from anon, authenticated;
grant select on public.market_price_snapshots, public.market_price_observations to anon, authenticated;
grant all on public.market_price_snapshots, public.market_price_observations, public.market_price_staging to service_role;

create policy market_price_snapshots_public_read on public.market_price_snapshots
  for select to anon, authenticated using (true);
create policy market_price_observations_public_read on public.market_price_observations
  for select to anon, authenticated using (true);

comment on table public.market_price_snapshots is
  'Snapshots del dataset OpenCesta. Base de datos derivada bajo ODbL-1.0; atribución: https://github.com/ruvelro/opencesta';
comment on table public.market_price_observations is
  'Observaciones de precios de OpenCesta. Datos ODbL-1.0; mantener atribución y acceso a la base derivada.';
comment on table public.market_price_staging is
  'Zona de carga privada; no se publica hasta completar y validar el snapshot.';

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
    captured_at, captured_at_ts
  )
  select
    v_snapshot_id, sku, product_name, brand, ean, category, subcategory,
    unit_price, reference_price, reference_format, unit_size, size_format,
    tax_pct, is_pack, is_discounted, product_url, thumbnail_url,
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

revoke all on function public.publish_market_price_snapshot(uuid, text, text, text, text, date, integer) from public, anon, authenticated;
grant execute on function public.publish_market_price_snapshot(uuid, text, text, text, text, date, integer) to service_role;
