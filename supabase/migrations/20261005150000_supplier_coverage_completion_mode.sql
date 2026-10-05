begin;

-- Phase 2I-3: completing a review means "complete for this source's coverage", never an automatic Brand-wide baseline.
-- A batch with no coverage snapshot (legacy) keeps coverage_mode 'complete' exactly as before. A batch with a snapshot
-- claims 'complete' only when its snapshot contains every CURRENT active Family of the Brand; otherwise 'selected_templates',
-- which the Brand-level price-check helpers do not treat as a Brand-wide baseline.
-- Forward-only, no schema change. Patches only the two coverage_mode writes of the deployed completion function and aborts
-- if the deployed body differs from what was reviewed. Product check metadata, writes and rollback behavior are untouched.
do $migration$
declare
  definition text;
  mode_expression constant text := $expr$case when b.coverage_template_ids is null or not exists(select 1 from public.product_templates ct where ct.brand_id=b.brand_id and ct.is_active and not (ct.id = any(b.coverage_template_ids))) then 'complete' else 'selected_templates' end$expr$;
  old_update constant text := $old$update public.brand_price_list_updates set status='active', coverage_mode='complete', currency=coalesce(currency,s.currency),$old$;
  new_update constant text := replace(old_update, $o$coverage_mode='complete'$o$, 'coverage_mode=' || mode_expression);
  old_insert constant text := $old$values(b.brand_id,s.title,s.currency,s.effective_from,s.received_at,'active','complete','Supplier review batch '||b.id::text,auth.uid())$old$;
  new_insert constant text := replace(old_insert, $o$'active','complete',$o$, $n$'active',$n$ || mode_expression || ',');
  anchor text;
begin
  select pg_get_functiondef('public.complete_supplier_price_review(uuid,jsonb)'::regprocedure) into definition;
  foreach anchor in array array[old_update, old_insert] loop
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Deployed supplier completion RPC differs from the expected body; review before migrating';
    end if;
  end loop;
  execute replace(replace(definition,old_update,new_update),old_insert,new_insert);
end $migration$;

commit;
