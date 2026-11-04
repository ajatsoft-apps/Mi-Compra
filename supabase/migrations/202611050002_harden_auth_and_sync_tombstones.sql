create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_household_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
  );
$$;

revoke all on function private.is_household_member(uuid) from public, anon;
revoke all on function private.is_household_owner(uuid) from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;

create or replace function private.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if household_name is null or char_length(trim(household_name)) not between 1 and 80 then
    raise exception 'Household name must contain between 1 and 80 characters';
  end if;

  insert into public.households (name, created_by)
  values (trim(household_name), current_user_id)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, current_user_id, 'owner');

  return new_household_id;
end;
$$;

revoke all on function private.create_household(text) from public, anon;
grant execute on function private.create_household(text) to authenticated;

create or replace function public.create_household(household_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_household(household_name);
$$;

revoke all on function public.create_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;

drop policy if exists households_read_member on public.households;
create policy households_read_member on public.households
for select to authenticated using (private.is_household_member(id));

drop policy if exists households_update_owner on public.households;
create policy households_update_owner on public.households
for update to authenticated
using (private.is_household_owner(id))
with check (private.is_household_owner(id));

drop policy if exists households_delete_owner on public.households;
create policy households_delete_owner on public.households
for delete to authenticated using (private.is_household_owner(id));

drop policy if exists household_members_read_member on public.household_members;
create policy household_members_read_member on public.household_members
for select to authenticated using (private.is_household_member(household_id));

drop policy if exists household_members_add_owner on public.household_members;
create policy household_members_add_owner on public.household_members
for insert to authenticated
with check (
  private.is_household_owner(household_id)
  and role = 'member'
  and user_id <> (select auth.uid())
);

drop policy if exists household_members_remove_owner_or_self on public.household_members;
create policy household_members_remove_owner_or_self on public.household_members
for delete to authenticated
using (
  private.is_household_owner(household_id)
  or (user_id = (select auth.uid()) and role <> 'owner')
);

drop policy if exists shopping_lists_read_member on public.shopping_lists;
create policy shopping_lists_read_member on public.shopping_lists
for select to authenticated using (private.is_household_member(household_id));

drop policy if exists shopping_lists_add_member on public.shopping_lists;
create policy shopping_lists_add_member on public.shopping_lists
for insert to authenticated
with check (private.is_household_member(household_id) and created_by = (select auth.uid()));

drop policy if exists shopping_lists_update_member on public.shopping_lists;
create policy shopping_lists_update_member on public.shopping_lists
for update to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

drop policy if exists shopping_lists_delete_owner_or_creator on public.shopping_lists;
create policy shopping_lists_delete_owner_or_creator on public.shopping_lists
for delete to authenticated
using (private.is_household_owner(household_id) or created_by = (select auth.uid()));

drop policy if exists shopping_items_read_member on public.shopping_list_items;
create policy shopping_items_read_member on public.shopping_list_items
for select to authenticated using (private.is_household_member(household_id));

drop policy if exists shopping_items_add_member on public.shopping_list_items;
create policy shopping_items_add_member on public.shopping_list_items
for insert to authenticated
with check (private.is_household_member(household_id) and created_by = (select auth.uid()));

drop policy if exists shopping_items_update_member on public.shopping_list_items;
create policy shopping_items_update_member on public.shopping_list_items
for update to authenticated
using (private.is_household_member(household_id))
with check (private.is_household_member(household_id));

drop policy if exists shopping_items_delete_member on public.shopping_list_items;
create policy shopping_items_delete_member on public.shopping_list_items
for delete to authenticated using (private.is_household_member(household_id));

drop function if exists public.is_household_member(uuid);
drop function if exists public.is_household_owner(uuid);

alter table public.shopping_list_items
  add column if not exists deleted_at timestamptz;

