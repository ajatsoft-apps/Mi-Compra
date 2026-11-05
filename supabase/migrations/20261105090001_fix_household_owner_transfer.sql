create or replace function private.leave_household(target_household_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  member_role text;
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
  into member_role
  from public.household_members hm
  where hm.household_id = target_household_id
    and hm.user_id = current_user_id
  for update;

  if not found then
    raise exception 'You are not a member of this household';
  end if;

  if member_role = 'owner' then
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

revoke all on function private.leave_household(uuid) from public, anon;
grant execute on function private.leave_household(uuid) to authenticated;