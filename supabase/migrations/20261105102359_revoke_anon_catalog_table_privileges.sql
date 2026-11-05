revoke all on table public.household_products from anon, public;
revoke all on table public.household_product_preferences from anon, public;
revoke all on table public.household_product_equivalences from anon, public;
revoke all on table public.purchase_history from anon, public;
grant select, insert, update on table public.household_products to authenticated;
grant select, insert, update on table public.household_product_preferences to authenticated;
grant select, insert, update, delete on table public.household_product_equivalences to authenticated;
grant select, insert, update on table public.purchase_history to authenticated;