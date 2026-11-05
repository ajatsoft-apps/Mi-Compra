create table public.household_product_preferences (
  household_id uuid not null,
  product_id uuid not null,
  preferred_brand text not null default '',
  preferred_format text not null default '',
  allow_substitutes boolean not null default true,
  notes text not null default '',
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (household_id, product_id),
  foreign key (product_id, household_id) references public.household_products(id, household_id)
);
create table public.household_product_equivalences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  product_id uuid not null,
  equivalent_product_id uuid not null,
  equivalence_type text not null default 'accepted_substitute'
    check (equivalence_type in ('same_product', 'accepted_substitute')),
  notes text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (product_id <> equivalent_product_id),
  unique (household_id, product_id, equivalent_product_id),
  foreign key (product_id, household_id) references public.household_products(id, household_id),
  foreign key (equivalent_product_id, household_id) references public.household_products(id, household_id)
);
create index household_product_equivalences_product_idx
on public.household_product_equivalences(household_id, product_id);
create table public.purchase_history (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  product_id uuid not null,
  product_name_snapshot text not null,
  brand_snapshot text not null default '',
  format_quantity numeric(12,3) check (format_quantity is null or format_quantity > 0),
  format_unit text not null default 'ud.',
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,4) check (unit_price is null or unit_price >= 0),
  total_price numeric(12,2) check (total_price is null or total_price >= 0),
  store_name text not null default '',
  purchased_at timestamptz not null default now(),
  note text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (product_id, household_id) references public.household_products(id, household_id)
);
create index purchase_history_household_date_idx on public.purchase_history(household_id, purchased_at desc);
create index purchase_history_product_date_idx on public.purchase_history(product_id, purchased_at desc);

alter table public.household_product_preferences enable row level security;
alter table public.household_product_equivalences enable row level security;
alter table public.purchase_history enable row level security;
grant select, insert, update on public.household_product_preferences,
 public.household_product_equivalences, public.purchase_history to authenticated;

create policy product_preferences_select on public.household_product_preferences
for select to authenticated using ((select private.is_household_member(household_id)));
create policy product_preferences_insert on public.household_product_preferences
for insert to authenticated with check ((select private.is_household_member(household_id)) and updated_by = (select auth.uid()));
create policy product_preferences_update on public.household_product_preferences
for update to authenticated using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)) and updated_by = (select auth.uid()));

create policy product_equivalences_select on public.household_product_equivalences
for select to authenticated using ((select private.is_household_member(household_id)));
create policy product_equivalences_insert on public.household_product_equivalences
for insert to authenticated with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
create policy product_equivalences_update on public.household_product_equivalences
for update to authenticated using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));

create policy purchase_history_select on public.purchase_history
for select to authenticated using ((select private.is_household_member(household_id)));
create policy purchase_history_insert on public.purchase_history
for insert to authenticated with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));
create policy purchase_history_update on public.purchase_history
for update to authenticated using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)) and created_by = (select auth.uid()));

alter publication supabase_realtime add table public.household_product_preferences,
 public.household_product_equivalences, public.purchase_history;