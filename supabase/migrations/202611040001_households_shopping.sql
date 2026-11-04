create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);

create table if not exists public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  list_id uuid not null,
  product_name text not null check (char_length(trim(product_name)) between 1 and 120),
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'ud.' check (char_length(trim(unit)) between 1 and 20),
  category text not null default 'Otros',
  note text not null default '',
  is_completed boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint shopping_list_items_list_household_fk
    foreign key (list_id, household_id)
    references public.shopping_lists(id, household_id)
    on delete cascade
);

create index if not exists household_members_user_idx on public.household_members(user_id);
create index if not exists shopping_lists_household_idx on public.shopping_lists(household_id);
create index if not exists shopping_items_list_created_idx on public.shopping_list_items(list_id, created_at desc);
create index if not exists shopping_items_household_idx on public.shopping_list_items(household_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.protect_household_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Household creator cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function public.protect_shopping_list_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Shopping list ownership cannot be changed';
  end if;
  return new;
end;
$$;

create or replace function public.protect_shopping_item_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.household_id is distinct from old.household_id
     or new.list_id is distinct from old.list_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Shopping item ownership cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists households_protect_owner on public.households;
create trigger households_protect_owner
before update on public.households
for each row execute function public.protect_household_owner();

drop trigger if exists shopping_lists_protect_identity on public.shopping_lists;
create trigger shopping_lists_protect_identity
before update on public.shopping_lists
for each row execute function public.protect_shopping_list_identity();

drop trigger if exists shopping_items_protect_identity on public.shopping_list_items;
create trigger shopping_items_protect_identity
before update on public.shopping_list_items
for each row execute function public.protect_shopping_item_identity();

create or replace function public.touch_shopping_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  if new.is_completed and not old.is_completed then
    new.completed_at = now();
  elsif not new.is_completed then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists shopping_lists_touch_updated_at on public.shopping_lists;
create trigger shopping_lists_touch_updated_at
before update on public.shopping_lists
for each row execute function public.touch_updated_at();

drop trigger if exists shopping_items_touch_updated_at on public.shopping_list_items;
create trigger shopping_items_touch_updated_at
before update on public.shopping_list_items
for each row execute function public.touch_shopping_item();

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_owner(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if household_name is null or char_length(trim(household_name)) not between 1 and 80 then
    raise exception 'Household name must contain between 1 and 80 characters';
  end if;

  insert into public.households (name, created_by)
  values (trim(household_name), (select auth.uid()))
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, (select auth.uid()), 'owner');

  return new_household_id;
end;
$$;

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_list_items enable row level security;

drop policy if exists households_read_member on public.households;
create policy households_read_member on public.households
for select to authenticated
using (public.is_household_member(id));

drop policy if exists households_update_owner on public.households;
create policy households_update_owner on public.households
for update to authenticated
using (public.is_household_owner(id))
with check (public.is_household_owner(id));

drop policy if exists households_delete_owner on public.households;
create policy households_delete_owner on public.households
for delete to authenticated
using (public.is_household_owner(id));

drop policy if exists household_members_read_member on public.household_members;
create policy household_members_read_member on public.household_members
for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists household_members_add_owner on public.household_members;
create policy household_members_add_owner on public.household_members
for insert to authenticated
with check (public.is_household_owner(household_id));

drop policy if exists household_members_remove_owner_or_self on public.household_members;
create policy household_members_remove_owner_or_self on public.household_members
for delete to authenticated
using (public.is_household_owner(household_id) or user_id = (select auth.uid()));

drop policy if exists shopping_lists_read_member on public.shopping_lists;
create policy shopping_lists_read_member on public.shopping_lists
for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists shopping_lists_add_member on public.shopping_lists;
create policy shopping_lists_add_member on public.shopping_lists
for insert to authenticated
with check (
  public.is_household_member(household_id)
  and created_by = (select auth.uid())
);

drop policy if exists shopping_lists_update_member on public.shopping_lists;
create policy shopping_lists_update_member on public.shopping_lists
for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists shopping_lists_delete_owner_or_creator on public.shopping_lists;
create policy shopping_lists_delete_owner_or_creator on public.shopping_lists
for delete to authenticated
using (
  public.is_household_owner(household_id)
  or created_by = (select auth.uid())
);

drop policy if exists shopping_items_read_member on public.shopping_list_items;
create policy shopping_items_read_member on public.shopping_list_items
for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists shopping_items_add_member on public.shopping_list_items;
create policy shopping_items_add_member on public.shopping_list_items
for insert to authenticated
with check (
  public.is_household_member(household_id)
  and created_by = (select auth.uid())
);

drop policy if exists shopping_items_update_member on public.shopping_list_items;
create policy shopping_items_update_member on public.shopping_list_items
for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists shopping_items_delete_member on public.shopping_list_items;
create policy shopping_items_delete_member on public.shopping_list_items
for delete to authenticated
using (public.is_household_member(household_id));
