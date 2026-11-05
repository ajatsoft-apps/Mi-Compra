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
    where s.source = 'opencesta'
      and s.chain = 'mercadona'
      and s.zone = p_zone
      and s.captured_at >= current_date - 14
    order by s.captured_at desc
    limit 1
  ),
  mercadona_products as (
    select
      'mercadona'::text as supermarket,
      p.sku::text as product_id,
      p.product_name,
      p.brand,
      concat_ws(
        ' · ',
        case when p.is_pack then 'Pack' end,
        nullif(concat_ws(' ', nullif(p.unit_size::text, ''), nullif(p.size_format, '')), '')
      ) as format,
      p.category,
      p.unit_price,
      null::jsonb as price_box,
      p.thumbnail_url as image_url,
      concat_ws(
        ' · ',
        nullif(p.brand, ''),
        case when p.is_pack then 'Pack' end,
        nullif(concat_ws(' ', nullif(p.unit_size::text, ''), nullif(p.size_format, '')), '')
      ) as note,
      null::text as store_name,
      m.captured_at::timestamp at time zone 'UTC' as captured_at
    from public.market_price_observations p
    join market_snapshot m on m.id = p.snapshot_id
    where not exists (
      select 1
      from query_tokens t
      where extensions.unaccent(lower(concat_ws(' ', p.product_name, p.brand))) not like '%' || t.token || '%'
    )
  ),
  latest_lidl_snapshots as (
    select distinct on (s.store_key)
      s.id,
      s.store_key,
      s.store_name,
      s.captured_at
    from public.lidl_offer_snapshots s
    where s.captured_at >= now() - interval '14 days'
    order by s.store_key, s.captured_at desc
  ),
  lidl_offer_rows as (
    select
      o.offer_id,
      o.title,
      o.brand,
      o.category,
      o.product_ids,
      o.price_box,
      o.image_url,
      s.store_name,
      s.captured_at,
      case
        when jsonb_typeof(o.price_box -> 'largePartNumeric') = 'number'
          and o.price_box ->> 'priceSymbol' in ('€', '€/kg', '€/L', '€/l')
        then (o.price_box ->> 'largePartNumeric')::numeric
        else null
      end as parsed_price
    from public.lidl_offer_observations o
    join latest_lidl_snapshots s on s.id = o.snapshot_id
    where (o.end_validity_date is null or o.end_validity_date >= now())
      and not exists (
        select 1
        from query_tokens t
        where extensions.unaccent(lower(concat_ws(' ', o.title, o.brand))) not like '%' || t.token || '%'
      )
  ),
  lidl_products as (
    select
      'lidl'::text as supermarket,
      min(o.offer_id)::text as product_id,
      o.title as product_name,
      o.brand,
      concat_ws(
        ' · ',
        nullif(string_agg(distinct o.store_name, ', ' order by o.store_name), ''),
        nullif(o.category, 'Store'),
        nullif(o.price_box ->> 'priceSymbol', '')
      ) as format,
      o.category,
      o.parsed_price as unit_price,
      o.price_box,
      o.image_url,
      concat_ws(
        ' · ',
        nullif(o.brand, ''),
        nullif(o.category, 'Store'),
        nullif(o.price_box ->> 'discountMessage', ''),
        nullif(string_agg(distinct o.store_name, ', ' order by o.store_name), '')
      ) as note,
      string_agg(distinct o.store_name, ', ' order by o.store_name) as store_name,
      max(o.captured_at) as captured_at
    from lidl_offer_rows o
    group by o.title, o.brand, o.category, o.product_ids, o.price_box, o.image_url, o.parsed_price
  ),
  candidates as (
    select * from mercadona_products
    union all
    select * from lidl_products
  ),
  ranked as (
    select
      candidates.*,
      row_number() over (
        partition by supermarket
        order by unit_price nulls last, product_name, product_id
      ) as supermarket_position
    from candidates
    where char_length(trim(coalesce(p_query, ''))) >= 2
  )
  select
    supermarket,
    product_id,
    product_name,
    brand,
    format,
    category,
    unit_price,
    price_box,
    image_url,
    note,
    store_name,
    captured_at
  from ranked
  where supermarket_position <= 10
  order by unit_price nulls last, supermarket, product_name;
$$;

revoke all on function public.search_shopping_product_suggestions(text, text) from public;
grant execute on function public.search_shopping_product_suggestions(text, text) to anon, authenticated;

comment on function public.search_shopping_product_suggestions(text, text) is
  'Búsqueda de sugerencias con hasta 10 productos por supermercado. Deduplica ofertas Lidl repetidas entre tiendas y solo convierte priceBox a número cuando priceSymbol y largePartNumeric identifican un precio inequívoco.';
