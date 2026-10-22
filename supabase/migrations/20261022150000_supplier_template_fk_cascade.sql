-- Permanently deleting a product template must also remove its supplier link rows.
-- These three foreign keys were NO ACTION, so any supplier link row blocked the delete.
-- They become ON DELETE CASCADE: only the rows that point at the deleted template go away
-- (review units, family coverage links, dimension rules for that template).
-- Supplier price list data itself (sources, rows, cells, identities, batches, matches, decisions,
-- profiles, definitions) is not touched. Columns, nullability and constraint names stay the same.
begin;

do $$
declare
  spec record;
  fk_name text;
begin
  for spec in
    select * from (values
      ('supplier_template_review_units'::text, 'template_id'::text),
      ('supplier_source_definition_families', 'template_id'),
      ('supplier_dimension_vocabulary', 'template_id')
    ) as t(table_name, column_name)
  loop
    -- Keep the deployed constraint name; fall back to the default Postgres name if none is found.
    select con.conname into fk_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_class frel on frel.oid = con.confrelid
    where con.contype = 'f'
      and nsp.nspname = 'public'
      and rel.relname = spec.table_name
      and frel.relname = 'product_templates'
      and con.conkey = array[(select attnum from pg_attribute where attrelid = rel.oid and attname = spec.column_name)]
    limit 1;

    fk_name := coalesce(fk_name, spec.table_name || '_' || spec.column_name || '_fkey');

    execute format('alter table public.%I drop constraint if exists %I', spec.table_name, fk_name);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.product_templates(id) on delete cascade',
      spec.table_name, fk_name, spec.column_name
    );
  end loop;
end $$;

commit;
