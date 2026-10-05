begin;

-- Phase 2I-4.2: delete only a definition that has never been linked to a retained Supplier price list.
do $migration$
declare
  definition text;
  old_gate constant text := $old$p_operation in ('profile','dimension','bindings','archive_dimension','definition','definition_coverage','source_definition')$old$;
  new_gate constant text := $new$p_operation in ('profile','dimension','bindings','archive_dimension','definition','definition_coverage','source_definition','definition_delete')$new$;
  old_dispatch constant text := $old$elsif p_operation='definition_coverage' then$old$;
  new_dispatch constant text := $new$elsif p_operation='definition_delete' then
    select id into entity_id from public.supplier_source_definitions where id=(p_payload->>'id')::uuid and brand_id=(p_payload->>'brand_id')::uuid for update;
    if entity_id is null then raise exception 'Source definition unavailable for this Brand'; end if;
    if exists(select 1 from public.supplier_source_versions sv where sv.definition_id=entity_id)
      or exists(select 1 from public.supplier_price_batches batch_row join public.supplier_source_versions source_row on source_row.id=batch_row.source_id where source_row.definition_id=entity_id) then
      raise exception 'This Supplier source cannot be deleted because it has imported price lists or review history.';
    end if;
    delete from public.supplier_source_definition_families where definition_id=entity_id;
    delete from public.supplier_source_definitions where id=entity_id and brand_id=(p_payload->>'brand_id')::uuid;
  elsif p_operation='definition_coverage' then$new$;
  anchor text;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  foreach anchor in array array[old_gate, old_dispatch] loop
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
    end if;
  end loop;
  execute replace(replace(definition,old_gate,new_gate),old_dispatch,new_dispatch);
end $migration$;

commit;
