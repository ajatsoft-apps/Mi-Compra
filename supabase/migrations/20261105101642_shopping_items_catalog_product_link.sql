alter table public.shopping_list_items add column catalog_product_id uuid;
alter table public.shopping_list_items add constraint shopping_items_catalog_product_household_fk
foreign key (catalog_product_id, household_id)
references public.household_products(id, household_id);
create index shopping_items_catalog_product_idx
on public.shopping_list_items(catalog_product_id)
where catalog_product_id is not null;