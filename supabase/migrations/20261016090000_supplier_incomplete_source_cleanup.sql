begin;

-- Bounded, resumable cleanup of an ARCHIVED, UNFINISHED Supplier import (for example a cancelled 200,000-row upload).
-- purge_archived_supplier_source deletes every cell, row and identity in one call. The whole RPC is one statement under the
-- authenticated role's statement_timeout, so a large partial source cannot finish. This function deletes at most p_batch rows per
-- call (default 5,000, clamped to 1,000-20,000) and reports what is left; the caller repeats it until done. The role timeout is unchanged.
--  * System Owner only (same guard as the existing purge).
--  * Exact source id; the source row is locked FOR UPDATE, so chunk/finalize writes (rejected for an archived source) cannot interleave.
--  * Only a source archived from uploading/importing/failed, and only with no review batch, so completed pricing history is never involved.
--  * Delete order respects the foreign keys: identities, cells (before rows), rows, chunk receipts; the source row last, only when every
--    dependent row is gone. The canonical Storage file is recorded in the existing cleanup receipt in the same transaction as the final delete.
--  * Idempotent: repeating it only continues; once the source is gone it returns the pending file-cleanup receipt, if any.
create function public.purge_incomplete_supplier_source_step(p_source_id uuid, p_confirm boolean default false, p_batch int default 5000)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; budget int; n int; removed jsonb := '{}'::jsonb;
  left_identities bigint; left_cells bigint; left_rows bigint; left_chunks bigint;
  expected_path text; paths text[] := '{}';
begin
  perform public.supplier_capacity_require_owner();
  if p_confirm is distinct from true then raise exception 'Explicit permanent-delete confirmation required.'; end if;
  budget := greatest(1000, least(coalesce(p_batch, 5000), 20000));
  select * into s from public.supplier_source_versions where id=p_source_id for update;
  if not found then
    select array_agg(path order by path) into paths from supplier_price_private.source_file_cleanup where source_id=p_source_id;
    if paths is null then raise exception 'Unfinished Supplier import unavailable.'; end if;
    return jsonb_build_object('done', true, 'remaining', 0, 'deleted', removed, 'storage_paths', to_jsonb(paths), 'cleanup_retry', true);
  end if;
  if s.status<>'archived' or s.archived_from_status is null or s.archived_from_status not in ('uploading','importing','failed') then
    raise exception 'Only an archived, unfinished Supplier import can be cleaned up this way.';
  end if;
  if exists(select 1 from public.supplier_price_batches where source_id=s.id) then
    raise exception 'This source has review history and cannot be cleaned up as an unfinished import.';
  end if;

  delete from public.supplier_source_identities where ctid = any(array(select ctid from public.supplier_source_identities where source_id=s.id limit budget));
  get diagnostics n=row_count; removed := removed || jsonb_build_object('identities', n); budget := budget - n;
  if budget > 0 then
    delete from public.supplier_source_cells where ctid = any(array(select ctid from public.supplier_source_cells where source_id=s.id limit budget));
    get diagnostics n=row_count; removed := removed || jsonb_build_object('cells', n); budget := budget - n;
  end if;
  -- Rows are referenced by cells (source_id,row_key): only after the cells are gone.
  if budget > 0 and not exists(select 1 from public.supplier_source_cells where source_id=s.id) then
    delete from public.supplier_source_rows where ctid = any(array(select ctid from public.supplier_source_rows where source_id=s.id limit budget));
    get diagnostics n=row_count; removed := removed || jsonb_build_object('rows', n); budget := budget - n;
  end if;
  if budget > 0 then
    delete from public.supplier_source_chunks where ctid = any(array(select ctid from public.supplier_source_chunks where source_id=s.id limit budget));
    get diagnostics n=row_count; removed := removed || jsonb_build_object('chunks', n);
  end if;

  select count(*) into left_identities from public.supplier_source_identities where source_id=s.id;
  select count(*) into left_cells from public.supplier_source_cells where source_id=s.id;
  select count(*) into left_rows from public.supplier_source_rows where source_id=s.id;
  select count(*) into left_chunks from public.supplier_source_chunks where source_id=s.id;
  if left_identities + left_cells + left_rows + left_chunks > 0 then
    return jsonb_build_object('done', false, 'remaining', left_identities + left_cells + left_rows + left_chunks, 'deleted', removed,
      'remaining_detail', jsonb_build_object('identities', left_identities, 'cells', left_cells, 'rows', left_rows, 'chunks', left_chunks), 'storage_paths', '[]'::jsonb);
  end if;

  -- Everything dependent is gone: record the canonical file for the guarded Storage delete, then remove the source itself.
  expected_path := s.brand_id::text || '/' || s.id::text || '/' || s.file_hash || '.' || s.source_type;
  if exists(select 1 from storage.objects where bucket_id='supplier-price-sources' and name=expected_path) and
    not exists(select 1 from public.supplier_source_versions o where o.id<>s.id and (o.working_reference=expected_path or o.original_reference=expected_path)) and
    not exists(select 1 from public.brand_price_list_updates u where position(expected_path in coalesce(u.attachment_url,''))>0) then
    paths := array[expected_path];
    insert into supplier_price_private.source_file_cleanup(source_id,path,requested_by) values(s.id,expected_path,auth.uid()) on conflict do nothing;
  end if;
  delete from public.supplier_source_versions where id=s.id;
  return jsonb_build_object('done', true, 'remaining', 0, 'deleted', removed || jsonb_build_object('source', 1), 'storage_paths', to_jsonb(paths), 'cleanup_retry', false);
end $$;
revoke all on function public.purge_incomplete_supplier_source_step(uuid, boolean, int) from public, anon;
grant execute on function public.purge_incomplete_supplier_source_step(uuid, boolean, int) to authenticated;

commit;
