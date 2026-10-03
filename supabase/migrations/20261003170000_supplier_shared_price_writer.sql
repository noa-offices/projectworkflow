-- Phase 2B prerequisite: one transaction for a server-built set of Supplier price target writes.
-- Reuses write_product_price_with_history_at_version for every mutation and history row; no data migration.
-- The caller (server repository) owns Supplier eligibility; this primitive owns atomicity and version chaining.
begin;

create or replace function public.apply_supplier_shared_price_at_versions(p_operations jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare op jsonb; op_count int; tid uuid; live bigint; next_version bigint;
  -- Reviewed original baseline per Template, then the internally chained execution version.
  versions jsonb := '{}'::jsonb;
begin
  if not public.current_user_is_active() then raise insufficient_privilege; end if;
  if jsonb_typeof(p_operations) is distinct from 'array' or octet_length(p_operations::text) > 4000000 then
    raise exception 'Invalid shared price operations' using errcode='22023'; end if;
  op_count := jsonb_array_length(p_operations);
  if op_count < 1 or op_count > 50 then raise exception 'Invalid shared price operation count' using errcode='22023'; end if;

  -- Validate every operation and its Template baseline before any lock or write.
  for op in select value from jsonb_array_elements(p_operations) loop
    if jsonb_typeof(op) is distinct from 'object' then raise exception 'Invalid shared price operation' using errcode='22023'; end if;
    if not coalesce(
      array(select jsonb_object_keys(op) order by 1) = array['expected_version','history','mode','payload','template_id']
      and jsonb_typeof(op->'template_id') = 'string'
      and (op->>'template_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(op->'expected_version') in ('string','number')
      and (op->>'expected_version') ~ '^[0-9]{1,18}$'
      -- Manual 'default' mode is excluded: it completes price checks, which shared Supplier Apply must not do.
      and (op->>'mode') in ('supplier_default','detail')
      and jsonb_typeof(op->'payload') = 'object'
      and jsonb_typeof(op->'history') = 'object', false) then
      raise exception 'Invalid shared price operation' using errcode='22023'; end if;
    tid := (op->>'template_id')::uuid;
    if versions ? tid::text and (versions->>tid::text)::bigint <> (op->>'expected_version')::bigint then
      raise exception 'This Product Template changed. Reload before saving.' using errcode='P0001'; end if;
    versions := versions || jsonb_build_object(tid::text, ((op->>'expected_version')::bigint)::text);
  end loop;

  -- Lock every involved active Template in sorted UUID order; all baselines must still be live.
  for tid in select key::uuid from jsonb_each(versions) order by key::uuid loop
    select pricing_version into live from public.product_templates where id=tid and is_active for update;
    if not found or live <> (versions->>tid::text)::bigint then
      raise exception 'This Product Template changed. Reload before saving.' using errcode='P0001'; end if;
  end loop;

  -- Execute in input order (cumulative same-architecture payloads depend on it), chaining each Template's version.
  for op in select e.value from jsonb_array_elements(p_operations) with ordinality as e(value, idx) order by e.idx loop
    tid := (op->>'template_id')::uuid;
    next_version := public.write_product_price_with_history_at_version(
      tid, (versions->>tid::text)::bigint, op->>'mode', op->'payload', op->'history');
    versions := jsonb_set(versions, array[tid::text], to_jsonb(next_version::text));
  end loop;

  return jsonb_build_object('applied_count', op_count, 'template_versions', versions);
end $$;

revoke all on function public.apply_supplier_shared_price_at_versions(jsonb) from public;
grant execute on function public.apply_supplier_shared_price_at_versions(jsonb) to authenticated;

commit;
