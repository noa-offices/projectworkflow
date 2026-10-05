begin;

-- Phase 2I-2: a review batch snapshots its source definition's confirmed Family coverage, derived inside the database.
-- The browser never supplies coverage. A source with no definition keeps coverage_template_ids NULL (legacy, unrestricted).
-- Forward-only. No new tables, columns or grants. Completion and baseline semantics are untouched.

-- Patch only the batch, decision and match-chunk branches of the deployed RPC, preserving owner, security definer,
-- search_path, authorization and grants (same anchored approach as earlier Supplier review migrations).
do $migration$
declare
  definition text;
  patched text;
  old_guard constant text := $old$if p_payload->>'scope'='selected_templates' and cardinality(bound_keys)=0 then raise exception 'Select existing Templates'; end if;$old$;
  new_guard constant text := $new$if s.definition_id is not null then
      if not exists(select 1 from public.supplier_source_definitions d where d.id=s.definition_id and d.brand_id=s.brand_id and d.is_active) then raise exception 'This Supplier source definition is inactive or unavailable'; end if;
      if not exists(select 1 from public.supplier_source_definition_families f where f.definition_id=s.definition_id) then raise exception 'This Supplier source has no confirmed Family coverage.'; end if;
      if exists(select 1 from unnest(bound_keys) x where not exists(select 1 from public.supplier_source_definition_families f where f.definition_id=s.definition_id and f.template_id=x::uuid)) then raise exception 'Selected Template is outside this source coverage'; end if;
    end if;
    $new$ || old_guard;
  old_columns constant text := $old$selected_template_ids,expected_matches,expected_chunks,basis_warning,created_by)$old$;
  new_columns constant text := $new$selected_template_ids,expected_matches,expected_chunks,basis_warning,created_by,coverage_template_ids)$new$;
  old_values constant text := $old$'Review only. Phase 2 must revalidate before application.' end,auth.uid()) returning id into entity_id;$old$;
  new_values constant text := $new$'Review only. Phase 2 must revalidate before application.' end,auth.uid(),case when s.definition_id is null then null else array(select f.template_id from public.supplier_source_definition_families f where f.definition_id=s.definition_id order by f.template_id) end) returning id into entity_id;$new$;
  old_decision constant text := $old$raise exception 'Decision is outside selected review scope'; end if;$old$;
  new_decision constant text := old_decision || $new$
      if b.coverage_template_ids is not null and exists(select 1 from jsonb_array_elements(match_record->'targets') t where not ((t->>'template_id')::uuid = any(b.coverage_template_ids))) then raise exception 'Decision is outside batch coverage'; end if;$new$;
  old_chunk constant text := $old$perform supplier_price_private.verify_target(target,b.brand_id);$old$;
  new_chunk constant text := old_chunk || $new$
          if b.coverage_template_ids is not null and not ((target->>'template_id')::uuid = any(b.coverage_template_ids)) then raise exception 'Target is outside batch coverage'; end if;$new$;
  anchor text;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  foreach anchor in array array[old_guard, old_columns, old_values, old_decision, old_chunk] loop
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
    end if;
  end loop;
  patched := replace(replace(replace(replace(replace(definition,old_guard,new_guard),old_columns,new_columns),old_values,new_values),old_decision,new_decision),old_chunk,new_chunk);
  execute patched;
end $migration$;

-- A batch's coverage is fixed at creation. Direct DML is not granted, and this also blocks the definer RPC and any future writer.
create function public.supplier_batch_coverage_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.coverage_template_ids is distinct from old.coverage_template_ids then raise exception 'Batch coverage is immutable'; end if;
  return new;
end $$;
create trigger supplier_batch_coverage_immutable before update on public.supplier_price_batches
  for each row execute function public.supplier_batch_coverage_immutable();

commit;
