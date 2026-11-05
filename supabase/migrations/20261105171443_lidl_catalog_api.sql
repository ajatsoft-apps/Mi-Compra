create table if not exists public.lidl_catalog_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'lidl_es_search_and_pages',
  status text not null default 'staging' check (status in ('staging', 'published', 'archived', 'failed')),
  region_name text not null default 'Castellón',
  price_region_id text not null,
  reported_total integer not null default 0,
  expected_count integer not null default 0,
  row_count integer not null default 0,
  source_pages text[] not null default '{}',
  captured_at timestamptz not null default now(),
  published_at timestamptz,
  error_message text
);

create index if not exists lidl_catalog_snapshots_latest_idx
  on public.lidl_catalog_snapshots (status, captured_at desc);

create table if not exists public.lidl_catalog_observations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.lidl_catalog_snapshots(id) on delete cascade,
  product_id text not null,
  article_code text,
  product_name text not null,
  brand text,
  category text,
  description text,
  packaging text,
  unit text not null default 'ud.',
  unit_price numeric(12,4),
  old_price numeric(12,4),
  discount_pct numeric(6,2),
  requires_lidl_plus boolean not null default false,
  base_price_text text,
  price_box jsonb,
  valid_from timestamptz not null default '1970-01-01T00:00:00Z',
  valid_until timestamptz,
  image_url text,
  product_url text,
  online_available boolean,
  store_available boolean,
  availability_indicator integer,
  ean text,
  internal_codes text[] not null default '{}',
  source text not null check (source in ('online', 'weekly', 'category')),
  source_page text not null,
  price_type text not null check (price_type in ('online', 'regular', 'lidlplus', 'future_regular', 'future_lidlplus', 'no_price')),
  captured_at timestamptz not null default now(),
  unique (snapshot_id, product_id, source, source_page, price_type, valid_from)
);

create index if not exists lidl_catalog_observations_snapshot_product_idx
  on public.lidl_catalog_observations (snapshot_id, product_id);
create index if not exists lidl_catalog_observations_article_code_idx
  on public.lidl_catalog_observations (article_code);
create index if not exists lidl_catalog_observations_validity_idx
  on public.lidl_catalog_observations (valid_from, valid_until);

alter table public.lidl_catalog_snapshots enable row level security;
alter table public.lidl_catalog_observations enable row level security;

drop policy if exists lidl_catalog_snapshots_public_read on public.lidl_catalog_snapshots;
create policy lidl_catalog_snapshots_public_read
  on public.lidl_catalog_snapshots for select to anon, authenticated
  using (status = 'published');

drop policy if exists lidl_catalog_observations_public_read on public.lidl_catalog_observations;
create policy lidl_catalog_observations_public_read
  on public.lidl_catalog_observations for select to anon, authenticated
  using (exists (
    select 1 from public.lidl_catalog_snapshots s
    where s.id = lidl_catalog_observations.snapshot_id and s.status = 'published'
  ));

grant select on public.lidl_catalog_snapshots to anon, authenticated;
grant select on public.lidl_catalog_observations to anon, authenticated;
grant all on public.lidl_catalog_snapshots to service_role;
grant all on public.lidl_catalog_observations to service_role;

