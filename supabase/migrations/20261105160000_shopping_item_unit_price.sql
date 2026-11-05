alter table public.shopping_list_items
  add column if not exists unit_price numeric(10,2);

alter table public.shopping_list_items
  drop constraint if exists shopping_list_items_unit_price_check;

alter table public.shopping_list_items
  add constraint shopping_list_items_unit_price_check
  check (unit_price is null or unit_price >= 0);

comment on column public.shopping_list_items.unit_price is
  'Precio por unidad de compra, guardado al añadir el producto para calcular importes y totales de la lista.';
