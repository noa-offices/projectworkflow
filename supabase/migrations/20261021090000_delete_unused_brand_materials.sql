begin;

create function public.delete_unused_brand_materials(p_group_id uuid, p_ids uuid[])
returns table(id uuid, status text, image_path text, picture_in_use boolean)
language plpgsql security definer set search_path = '' as $$
declare
  locked_ids uuid[] := '{}';
  deleted_ids uuid[] := '{}';
  removed record;
  requested uuid;
  path text;
begin
  -- Match requireProductLibraryManager/canManageProductLibrary, including designers and procurement.
  if not coalesce((select public.current_user_is_active()), false)
     or not coalesce((select public.current_user_role())::text in
       ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer'), false) then
    raise exception 'Material library access required' using errcode = '42501';
  end if;
  if p_group_id is null or p_ids is null or cardinality(p_ids) > 100
     or array_position(p_ids, null) is not null then
    raise exception 'Provide a group and at most 100 material ids' using errcode = '22023';
  end if;
  -- The second statement relies on READ COMMITTED for a fresh snapshot after any lock wait.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Deletion requires read committed isolation' using errcode = '25000';
  end if;
  select coalesce(array_agg(candidate.id), '{}'::uuid[]) into locked_ids
  from (select m.id from public.brand_materials m
        where m.id = any(p_ids) and m.material_group_id = p_group_id
        order by m.id for update) candidate;

  -- Separate statement: committed FK inserts preceding our locks are now visible.
  -- New FK inserts wait on these parent locks and cannot be silently cascaded away.
  for removed in
    delete from public.brand_materials m
    where m.id = any(locked_ids) and m.material_group_id = p_group_id
      and not exists (select 1 from public.product_template_material_group_items link
                      where link.brand_material_id = m.id)
    returning m.id, m.image_url
  loop
    deleted_ids := array_append(deleted_ids, removed.id);
    id := removed.id; status := 'deleted';
    image_path := nullif(btrim(removed.image_url), ''); picture_in_use := false;
    path := regexp_replace(image_path, '^product-images:', '');
    if path is not null then
      -- Substring matching is conservative, and also sees bucket-prefixed/signed URL representations.
      picture_in_use :=
        exists (select 1 from public.brand_materials m where position(path in m.image_url) > 0)
        or exists (select 1 from public.product_templates t where position(path in
          jsonb_build_array(t.default_image_url,t.reference_image_url,
            t.proposed_image_url_1,t.proposed_image_url_2,t.proposed_image_url_3,t.proposed_image_url_4,
            t.proposed_image_url_5,t.proposed_image_url_6,t.proposed_image_url_7,t.proposed_image_url_8,
            t.proposed_image_url_9,t.proposed_image_url_10,t.proposed_image_url_11,t.proposed_image_url_12,
            t.proposed_image_url_13,t.proposed_image_url_14,t.proposed_image_url_15,t.proposed_image_url_16,
            t.proposed_image_url_17,t.proposed_image_url_18,t.proposed_image_url_19,t.proposed_image_url_20,
            t.image_settings,t.material_suggestions)::text) > 0)
        or exists (select 1 from public.product_template_group_references r where position(path in r.storage_path) > 0)
        or exists (select 1 from public.product_template_row_references r where position(path in r.storage_path) > 0)
        or exists (select 1 from public.product_template_subgroup_references r where position(path in r.storage_path) > 0)
        or exists (select 1 from public.quotation_items q where position(path in
          jsonb_build_array(q.finish_selections_snapshot,q.specified_image_url_snapshot,q.proposed_image_url_snapshot)::text) > 0);
    end if;
    return next;
  end loop;
  for requested in select distinct unnest(p_ids) loop
    if requested = any(deleted_ids) then continue; end if;
    id := requested; image_path := null; picture_in_use := false;
    status := case when requested = any(locked_ids) then 'in_use' else 'not_found' end;
    return next;
  end loop;
end;
$$;

revoke all on function public.delete_unused_brand_materials(uuid,uuid[]) from public, anon;
grant execute on function public.delete_unused_brand_materials(uuid,uuid[]) to authenticated;
commit;

-- ROLLBACK (manual only; does not restore deleted rows or pictures):
-- begin;
-- drop function public.delete_unused_brand_materials(uuid,uuid[]);
-- commit;
