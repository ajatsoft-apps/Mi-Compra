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
      and o.source in ('weekly', 'category')
      and not exists (
        select 1 from query_tokens t
        where extensions.unaccent(lower(concat_ws(' ', o.product_name, o.brand, o.category))) not like '%' || t.token || '%'
      )
  ),
  lidl_catalog_products as (
    select
      'lidl'::text as supermarket, product_id, product_name, brand,
      concat_ws(' · ', nullif(packaging, ''), case when requires_lidl_plus then 'Con Lidl Plus' end,
        'En tienda', case when unit_price is null then 'Precio no publicado' end,
        nullif(base_price_text, '')) as format,
      category, unit_price,
      case when unit_price is null then null else coalesce(price_box, jsonb_build_object(
        'priceSymbol', case when unit = 'kg' then '€/kg' else '€' end,
        'largePartNumeric', unit_price, 'smallPartNumeric', old_price,
        'discountMessage', case when discount_pct is not null and discount_pct > 0 then '-' || discount_pct::text || '%' else null end
      )) end as price_box,
      image_url,
      concat_ws(' · ', nullif(brand, ''), case when requires_lidl_plus then 'Precio con Lidl Plus' end,
        case when unit_price is null then 'Producto de tienda · Precio no publicado' else 'Oferta de tienda' end) as note,
      'Lidl tienda'::text as store_name,
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
  'Busca productos Lidl de páginas públicas de alimentación aunque no publiquen precio; mantiene ofertas Lidl Plus y catálogo Mercadona, excluyendo bazar online.';
