do $migration$
declare
  v_definition text;
  v_old text := 'and o.unit_price is not null';
  v_new text := 'and o.source <> ''online''
      and coalesce(o.category, '''') not like ''0/17/1745%''
      and coalesce(o.category, '''') not like ''0/17/1748%''';
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'search_shopping_product_suggestions';

  if v_definition is null or position(v_old in v_definition) = 0 then
    raise exception 'Unexpected definition of search_shopping_product_suggestions';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end
$migration$;
