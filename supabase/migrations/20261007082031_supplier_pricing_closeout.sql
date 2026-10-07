begin;

-- Technical cleanup receipts survive source deletion so a failed Storage request can be retried.
-- No direct access: only the constrained, authenticated System Owner RPCs below may use them.
create table supplier_price_private.source_file_cleanup (
  source_id uuid not null,
  path text not null,
  requested_by uuid not null,
  created_at timestamptz not null default now(),
  primary key(source_id, path)
);
alter table supplier_price_private.source_file_cleanup enable row level security;
revoke all on supplier_price_private.source_file_cleanup from public, anon, authenticated;

create function public.purge_archived_supplier_source(p_source_id uuid, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; batch_ids uuid[]; paths text[]; expected_path text;
  deleted jsonb := '{}'::jsonb; n int;
  protected_message constant text := 'This price list is referenced by completed pricing history and cannot be permanently deleted.';
begin
  perform public.supplier_capacity_require_owner();
  if p_confirm is distinct from true then raise exception 'Explicit permanent-delete confirmation required.'; end if;
  select * into s from public.supplier_source_versions where id=p_source_id for update;
  if not found then
    select array_agg(path order by path) into paths from supplier_price_private.source_file_cleanup where source_id=p_source_id;
    if paths is null then raise exception 'Archived Supplier price list unavailable.'; end if;
    return jsonb_build_object('deleted', '{}'::jsonb, 'storage_paths', to_jsonb(paths), 'cleanup_retry', true);
  end if;
  -- Archived versions are never returned by the applicable/imported-version resolver.
  if s.status <> 'archived' then raise exception 'Only archived, non-current Supplier price lists can be permanently deleted.'; end if;
  perform 1 from public.supplier_price_batches where source_id=s.id order by id for update;
  batch_ids := array(select id from public.supplier_price_batches where source_id=s.id);
  if exists(select 1 from public.supplier_price_batches where id=any(batch_ids) and
    (status='completed' or completed_at is not null or brand_price_list_update_id is not null)) or
    exists(select 1 from unnest(batch_ids) b(id) where public.supplier_capacity_batch_applied(b.id)) or
    exists(select 1 from public.product_template_price_history where position(s.id::text in coalesce(note,''))>0) or
    exists(select 1 from public.product_template_detail_price_history where position(s.id::text in coalesce(note,''))>0) or
    exists(select 1 from public.brand_price_list_updates u where position(s.id::text in coalesce(u.notes,'') || coalesce(u.attachment_url,''))>0 or
      exists(select 1 from unnest(batch_ids) b(id) where position(b.id::text in coalesce(u.notes,''))>0)) or
    exists(select 1 from public.audit_activity_log a where a.entity_id::text=s.id::text or a.parent_entity_id::text=s.id::text or
      a.entity_id::text=any(batch_ids::text[]) or a.parent_entity_id::text=any(batch_ids::text[]) or
      position(s.id::text in coalesce(a.metadata::text,'') || coalesce(a.description,''))>0 or
      exists(select 1 from unnest(batch_ids) b(id) where position(b.id::text in coalesce(a.metadata::text,'') || coalesce(a.description,''))>0)) then
    raise exception '%', protected_message;
  end if;
  if exists(select 1 from public.supplier_price_batches where id=any(batch_ids) and status in ('matching','review')) then
    raise exception 'This price list has an active review and cannot be permanently deleted.';
  end if;
  -- Preserve the existing cleanup safeguard for every retained decision, including skip/reject/mapping.
  if exists(select 1 from public.supplier_price_decisions where batch_id=any(batch_ids)) then
    raise exception 'This price list has retained review decisions and cannot be permanently deleted.';
  end if;

  expected_path := s.brand_id::text || '/' || s.id::text || '/' || s.file_hash || '.' || s.source_type;
  paths := '{}';
  -- Only this source's canonical upload may be removed. Shared or external references remain intact.
  if exists(select 1 from storage.objects where bucket_id='supplier-price-sources' and name=expected_path) and
    not exists(select 1 from public.supplier_source_versions o where o.id<>s.id and
      (o.working_reference=expected_path or o.original_reference=expected_path)) and
    not exists(select 1 from public.brand_price_list_updates u where position(expected_path in coalesce(u.attachment_url,''))>0) then
    paths := array[expected_path];
    insert into supplier_price_private.source_file_cleanup(source_id,path,requested_by) values(s.id,expected_path,auth.uid());
  end if;
  delete from public.supplier_price_decisions where batch_id=any(batch_ids); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('decisions',n);
  delete from public.supplier_template_review_units where batch_id=any(batch_ids); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('review_units',n);
  delete from public.supplier_price_match_chunks where batch_id=any(batch_ids); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('match_receipts',n);
  delete from public.supplier_price_matches where batch_id=any(batch_ids); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('matches',n);
  delete from public.supplier_price_batches where id=any(batch_ids); get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('batches',n);
  delete from public.supplier_source_identities where source_id=s.id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('identities',n);
  delete from public.supplier_source_cells where source_id=s.id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('cells',n);
  delete from public.supplier_source_rows where source_id=s.id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('rows',n);
  delete from public.supplier_source_chunks where source_id=s.id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('source_receipts',n);
  delete from public.supplier_source_versions where id=s.id; get diagnostics n=row_count; deleted:=deleted||jsonb_build_object('source',n);
  return jsonb_build_object('deleted',deleted,'storage_paths',to_jsonb(paths),'cleanup_retry',false);
end $$;
revoke all on function public.purge_archived_supplier_source(uuid,boolean) from public, anon;
grant execute on function public.purge_archived_supplier_source(uuid,boolean) to authenticated;

-- Storage API DELETE is restricted to a receipt produced by the guarded transaction, never arbitrary files.
create function public.supplier_source_file_cleanup_allowed(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.current_user_role()='system_owner' and public.current_account_status()='active' and
    exists(select 1 from supplier_price_private.source_file_cleanup c where c.path=p_path) and
    not exists(select 1 from public.supplier_source_versions s where s.working_reference=p_path or s.original_reference=p_path) and
    not exists(select 1 from public.brand_price_list_updates u where position(p_path in coalesce(u.attachment_url,''))>0);
$$;
revoke all on function public.supplier_source_file_cleanup_allowed(text) from public, anon;
grant execute on function public.supplier_source_file_cleanup_allowed(text) to authenticated;
create policy supplier_archived_file_delete on storage.objects for delete to authenticated
using (bucket_id='supplier-price-sources' and public.supplier_source_file_cleanup_allowed(name));

create function public.finish_supplier_source_file_cleanup(p_source_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.supplier_capacity_require_owner();
  if exists(select 1 from supplier_price_private.source_file_cleanup c join storage.objects o
    on o.bucket_id='supplier-price-sources' and o.name=c.path where c.source_id=p_source_id) then
    raise exception 'Database records were deleted, but Storage cleanup is incomplete. Retry file cleanup.';
  end if;
  delete from supplier_price_private.source_file_cleanup where source_id=p_source_id;
end $$;
revoke all on function public.finish_supplier_source_file_cleanup(uuid) from public, anon;
grant execute on function public.finish_supplier_source_file_cleanup(uuid) to authenticated;

commit;
