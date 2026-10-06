begin;

-- Preserve the protected writer and its grants. Fail closed if its anchor has drifted.
do $migration$
declare
  definition text;
  anchor constant text := $anchor$elsif p_operation='archive_dimension' then$anchor$;
  branch constant text := $branch$elsif p_operation='dimension_replace' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    rule := p_payload;
    -- Serialize edits to this rule. Scope/evidence remain unchanged, so replacement
    -- cannot introduce a second active rule or move an override to another scope.
    select to_jsonb(v) into existing from public.supplier_dimension_vocabulary v
      where id=(rule->>'id')::uuid and is_active for update;
    if not found then raise exception 'Active dimension mapping unavailable'; end if;
    if existing->>'brand_id' is distinct from rule->>'brand_id' then raise exception 'Mapping Brand mismatch'; end if;
    if nullif(btrim(rule->>'template_id'),'') is distinct from existing->>'template_id'
      or nullif(btrim(rule->>'group_id'),'') is distinct from existing->>'group_id' then
      raise exception 'Mapping scope changed';
    end if;
    if jsonb_typeof(rule->'raw_labels') is distinct from 'array'
      or jsonb_typeof(rule->'finish_codes') is distinct from 'array' then raise exception 'Explicit dimension labels or finish set required'; end if;
    if rule->'raw_labels' is distinct from existing->'raw_labels'
      or rule->'finish_codes' is distinct from existing->'finish_codes'
      or jsonb_array_length(rule->'raw_labels')+jsonb_array_length(rule->'finish_codes')=0
      or exists(select 1 from jsonb_array_elements((rule->'raw_labels')||(rule->'finish_codes')) x where jsonb_typeof(x)<>'string' or btrim(x#>>'{}')='') then
      raise exception 'Mapping labels or finish set changed or invalid';
    end if;
    if btrim(coalesce(rule->>'dimension_code',''))=''
      or jsonb_typeof(rule->'target') is distinct from 'object'
      or rule->'target'->>'dimension' is distinct from rule->>'dimension_code'
      or (existing->>'template_id' is not null and rule->'target'->>'template_id' is distinct from existing->>'template_id')
      or (existing->>'group_id' is not null and rule->'target'->>'group_id' is distinct from existing->>'group_id') then
      raise exception 'Canonical dimension does not exist in the selected Brand target column set';
    end if;
    -- Independent database verification, including Brand, active template/group,
    -- stable column identity and current category. No Product writes.
    perform supplier_price_private.verify_target(rule->'target',(rule->>'brand_id')::uuid);
    update public.supplier_dimension_vocabulary set dimension_code=rule->>'dimension_code',
      confirmed_by=auth.uid(),updated_at=now()
      where id=(rule->>'id')::uuid returning id into entity_id;
  $branch$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1
    or position('dimension_replace' in definition)>0 then
    raise exception 'Deployed Supplier review RPC differs from expected body; review before migrating';
  end if;
  execute replace(definition,anchor,branch||anchor);
end $migration$;

commit;