create or replace function public.publish_lidl_catalog_snapshot(
  p_snapshot_id uuid,
  p_expected_count integer,
  p_minimum_count integer default 6000
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_status text;
begin
  select count(*)::integer into v_count
  from public.lidl_catalog_observations
  where snapshot_id = p_snapshot_id;

  select status into v_status
  from public.lidl_catalog_snapshots
  where id = p_snapshot_id
  for update;

  if not found then
    raise exception 'Lidl catalog snapshot % does not exist', p_snapshot_id;
  end if;
  if v_status <> 'staging' then
    raise exception 'Lidl catalog snapshot % is not in staging state', p_snapshot_id;
  end if;
  if v_count <> p_expected_count then
    raise exception 'Lidl catalog row count mismatch: expected %, found %', p_expected_count, v_count;
  end if;
  if v_count < p_minimum_count then
    raise exception 'Lidl catalog import is incomplete: minimum %, found %', p_minimum_count, v_count;
  end if;

  update public.lidl_catalog_snapshots
  set status = 'published', expected_count = p_expected_count, row_count = v_count,
      published_at = now(), error_message = null
  where id = p_snapshot_id;

  update public.lidl_catalog_snapshots
  set status = 'archived'
  where id <> p_snapshot_id and status = 'published'
    and captured_at < now() - interval '45 days';

  return jsonb_build_object('snapshot_id', p_snapshot_id, 'row_count', v_count, 'published_at', now());
end;
$$;

revoke all on function public.publish_lidl_catalog_snapshot(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.publish_lidl_catalog_snapshot(uuid, integer, integer) to service_role;

create or replace function public.search_shopping_product_suggestions(
  p_query text,
  p_zone text default 'vlc1'
)
returns table (
  supermarket text,
  product_id text,
  product_name text,
  brand text,
  format text,
  category text,
  unit_price numeric,
  price_box jsonb,
  image_url text,
  note text,
  store_name text,
  captured_at timestamptz
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with query_tokens as (
    select extensions.unaccent(lower(token)) as token
    from regexp_split_to_table(trim(coalesce(p_query, '')), '\s+') as token
    where length(token) > 0
  ),
  market_snapshot as (
    select s.id, s.captured_at
    from public.market_price_snapshots s
    where s.source = 'opencesta' and s.chain = 'mercadona'
      and s.zone = p_zone and s.captured_at >= current_date - 14
    order by s.captured_at desc limit 1
  ),
  mercadona_products as (
    select
      'mercadona'::text as supermarket,
      p.sku::text as product_id,
      p.product_name,
      p.brand,
      concat_ws(' · ', case when p.is_pack then 'Pack' end,
        nullif(concat_ws(' ', nullif(p.unit_size::text, ''), nullif(p.size_format, '')), '')) as format,
      p.category,
      p.unit_price,
      null::jsonb as price_box,
      p.thumbnail_url as image_url,
      concat_ws(' · ', nullif(p.brand, ''), case when p.is_pack then 'Pack' end,
        nullif(concat_ws(' ', nullif(p.unit_size::text, ''), nullif(p.size_format, '')), '')) as note,
      null::text as store_name,
      m.captured_at::timestamp at time zone 'UTC' as captured_at
    from public.market_price_observations p
    join market_snapshot m on m.id = p.snapshot_id
    where not exists (
      select 1 from query_tokens t
      where extensions.unaccent(lower(concat_ws(' ', p.product_name, p.brand))) not like '%' || t.token || '%'
    )
  ),
  latest_lidl_snapshots as (
    select distinct on (s.store_key) s.id, s.store_key, s.store_name, s.captured_at
    from public.lidl_offer_snapshots s
    where s.captured_at >= now() - interval '14 days'
    order by s.store_key, s.captured_at desc
  ),
  latest_lidl_catalog_snapshot as (
    select s.id, s.captured_at
    from public.lidl_catalog_snapshots s
    where s.status = 'published'
    order by s.captured_at desc limit 1
  ),
  lidl_catalog_ranked as (
    select
      coalesce(nullif(o.article_code, ''), o.product_id) as product_id,
      o.article_code, o.product_name, nullif(nullif(o.brand, ''), '--') as brand,
      o.category, o.packaging, o.unit, o.unit_price, o.old_price, o.discount_pct,
      o.requires_lidl_plus, o.base_price_text, o.price_box, o.image_url, o.product_url,
      o.source, o.source_page, o.valid_from, o.valid_until, s.captured_at,
      row_number() over (
        partition by coalesce(nullif(o.article_code, ''), o.product_id)
        order by (o.unit_price is null),
          case when o.source in ('weekly', 'category') then 0 else 1 end,
          o.requires_lidl_plus desc, o.unit_price asc nulls last, s.captured_at desc
      ) as product_position
    from public.lidl_catalog_observations o
    join latest_lidl_catalog_snapshot s on s.id = o.snapshot_id
    where o.valid_from <= now()
      and (o.valid_until is null or o.valid_until > now())
      and o.unit_price is not null
      and not exists (
        select 1 from query_tokens t
        where extensions.unaccent(lower(concat_ws(' ', o.product_name, o.brand, o.category))) not like '%' || t.token || '%'
      )
  ),
  lidl_catalog_products as (
    select
      'lidl'::text as supermarket, product_id, product_name, brand,
      concat_ws(' · ', nullif(packaging, ''), case when requires_lidl_plus then 'Con Lidl Plus' end,
        case when source = 'online' then 'Precio online' else 'En tienda' end, nullif(base_price_text, '')) as format,
      category, unit_price,
      coalesce(price_box, jsonb_build_object(
        'priceSymbol', case when unit = 'kg' then '€/kg' else '€' end,
        'largePartNumeric', unit_price, 'smallPartNumeric', old_price,
        'discountMessage', case when discount_pct is not null and discount_pct > 0 then '-' || discount_pct::text || '%' else null end
      )) as price_box,
      image_url,
      concat_ws(' · ', nullif(brand, ''), case when requires_lidl_plus then 'Precio con Lidl Plus' end,
        case when source = 'online' then 'Precio de tienda online' else 'Oferta de tienda' end) as note,
      case when source = 'online' then 'Lidl online' else 'Lidl tienda' end as store_name,
      captured_at,
      case when source = 'online' then 2 else 1 end as source_priority,
      packaging,
      requires_lidl_plus
    from lidl_catalog_ranked
    where product_position = 1
  ),
  lidl_offer_rows as (
    select
      o.offer_id, o.title, nullif(nullif(o.brand, ''), '--') as brand, o.category, o.product_ids,
      (select value from unnest(o.product_ids) as ids(value) limit 1) as article_code,
      o.price_box, o.image_url, s.store_name, s.captured_at,
      case when jsonb_typeof(o.price_box -> 'largePartNumeric') = 'number'
        and o.price_box ->> 'priceSymbol' in ('€', '€/kg', '€/L', '€/l')
        then (o.price_box ->> 'largePartNumeric')::numeric else null end as parsed_price
    from public.lidl_offer_observations o
    join latest_lidl_snapshots s on s.id = o.snapshot_id
    where (o.end_validity_date is null or o.end_validity_date >= now())
      and not exists (
        select 1 from query_tokens t
        where extensions.unaccent(lower(concat_ws(' ', o.title, o.brand))) not like '%' || t.token || '%'
      )
  ),
  lidl_offer_products as (
    select
      'lidl'::text as supermarket,
      coalesce(nullif(o.article_code, ''), min(o.offer_id)::text) as product_id,
      coalesce(c.product_name, o.title) as product_name,
      coalesce(c.brand, o.brand) as brand,
      concat_ws(' · ', nullif(c.packaging, ''),
        nullif(string_agg(distinct o.store_name, ', ' order by o.store_name), ''),
        nullif(o.category, 'Store'), nullif(o.price_box ->> 'priceSymbol', '')) as format,
      coalesce(c.category, nullif(o.category, 'Store')) as category,
      o.parsed_price as unit_price, o.price_box,
      coalesce(c.image_url, o.image_url) as image_url,
      concat_ws(' · ', nullif(c.brand, ''), case when c.requires_lidl_plus then 'Precio con Lidl Plus' end,
        nullif(o.price_box ->> 'discountMessage', ''),
        nullif(string_agg(distinct o.store_name, ', ' order by o.store_name), '')) as note,
      string_agg(distinct o.store_name, ', ' order by o.store_name) as store_name,
      max(o.captured_at) as captured_at,
      0 as source_priority
    from lidl_offer_rows o
    left join lidl_catalog_products c on c.product_id = o.article_code
    group by o.article_code, o.title, o.brand, o.category, o.product_ids, o.price_box, o.image_url, o.parsed_price,
      c.product_name, c.brand, c.packaging, c.category, c.image_url, c.requires_lidl_plus
  ),
  lidl_candidates as (
    select supermarket, product_id, product_name, brand, format, category,
      unit_price, price_box, image_url, note, store_name, captured_at, source_priority
    from lidl_offer_products
    union all
    select supermarket, product_id, product_name, brand, format, category,
      unit_price, price_box, image_url, note, store_name, captured_at, source_priority
    from lidl_catalog_products
  ),
  lidl_deduped as (
    select lidl_candidates.*,
      row_number() over (
        partition by product_id
        order by (unit_price is null), source_priority, unit_price nulls last, product_name
      ) as duplicate_position
    from lidl_candidates
  ),
  candidates as (
    select supermarket, product_id, product_name, brand, format, category, unit_price, price_box, image_url, note, store_name, captured_at
    from mercadona_products
    union all
    select supermarket, product_id, product_name, brand, format, category, unit_price, price_box, image_url, note, store_name, captured_at
    from lidl_deduped where duplicate_position = 1
  ),
  ranked as (
    select candidates.*,
      row_number() over (partition by supermarket order by unit_price nulls last, product_name, product_id) as supermarket_position
    from candidates
    where char_length(trim(coalesce(p_query, ''))) >= 2
  )
  select supermarket, product_id, product_name, brand, format, category, unit_price, price_box, image_url, note, store_name, captured_at
  from ranked
  where supermarket_position <= 10
  order by unit_price nulls last, supermarket, product_name;
$$;

revoke all on function public.search_shopping_product_suggestions(text, text) from public;
grant execute on function public.search_shopping_product_suggestions(text, text) to anon, authenticated;

comment on function public.search_shopping_product_suggestions(text, text) is
  'Busca sugerencias Mercadona y Lidl combinando ofertas por tienda, catálogo online y páginas semanales de Lidl; hasta 10 resultados por supermercado.';
