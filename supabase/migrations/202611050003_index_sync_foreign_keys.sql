create index if not exists households_created_by_idx
  on public.households(created_by);

create index if not exists shopping_lists_created_by_idx
  on public.shopping_lists(created_by);

create index if not exists shopping_items_created_by_idx
  on public.shopping_list_items(created_by);

create index if not exists shopping_items_updated_by_idx
  on public.shopping_list_items(updated_by);

create index if not exists shopping_items_list_household_idx
  on public.shopping_list_items(list_id, household_id);
