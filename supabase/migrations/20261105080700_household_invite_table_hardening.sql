create policy household_invites_deny_direct_access
on private.household_invites
for all
to authenticated
using (false)
with check (false);

create index if not exists household_invites_created_by_idx
on private.household_invites(created_by);
