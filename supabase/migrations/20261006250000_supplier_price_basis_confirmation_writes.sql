begin;

-- Explicit confirmation only: the imported source snapshot and the Brand basis stay independent.
-- This patches the existing authorized Supplier writer rather than granting direct table writes.
do $migration$
declare
  definition text;
  old_permission constant text := $old$if p_operation in ('profile','dimension','bindings','archive_dimension','definition','definition_coverage','source_definition','definition_delete') and not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;$old$;
  new_permission constant text := $new$if p_operation in ('profile','dimension','bindings','archive_dimension','definition','definition_coverage','source_definition','definition_delete','source_basis_update','brand_basis_update') and not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;$new$;
  old_dispatch constant text := $old$if p_operation='profile' then$old$;
  new_dispatch constant text := $new$if p_operation='source_basis_update' then
    if p_payload->>'basis' not in ('list','net') then raise exception 'Price basis must be list or net'; end if;
    select * into s from public.supplier_source_versions where id=(p_payload->>'source_id')::uuid and brand_id=(p_payload->>'brand_id')::uuid for update;
    if not found then raise exception 'Supplier source does not belong to this Brand'; end if;
    update public.supplier_source_versions set basis=p_payload->>'basis' where id=s.id;
    entity_id:=s.id;
  elsif p_operation='brand_basis_update' then
    if p_payload->>'basis' not in ('list','net') then raise exception 'Price basis must be list or net'; end if;
    update public.brands set stored_price_basis=p_payload->>'basis' where id=(p_payload->>'brand_id')::uuid returning id into entity_id;
    if entity_id is null then raise exception 'Brand unavailable'; end if;
  elsif p_operation='profile' then$new$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,old_permission,'')))/length(old_permission)<>1
     or (length(definition)-length(replace(definition,old_dispatch,'')))/length(old_dispatch)<>1 then
    raise exception 'Deployed Supplier write RPC differs from the expected body; review before migrating';
  end if;
  execute replace(replace(definition,old_permission,new_permission),old_dispatch,new_dispatch);
end $migration$;

commit;
