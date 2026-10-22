begin;

-- Only removes one inactive relationship. Existing table grants and RLS remain authoritative.
create function public.remove_archived_template_family_link(p_template_id uuid, p_relationship_id uuid)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  discovered public.product_template_linked_families%rowtype;
  locked_link public.product_template_linked_families%rowtype;
  endpoint record;
  locked_ids uuid[] := '{}';
  endpoint_brands uuid[] := '{}';
  selected_found boolean := false;
  selected_archived boolean := false;
  deleted_id uuid;
  affected integer;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if not coalesce((select public.current_user_is_active()), false)
     or not (coalesce((select public.current_user_can_manage_records()), false)
             or coalesce((select public.current_user_is_sales_coordinator()), false)) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_template_id is null or p_relationship_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Discovery only: these endpoint IDs are untrusted until checked again under the link lock.
  select * into discovered from public.product_template_linked_families l where l.id = p_relationship_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  -- All callers lock templates in UUID order, then the relationship. NO KEY UPDATE blocks
  -- restores and brand/endpoint template changes, but permits FK KEY SHARE locks.
  for endpoint in
    select t.id, t.brand_id, t.is_active, t.lifecycle_status from public.product_templates t
    where t.id = any(array[p_template_id, discovered.parent_template_id, discovered.linked_template_id])
    order by t.id for no key update
  loop
    locked_ids := array_append(locked_ids, endpoint.id);
    if endpoint.id = p_template_id then
      selected_found := true;
      selected_archived := endpoint.is_active is false and endpoint.lifecycle_status = 'archived';
    end if;
    if endpoint.id in (discovered.parent_template_id, discovered.linked_template_id) then
      endpoint_brands := array_append(endpoint_brands, endpoint.brand_id);
    end if;
  end loop;
  select * into locked_link from public.product_template_linked_families l
    where l.id = p_relationship_id for update;

  -- Revalidate AFTER waiting for all locks. Endpoint changes require a fresh request: never
  -- acquire additional template locks out of order from a stale discovery read.
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if locked_link.parent_template_id is distinct from discovered.parent_template_id
     or locked_link.linked_template_id is distinct from discovered.linked_template_id then
    return jsonb_build_object('ok', false, 'code', 'stale');
  end if;
  if not selected_found then return jsonb_build_object('ok', false, 'code', 'template_unavailable'); end if;
  if not coalesce(selected_archived, false) then return jsonb_build_object('ok', false, 'code', 'not_archived'); end if;
  if p_template_id not in (locked_link.parent_template_id, locked_link.linked_template_id) then
    return jsonb_build_object('ok', false, 'code', 'wrong_relationship');
  end if;
  if locked_link.is_active is distinct from false then return jsonb_build_object('ok', false, 'code', 'active_link'); end if;
  if locked_link.parent_template_id = locked_link.linked_template_id
     or not (locked_ids @> array[locked_link.parent_template_id, locked_link.linked_template_id]) then
    return jsonb_build_object('ok', false, 'code', 'endpoint_unavailable');
  end if;
  -- Cross-brand families are supported by existing setup. Require BOTH actual endpoint
  -- brands to exist and be visible under RLS; never accept a client-supplied brand scope.
  if array_position(endpoint_brands, null) is not null or exists (
    select 1 from unnest(endpoint_brands) b(id)
    where not exists (select 1 from public.brands brand where brand.id = b.id)
  ) then return jsonb_build_object('ok', false, 'code', 'brand_unavailable'); end if;
  if not coalesce((select public.current_user_is_active()), false)
     or not (coalesce((select public.current_user_can_manage_records()), false)
             or coalesce((select public.current_user_is_sales_coordinator()), false)) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  delete from public.product_template_linked_families l
  where l.id = p_relationship_id and l.is_active = false
    and l.parent_template_id = locked_link.parent_template_id
    and l.linked_template_id = locked_link.linked_template_id
    and p_template_id in (l.parent_template_id, l.linked_template_id)
  returning l.id into deleted_id;
  get diagnostics affected = row_count;
  if affected <> 1 or deleted_id is distinct from p_relationship_id then
    -- An exception rolls back the subtransaction, including any trigger side effects.
    raise exception 'Relationship deletion was not confirmed' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'code', 'deleted', 'templateId', p_template_id,
    'relationshipId', deleted_id, 'deletedCount', affected);
exception
  when insufficient_privilege then return jsonb_build_object('ok', false, 'code', 'forbidden');
  when serialization_failure or deadlock_detected then return jsonb_build_object('ok', false, 'code', 'stale');
end;
$$;

revoke all on function public.remove_archived_template_family_link(uuid, uuid) from public, anon;
grant execute on function public.remove_archived_template_family_link(uuid, uuid) to authenticated;
commit;

-- Rollback definition only (cannot restore a removed relationship):
-- drop function public.remove_archived_template_family_link(uuid, uuid);
