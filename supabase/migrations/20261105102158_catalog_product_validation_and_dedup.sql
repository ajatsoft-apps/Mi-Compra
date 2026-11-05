alter table public.household_products
add constraint household_products_barcode_length_check
check (barcode is null or char_length(trim(barcode)) between 8 and 32),
add constraint household_products_brand_length_check
check (char_length(brand) <= 80),
add constraint household_products_format_unit_length_check
check (char_length(trim(format_unit)) between 1 and 20),
add constraint household_products_notes_length_check
check (char_length(notes) <= 300);
create unique index household_products_identity_unique
on public.household_products (
  household_id,
  lower(trim(name)),
  lower(trim(brand)),
  coalesce(format_quantity, 0),
  lower(trim(format_unit))
)
where archived_at is null;