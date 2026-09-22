-- Permanent Product Template deletion (Product Management) must be able to proceed even when a
-- template is referenced by historical quotation_item_price_history rows. quotation_items.source_template_id
-- already uses ON DELETE SET NULL (migration 008); this migration brings source_template_id on
-- quotation_item_price_history in line with that same safe pattern. No rows, columns, or other
-- constraints are touched - price-history rows are never deleted, only their now-dangling source
-- template reference is nulled by Postgres automatically on template delete.
do $$
declare
  existing_fk_name text;
begin
  select con.conname
  into existing_fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join pg_class frel on frel.oid = con.confrelid
  where con.contype = 'f'
    and nsp.nspname = 'public'
    and rel.relname = 'quotation_item_price_history'
    and frel.relname = 'product_templates'
    and con.conkey = (
      select array_agg(attnum order by attnum)
      from pg_attribute
      where attrelid = rel.oid
        and attname = 'source_template_id'
    )
  limit 1;

  if existing_fk_name is not null then
    execute format(
      'alter table public.quotation_item_price_history drop constraint %I',
      existing_fk_name
    );
  end if;

  alter table public.quotation_item_price_history
  add constraint quotation_item_price_history_source_template_id_fkey
  foreign key (source_template_id)
  references public.product_templates (id)
  on delete set null;
end $$;
