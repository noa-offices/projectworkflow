begin;

-- Phase 2I-4: the constrained write path for Supplier Source Definitions and Family coverage.
-- The definition tables stay read-only to authenticated users; all writes go through the same definer RPC and the same
-- approver gate as the other Supplier configuration operations (profile, dimension, bindings).
-- Adds three operations only: 'definition', 'definition_coverage', 'source_definition'.
-- Forward-only, no schema change. Patches only the gate and the dispatch of the deployed function and aborts if the
-- deployed body differs from what was reviewed. Review, completion and pricing paths are untouched.
do $migration$
declare
  definition text;
  old_gate constant text := $old$p_operation in ('profile','dimension','bindings','archive_dimension')$old$;
  new_gate constant text := $new$p_operation in ('profile','dimension','bindings','archive_dimension','definition','definition_coverage','source_definition')$new$;
  old_dispatch constant text := $old$elsif p_operation='archive_dimension' then$old$;
  new_dispatch constant text := $new$elsif p_operation='definition' then
    if p_payload->>'id' is null then
      if btrim(coalesce(p_payload->>'name',''))='' then raise exception 'A source name is required'; end if;
      if not exists(select 1 from public.brands where id=(p_payload->>'brand_id')::uuid) then raise exception 'Brand unavailable'; end if;
      if p_payload->>'profile_id' is not null and not exists(select 1 from public.supplier_price_profiles where id=(p_payload->>'profile_id')::uuid and brand_id=(p_payload->>'brand_id')::uuid) then raise exception 'Import profile belongs to another Brand'; end if;
      insert into public.supplier_source_definitions(brand_id,name,profile_id,created_by)
      values((p_payload->>'brand_id')::uuid,btrim(p_payload->>'name'),(p_payload->>'profile_id')::uuid,auth.uid()) returning id into entity_id;
    else
      update public.supplier_source_definitions set name=coalesce(nullif(btrim(p_payload->>'name'),''),name),is_active=coalesce((p_payload->>'is_active')::boolean,is_active)
      where id=(p_payload->>'id')::uuid returning id into entity_id;
      if entity_id is null then raise exception 'Source definition unavailable'; end if;
    end if;
  elsif p_operation='definition_coverage' then
    select id into entity_id from public.supplier_source_definitions where id=(p_payload->>'definition_id')::uuid and is_active for update;
    if entity_id is null then raise exception 'Source definition unavailable'; end if;
    bound_keys:=array(select distinct x from jsonb_array_elements_text(coalesce(p_payload->'template_ids','[]'::jsonb)) x);
    if exists(select 1 from unnest(bound_keys) x where not exists(select 1 from public.product_templates t join public.supplier_source_definitions d on d.brand_id=t.brand_id where t.id=x::uuid and t.is_active and d.id=entity_id)) then raise exception 'Select active Families of this Brand'; end if;
    -- Confirmation replaces the whole set; existing batches keep their own immutable snapshots.
    delete from public.supplier_source_definition_families where definition_id=entity_id;
    -- An empty set is allowed (a definition can give a Family up); a batch cannot start from a definition with no coverage.
    insert into public.supplier_source_definition_families(definition_id,template_id,confirmed_by,confirmed_at) select entity_id,x::uuid,auth.uid(),now() from unnest(bound_keys) x;
  elsif p_operation='source_definition' then
    select * into strict s from public.supplier_source_versions where id=(p_payload->>'source_id')::uuid for update;
    if s.status not in ('uploading','imported') then raise exception 'This source can no longer be linked'; end if;
    if exists(select 1 from public.supplier_price_batches where source_id=s.id) then raise exception 'This price list already has a review; its Supplier source cannot change'; end if;
    if p_payload->>'definition_id' is not null and not exists(select 1 from public.supplier_source_definitions where id=(p_payload->>'definition_id')::uuid and brand_id=s.brand_id and is_active) then raise exception 'Supplier source unavailable for this Brand'; end if;
    update public.supplier_source_versions set definition_id=(p_payload->>'definition_id')::uuid where id=s.id;
    entity_id:=s.id;
  elsif p_operation='archive_dimension' then$new$;
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
