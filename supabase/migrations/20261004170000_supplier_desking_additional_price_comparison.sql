begin;

-- Desking size additional prices are compared with the Supplier's commercial unit_price. The stored field stays
-- additional_price (writes and history are unchanged). Accept both comparison labels in the target verifier so
-- fresh comparisons validate and every earlier snapshot (price_field = additional_price) stays valid.
-- Patch only that branch of the deployed verifier; owner, security, search_path and grants are preserved.
do $migration$
declare
  definition text;
  old_branch constant text := $old$elsif field_name='additional_price' and field_key='additional_price' then expected_code:=row_data->>'additional_supplier_price_list_code';$old$;
  new_branch constant text := $new$elsif field_name='additional_price' and field_key in ('additional_price','unit_price') then expected_code:=row_data->>'additional_supplier_price_list_code';$new$;
begin
  select pg_get_functiondef('supplier_price_private.verify_target(jsonb,uuid)'::regprocedure) into definition;
  if strpos(definition,new_branch)>0 then return; end if; -- already patched
  if (length(definition)-length(replace(definition,old_branch,'')))/length(old_branch)<>1 then
    raise exception 'Deployed supplier target verifier differs from the expected body; review before migrating';
  end if;
  execute replace(definition,old_branch,new_branch);
end $migration$;

commit;
