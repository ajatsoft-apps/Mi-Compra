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
  if not private.is_household_member(target_household_id) then
    raise exception 'Only household members can create invitations';
  end if;

  raw_code := encode(gen_random_bytes(24), 'hex');

  insert into private.household_invites (
    household_id, token_hash, created_by, expires_at
  ) values (
    target_household_id,
    encode(digest(raw_code, 'sha256'), 'hex'),
    current_user_id,
    invite_expiry
  );

  return query select raw_code, invite_expiry;
end;
$$;
