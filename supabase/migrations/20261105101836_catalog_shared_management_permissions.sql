drop policy household_products_update on public.household_products;
create policy household_products_update on public.household_products
for update to authenticated using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

drop policy product_equivalences_update on public.household_product_equivalences;
create policy product_equivalences_update on public.household_product_equivalences
for update to authenticated using ((select private.is_household_member(household_id)))
with check ((select private.is_household_member(household_id)));

grant delete on public.household_product_equivalences to authenticated;
create policy product_equivalences_delete on public.household_product_equivalences
for delete to authenticated using ((select private.is_household_member(household_id)));

create or replace function public.protect_household_product_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.household_id is distinct from old.household_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Product household and creator cannot be changed';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
create trigger household_products_protect_identity
before update on public.household_products
for each row execute function public.protect_household_product_identity();

create or replace function public.protect_product_equivalence_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.household_id is distinct from old.household_id
     or new.created_by is distinct from old.created_by then
    raise exception 'Equivalence household and creator cannot be changed';
  end if;
  return new;
end;
$$;
create trigger product_equivalences_protect_identity
before update on public.household_product_equivalences
for each row execute function public.protect_product_equivalence_identity();