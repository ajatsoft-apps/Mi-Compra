create or replace function private.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_household_id uuid;
  new_household_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(current_user_id::text, 0)
  );

  select hm.household_id
  into existing_household_id
  from public.household_members hm
  where hm.user_id = current_user_id
  order by hm.joined_at desc
  limit 1;

  if existing_household_id is not null then
    return existing_household_id;
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
