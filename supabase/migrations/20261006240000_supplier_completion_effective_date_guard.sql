begin;

-- Phase 1 correctness: a Supplier price list cannot be completed (activated as the Brand baseline, or its Products stamped
-- checked) before its effective date. Review remains allowed. Undated lists are unaffected.
-- Date: the business date in Dubai, not the database date. The database runs in UTC, so current_date would be one day behind
-- between 00:00 and 04:00 in Dubai.
-- Forward-only. Patches one anchored line of the deployed completion function; aborts if that body differs from what was reviewed.
do $migration$
declare
  definition text;
  old_guard constant text := $old$if not found or s.status<>'imported' then raise exception 'Supplier source must be imported before completing'; end if;$old$;
  new_guard constant text := old_guard || $new$
  if s.effective_from is not null and s.effective_from > (now() at time zone 'Asia/Dubai')::date then
    raise exception 'This price list becomes applicable on %. It can be reviewed now and completed on or after that date.', to_char(s.effective_from, 'DD Mon YYYY');
  end if;$new$;
begin
  select pg_get_functiondef('public.complete_supplier_price_review(uuid,jsonb)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 then
    raise exception 'Deployed supplier completion RPC differs from the expected body; review before migrating';
  end if;
  execute replace(definition,old_guard,new_guard);
end $migration$;

commit;
