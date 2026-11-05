-- Lidl weekly offers. Isolated from OpenCesta/Mercadona and scoped to one household.
create table public.lidl_offer_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  store_key text not null check (length(trim(store_key)) > 0),
  store_name text not null check (length(trim(store_name)) > 0),
  store_postal_code text,
  captured_on date not null,
  captured_at timestamptz not null,
  source_url text not null,
  row_count integer not null check (row_count between 1 and 500),
  imported_at timestamptz not null default now(),
  unique (household_id, store_key, captured_on),
  unique (id, household_id)
);

create table public.lidl_offer_observations (
  snapshot_id uuid not null,
  household_id uuid not null,
  offer_id text not null,
  title text not null check (length(trim(title)) > 0),
  brand text,
  category text,
  offer_type text,
  redemption_channel text,
  product_ids text[] not null default '{}',
  start_validity_date timestamptz,
  end_validity_date timestamptz,
  price_box jsonb,
  image_url text,
  primary key (snapshot_id, offer_id),
  foreign key (snapshot_id, household_id)
    references public.lidl_offer_snapshots(id, household_id) on delete cascade,
  check (start_validity_date is null or end_validity_date is null or start_validity_date <= end_validity_date)
);

create index lidl_offer_snapshots_household_date_idx
  on public.lidl_offer_snapshots (household_id, captured_on desc);
create index lidl_offer_observations_household_snapshot_idx
  on public.lidl_offer_observations (household_id, snapshot_id);
create index lidl_offer_observations_title_idx
  on public.lidl_offer_observations (snapshot_id, lower(title));

alter table public.lidl_offer_snapshots enable row level security;
alter table public.lidl_offer_observations enable row level security;

revoke all on public.lidl_offer_snapshots, public.lidl_offer_observations from anon, authenticated;
grant select on public.lidl_offer_snapshots, public.lidl_offer_observations to authenticated;
grant all on public.lidl_offer_snapshots, public.lidl_offer_observations to service_role;

create policy lidl_offer_snapshots_household_read
  on public.lidl_offer_snapshots for select to authenticated
  using ((select private.is_household_member(household_id)));
create policy lidl_offer_observations_household_read
  on public.lidl_offer_observations for select to authenticated
  using ((select private.is_household_member(household_id)));

create or replace function public.publish_lidl_offer_snapshot(
  p_household_id uuid,
  p_store_key text,
  p_store_name text,
  p_store_postal_code text,
  p_captured_at timestamptz,
  p_source_url text,
  p_offers jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_count integer;
  v_unique_count integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if p_household_id is null
    or p_store_key is null or length(trim(p_store_key)) = 0
    or p_store_name is null or length(trim(p_store_name)) = 0
    or p_captured_at is null or p_source_url is null then
    raise exception 'invalid_snapshot_metadata';
  end if;
  if not exists (select 1 from public.households h where h.id = p_household_id) then
    raise exception 'household_not_found';
  end if;
  if jsonb_typeof(p_offers) <> 'array' then
    raise exception 'offers_must_be_array';
  end if;
  v_count := jsonb_array_length(p_offers);
  if v_count < 1 or v_count > 500 then
    raise exception 'invalid_offer_count: %', v_count;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_offers) as e(value)
    where jsonb_typeof(e.value) <> 'object'
      or nullif(trim(e.value ->> 'offer_id'), '') is null
      or nullif(trim(e.value ->> 'title'), '') is null
  ) then
    raise exception 'invalid_offer_record';
  end if;
  select count(distinct e.value ->> 'offer_id') into v_unique_count
  from jsonb_array_elements(p_offers) as e(value);
  if v_unique_count <> v_count then
    raise exception 'duplicate_offer_id';
  end if;

  insert into public.lidl_offer_snapshots (
    household_id, store_key, store_name, store_postal_code,
    captured_on, captured_at, source_url, row_count
  ) values (
    p_household_id, p_store_key, p_store_name, p_store_postal_code,
    (p_captured_at at time zone 'Europe/Madrid')::date,
    p_captured_at, p_source_url, v_count
  )
  on conflict (household_id, store_key, captured_on) do update
    set store_name = excluded.store_name,
        store_postal_code = excluded.store_postal_code,
        captured_at = excluded.captured_at,
        source_url = excluded.source_url,
        row_count = excluded.row_count,
        imported_at = now()
  returning id into v_snapshot_id;

  delete from public.lidl_offer_observations
  where snapshot_id = v_snapshot_id;

  insert into public.lidl_offer_observations (
    snapshot_id, household_id, offer_id, title, brand, category,
    offer_type, redemption_channel, product_ids, start_validity_date,
    end_validity_date, price_box, image_url
  )
  select
    v_snapshot_id, p_household_id, x.offer_id, x.title, x.brand, x.category,
    x.offer_type, x.redemption_channel, coalesce(x.product_ids, '{}'),
    x.start_validity_date, x.end_validity_date, x.price_box, x.image_url
  from jsonb_to_recordset(p_offers) as x(
    offer_id text, title text, brand text, category text,
    offer_type text, redemption_channel text, product_ids text[],
    start_validity_date timestamptz, end_validity_date timestamptz,
    price_box jsonb, image_url text
  );

  delete from public.lidl_offer_snapshots
  where household_id = p_household_id
    and store_key = p_store_key
    and captured_on < (p_captured_at at time zone 'Europe/Madrid')::date - 90;

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'household_id', p_household_id,
    'store_key', p_store_key,
    'captured_on', (p_captured_at at time zone 'Europe/Madrid')::date,
    'row_count', v_count
  );
end;
$$;

revoke all on function public.publish_lidl_offer_snapshot(uuid, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_lidl_offer_snapshot(uuid, text, text, text, timestamptz, text, jsonb) to service_role;

comment on table public.lidl_offer_snapshots is
  'Capturas privadas de ofertas Lidl por hogar y tienda. No es un catálogo completo ni un precio habitual.';
comment on table public.lidl_offer_observations is
  'Ofertas Lidl con vigencia, canal, imagen y priceBox original. product_ids son IDs internos, nunca EAN.';
