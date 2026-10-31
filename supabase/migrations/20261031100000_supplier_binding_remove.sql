begin;

-- Remove one saved Supplier price mapping (supplier_price_bindings row) so a wrong mapping can be undone.
-- Hard delete scoped by id AND brand_id; the full removed row (including baseline_snapshot) is kept in audit_activity_log.
-- Nothing references supplier_price_bindings, so no other row is orphaned. Review batches keep their own stored match snapshots.
do $migration$
declare
  definition text;
  anchor constant text := $anchor$elsif p_operation='archive_dimension' then$anchor$;
  branch constant text := $branch$elsif p_operation='binding_remove' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    if coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'brand_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Choose the mapping and Brand to remove';
    end if;
    select to_jsonb(x) into existing from public.supplier_price_bindings x
      where x.id=(p_payload->>'id')::uuid and x.brand_id=(p_payload->>'brand_id')::uuid for update;
    if existing is null then raise exception 'Supplier mapping unavailable for this Brand'; end if;
    delete from public.supplier_price_bindings where id=(p_payload->>'id')::uuid and brand_id=(p_payload->>'brand_id')::uuid;
    entity_id := (p_payload->>'id')::uuid;
    insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
      values('supplier_price_binding',entity_id,'brand',(p_payload->>'brand_id')::uuid,'supplier_binding_removed','Supplier mapping removed',existing->>'code',jsonb_build_object('binding',existing),auth.uid());
  elsif p_operation='archive_dimension' then$branch$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if position('binding_remove' in definition)>0
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(definition,anchor,branch);
end $migration$;

commit;
