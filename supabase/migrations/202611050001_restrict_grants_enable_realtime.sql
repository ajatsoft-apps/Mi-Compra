revoke all on table public.households from anon, public, authenticated;
revoke all on table public.household_members from anon, public, authenticated;
revoke all on table public.shopping_lists from anon, public, authenticated;
revoke all on table public.shopping_list_items from anon, public, authenticated;

grant select, insert, update, delete on table public.households to authenticated;
grant select, insert, update, delete on table public.household_members to authenticated;
grant select, insert, update, delete on table public.shopping_lists to authenticated;
grant select, insert, update, delete on table public.shopping_list_items to authenticated;

alter publication supabase_realtime add table
  public.households,
  public.household_members,
  public.shopping_lists,
  public.shopping_list_items;
