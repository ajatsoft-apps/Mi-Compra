create or replace function private.list_household_members(target_household_id uuid)
returns table(member_user_id uuid, member_email text, member_role text, member_joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_household_member(target_household_id) then
    raise exception 'You are not a member of this household';
  end if;

  return query
  select hm.user_id, u.email::text, hm.role, hm.joined_at
  from public.household_members hm
  join auth.users u on u.id = hm.user_id
  where hm.household_id = target_household_id
  order by case when hm.role = 'owner' then 0 else 1 end, hm.joined_at, hm.user_id;
end;
$$;

create or replace function private.list_household_invites(target_household_id uuid)
returns table(
  invite_id uuid,
  created_by uuid,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  use_count integer,
  max_uses integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_household_member(target_household_id) then
    raise exception 'You are not a member of this household';
  end if;

  return query
  select hi.id, hi.created_by, hi.created_at, hi.expires_at, hi.revoked_at, hi.use_count, hi.max_uses
  from private.household_invites hi
  where hi.household_id = target_household_id
  order by hi.created_at desc;
end;
$$;

create or replace function private.remove_household_member(target_household_id uuid, target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_role text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if current_user_id = target_user_id then
    raise exception 'Use leave_household to leave your own household';
  end if;

  perform 1 from public.households h where h.id = target_household_id for update;
  if not found then
    raise exception 'Household not found';
  end if;
  if not private.is_household_owner(target_household_id) then
    raise exception 'Only the household owner can remove members';
  end if;

  select hm.role into target_role
  from public.household_members hm
  where hm.household_id = target_household_id and hm.user_id = target_user_id
  for update;

  if not found then
    raise exception 'Member not found';
  end if;
  if target_role = 'owner' then
    raise exception 'The household owner cannot be removed';
  end if;

  delete from public.household_members
  where household_id = target_household_id and user_id = target_user_id;

  update private.household_invites
  set revoked_at = pg_catalog.now()
  where household_id = target_household_id
    and created_by = target_user_id
    and revoked_at is null;

  return true;
end;
$$;

create or replace function private.transfer_household_ownership(target_household_id uuid, target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if current_user_id = target_user_id then
    raise exception 'You are already the household owner';
  end if;

  perform 1 from public.households h where h.id = target_household_id for update;
  if not found then
    raise exception 'Household not found';
  end if;
  if not private.is_household_owner(target_household_id) then
    raise exception 'Only the household owner can transfer ownership';
  end if;
  if not exists (
    select 1 from public.household_members hm
    where hm.household_id = target_household_id and hm.user_id = target_user_id and hm.role = 'member'
  ) then
    raise exception 'The new owner must already be a household member';
  end if;

  update public.household_members
  set role = 'member'
  where household_id = target_household_id and user_id = current_user_id;

  update public.household_members
  set role = 'owner'
  where household_id = target_household_id and user_id = target_user_id;

  return true;
end;
$$;

create or replace function private.revoke_household_invite(target_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  invite_household_id uuid;
  invite_creator_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select hi.household_id, hi.created_by
  into invite_household_id, invite_creator_id
  from private.household_invites hi
  where hi.id = target_invite_id
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;
  if not private.is_household_member(invite_household_id) then
    raise exception 'You are not a member of this household';
  end if;
  if invite_creator_id <> current_user_id
     and not private.is_household_owner(invite_household_id) then
    raise exception 'Only the invitation creator or household owner can revoke it';
  end if;

  update private.household_invites
  set revoked_at = coalesce(revoked_at, pg_catalog.now())
  where id = target_invite_id;

  return true;
end;
$$;

revoke all on function private.list_household_members(uuid) from public, anon;
revoke all on function private.list_household_invites(uuid) from public, anon;
revoke all on function private.remove_household_member(uuid, uuid) from public, anon;
revoke all on function private.transfer_household_ownership(uuid, uuid) from public, anon;
revoke all on function private.revoke_household_invite(uuid) from public, anon;

grant execute on function private.list_household_members(uuid) to authenticated;
grant execute on function private.list_household_invites(uuid) to authenticated;
grant execute on function private.remove_household_member(uuid, uuid) to authenticated;
grant execute on function private.transfer_household_ownership(uuid, uuid) to authenticated;
grant execute on function private.revoke_household_invite(uuid) to authenticated;

create or replace function public.list_household_members(target_household_id uuid)
returns table(member_user_id uuid, member_email text, member_role text, member_joined_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.list_household_members(target_household_id); $$;

create or replace function public.list_household_invites(target_household_id uuid)
returns table(
  invite_id uuid, created_by uuid, created_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, use_count integer, max_uses integer
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from private.list_household_invites(target_household_id); $$;

create or replace function public.remove_household_member(target_household_id uuid, target_user_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.remove_household_member(target_household_id, target_user_id); $$;

create or replace function public.transfer_household_ownership(target_household_id uuid, target_user_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.transfer_household_ownership(target_household_id, target_user_id); $$;

create or replace function public.revoke_household_invite(target_invite_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select private.revoke_household_invite(target_invite_id); $$;

revoke all on function public.list_household_members(uuid) from public, anon;
revoke all on function public.list_household_invites(uuid) from public, anon;
revoke all on function public.remove_household_member(uuid, uuid) from public, anon;
revoke all on function public.transfer_household_ownership(uuid, uuid) from public, anon;
revoke all on function public.revoke_household_invite(uuid) from public, anon;

grant execute on function public.list_household_members(uuid) to authenticated;
grant execute on function public.list_household_invites(uuid) to authenticated;
grant execute on function public.remove_household_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_household_ownership(uuid, uuid) to authenticated;
grant execute on function public.revoke_household_invite(uuid) to authenticated;
