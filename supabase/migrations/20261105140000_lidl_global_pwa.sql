-- Lidl weekly offers are shared app-wide, independently of household membership.
drop function if exists public.publish_lidl_offer_snapshot(uuid, text, text, text, timestamptz, text, jsonb);

drop policy if exists lidl_offer_snapshots_household_read on public.lidl_offer_snapshots;
drop policy if exists lidl_offer_observations_household_read on public.lidl_offer_observations;

drop index if exists public.lidl_offer_snapshots_household_date_idx;
drop index if exists public.lidl_offer_observations_household_snapshot_idx;
drop index if exists public.lidl_offer_observations_snapshot_household_fk_idx;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.lidl_offer_snapshots'::regclass
      and conname = 'lidl_offer_snapshots_household_id_store_key_captured_on_key'
  ) then
    alter table public.lidl_offer_snapshots
      drop constraint lidl_offer_snapshots_household_id_store_key_captured_on_key;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.lidl_offer_observations'::regclass
      and conname = 'lidl_offer_observations_snapshot_id_household_id_fkey'
  ) then
    alter table public.lidl_offer_observations
      drop constraint lidl_offer_observations_snapshot_id_household_id_fkey;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.lidl_offer_snapshots'::regclass
      and conname = 'lidl_offer_snapshots_id_household_id_key'
  ) then
    alter table public.lidl_offer_snapshots
      drop constraint lidl_offer_snapshots_id_household_id_key;
  end if;
end;
$$;

alter table public.lidl_offer_observations
  drop column if exists household_id;
alter table public.lidl_offer_snapshots
  drop column if exists household_id;

with ranked as (
  select id, row_number() over (
    partition by store_key, captured_on
    order by captured_at desc, imported_at desc, id
  ) as position
  from public.lidl_offer_snapshots
)
delete from public.lidl_offer_snapshots s
using ranked r
where s.id = r.id and r.position > 1;

alter table public.lidl_offer_snapshots
  add constraint lidl_offer_snapshots_store_day_key unique (store_key, captured_on);

alter table public.lidl_offer_observations
  add constraint lidl_offer_observations_snapshot_id_fkey
  foreign key (snapshot_id) references public.lidl_offer_snapshots(id) on delete cascade;

create index if not exists lidl_offer_observations_snapshot_idx
  on public.lidl_offer_observations (snapshot_id);
create index if not exists lidl_offer_observations_title_idx
  on public.lidl_offer_observations (snapshot_id, lower(title));

grant select on public.lidl_offer_snapshots, public.lidl_offer_observations to anon, authenticated;
revoke insert, update, delete on public.lidl_offer_snapshots, public.lidl_offer_observations from anon, authenticated;
grant all on public.lidl_offer_snapshots, public.lidl_offer_observations to service_role;

create policy lidl_offer_snapshots_public_read
  on public.lidl_offer_snapshots for select to anon, authenticated
  using (true);
create policy lidl_offer_observations_public_read
  on public.lidl_offer_observations for select to anon, authenticated
  using (true);

create function public.publish_lidl_offer_snapshot(
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
  if p_store_key is null or length(trim(p_store_key)) = 0
    or p_store_name is null or length(trim(p_store_name)) = 0
    or p_captured_at is null or p_source_url is null then
    raise exception 'invalid_snapshot_metadata';
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
    store_key, store_name, store_postal_code,
    captured_on, captured_at, source_url, row_count
  ) values (
    p_store_key, p_store_name, p_store_postal_code,
    (p_captured_at at time zone 'Europe/Madrid')::date,
    p_captured_at, p_source_url, v_count
  )
  on conflict (store_key, captured_on) do update
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
    snapshot_id, offer_id, title, brand, category,
    offer_type, redemption_channel, product_ids, start_validity_date,
    end_validity_date, price_box, image_url
  )
  select
    v_snapshot_id, x.offer_id, x.title, x.brand, x.category,
    x.offer_type, x.redemption_channel, coalesce(x.product_ids, '{}'),
    x.start_validity_date, x.end_validity_date, x.price_box, x.image_url
  from jsonb_to_recordset(p_offers) as x(
    offer_id text, title text, brand text, category text,
    offer_type text, redemption_channel text, product_ids text[],
    start_validity_date timestamptz, end_validity_date timestamptz,
    price_box jsonb, image_url text
  );

  delete from public.lidl_offer_snapshots
  where store_key = p_store_key
    and captured_on < (p_captured_at at time zone 'Europe/Madrid')::date - 90;

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'store_key', p_store_key,
    'captured_on', (p_captured_at at time zone 'Europe/Madrid')::date,
    'row_count', v_count
  );
end;
$$;

revoke all on function public.publish_lidl_offer_snapshot(text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_lidl_offer_snapshot(text, text, text, timestamptz, text, jsonb) to service_role;

comment on table public.lidl_offer_snapshots is
  'Capturas globales de ofertas Lidl por tienda y fecha, visibles en la PWA independientemente del hogar.';
comment on table public.lidl_offer_observations is
  'Ofertas Lidl globales con vigencia, canal, imagen y priceBox original. product_ids son IDs internos, nunca EAN.';
