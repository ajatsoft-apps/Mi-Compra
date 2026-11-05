create or replace function private.leave_household(target_household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_role text;
  successor_user_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform 1
  from public.households h
  where h.id = target_household_id
  for update;

  if not found then
    raise exception 'Household not found';
  end if;

  select hm.role
  into current_role
  from public.household_members hm
  where hm.household_id = target_household_id
    and hm.user_id = current_user_id
  for update;

  if not found then
    raise exception 'You are not a member of this household';
  end if;

  if current_role = 'owner' then
    select hm.user_id
    into successor_user_id
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id <> current_user_id
    order by hm.joined_at asc, hm.user_id asc
    limit 1
    for update;

    if successor_user_id is not null then
      update public.household_members
      set role = 'owner'
      where household_id = target_household_id
        and user_id = successor_user_id;
    else
      update private.household_invites
      set revoked_at = pg_catalog.now()
      where household_id = target_household_id
        and revoked_at is null;
    end if;
  end if;

  delete from public.household_members
  where household_id = target_household_id
    and user_id = current_user_id;

  return true;
end;
$$;

create or replace function private.create_household_fresh(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_household_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if household_name is null
     or char_length(trim(household_name)) not between 1 and 80 then
    raise exception 'Household name must contain between 1 and 80 characters';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  insert into public.households (name, created_by)
  values (trim(household_name), current_user_id)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, current_user_id, 'owner');

  return new_household_id;
end;
$$;

revoke all on function private.leave_household(uuid) from public, anon;
revoke all on function private.create_household_fresh(text) from public, anon;
grant execute on function private.leave_household(uuid) to authenticated;
grant execute on function private.create_household_fresh(text) to authenticated;

create or replace function public.leave_household(target_household_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.leave_household(target_household_id);
$$;

create or replace function public.create_household_fresh(household_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_household_fresh(household_name);
$$;

revoke all on function public.leave_household(uuid) from public, anon;
revoke all on function public.create_household_fresh(text) from public, anon;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.create_household_fresh(text) to authenticated;
