create table public.household_products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  barcode text,
  brand text not null default '',
  format_quantity numeric(12,3) check (format_quantity is null or format_quantity > 0),
  format_unit text not null default 'ud.',
  category text not null default 'Otros',
  notes text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, household_id)
);
create unique index household_products_barcode_unique on public.household_products(household_id, barcode)
where barcode is not null and archived_at is null;
create index household_products_household_name_idx on public.household_products(household_id, lower(name))
where archived_at is null;
alter table public.household_products enable row level security;
grant select, insert, update on public.household_products to authenticated;
create policy household_products_select on public.household_products for select to authenticated
using ((select private.is_household_member(household_id)));
create policy household_products_insert on public.household_products for insert to authenticated
with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
create policy household_products_update on public.household_products for update to authenticated
using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
alter publication supabase_realtime add table public.household_products;