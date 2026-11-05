alter table public.shopping_list_items
  add column if not exists supermarket text not null default 'general';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shopping_list_items'::regclass
      and conname = 'shopping_list_items_supermarket_check'
  ) then
    alter table public.shopping_list_items
      add constraint shopping_list_items_supermarket_check
      check (supermarket in ('lidl', 'mercadona', 'general'));
  end if;
end;
$$;

create index if not exists shopping_items_list_supermarket_created_idx
  on public.shopping_list_items (list_id, supermarket, created_at desc);

comment on column public.shopping_list_items.supermarket is
  'Lista lógica de destino del producto: Lidl, Mercadona o general. Permite separar supermercados sin crear hogares adicionales.';
