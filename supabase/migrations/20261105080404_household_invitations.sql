create table if not exists private.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0),
  max_uses integer not null default 10 check (max_uses between 1 and 50)
);

create index if not exists household_invites_household_idx
  on private.household_invites(household_id, created_at desc);

alter table private.household_invites enable row level security;
revoke all on table private.household_invites from public, anon, authenticated;

create or replace function private.create_household_invite(target_household_id uuid)
returns table(invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  raw_code text;
  invite_expiry timestamptz := now() + interval '7 days';
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_household_owner(target_household_id) then
    raise exception 'Only the household owner can create invitations';
  end if;
  raw_code := encode(gen_random_bytes(24), 'hex');
  insert into private.household_invites (household_id, token_hash, created_by, expires_at)
  values (target_household_id, encode(digest(raw_code, 'sha256'), 'hex'), current_user_id, invite_expiry);
  return query select raw_code, invite_expiry;
end;
$$;

create or replace function private.accept_household_invite(invitation_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  invite_record private.household_invites%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if invitation_code is null or length(trim(invitation_code)) <> 48 then
    raise exception 'Invitation code is invalid';
  end if;
  select * into invite_record
  from private.household_invites
  where token_hash = encode(digest(trim(invitation_code), 'sha256'), 'hex')
  for update;
  if not found or invite_record.revoked_at is not null
     or invite_record.expires_at <= now()
     or invite_record.use_count >= invite_record.max_uses then
    raise exception 'Invitation is invalid, expired, or no longer available';
  end if;
  if exists (select 1 from public.household_members
    where household_id = invite_record.household_id and user_id = current_user_id) then
    return invite_record.household_id;
  end if;
  insert into public.household_members (household_id, user_id, role)
  values (invite_record.household_id, current_user_id, 'member')
  on conflict (household_id, user_id) do nothing;
  update private.household_invites set use_count = use_count + 1 where id = invite_record.id;
  return invite_record.household_id;
end;
$$;

revoke all on function private.create_household_invite(uuid) from public, anon;
revoke all on function private.accept_household_invite(text) from public, anon;
grant execute on function private.create_household_invite(uuid) to authenticated;
grant execute on function private.accept_household_invite(text) to authenticated;

create or replace function public.create_household_invite(target_household_id uuid)
returns table(invite_code text, expires_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select * from private.create_household_invite(target_household_id);
$$;

create or replace function public.accept_household_invite(invitation_code text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.accept_household_invite(invitation_code);
$$;

revoke all on function public.create_household_invite(uuid) from public, anon;
revoke all on function public.accept_household_invite(text) from public, anon;
grant execute on function public.create_household_invite(uuid) to authenticated;
grant execute on function public.accept_household_invite(text) to authenticated;
