begin;

-- Phase F2: give identities finalised before F1 their evidence, then (separately, after verification) drop the source rows and
-- cells that identities no longer need. Forward-only; applying it changes no data.
--  * rows_compacted_at records "imported successfully, detailed rows and cells later compacted". Status and the historical
--    expected/stored/identity counts are never changed, so a compacted source still reads as a complete import.
--  * Backfill reuses the F1 evidence function, so evidence is identical to what finalize produces today.
--  * Compaction deletes only that source's cells, then rows. Identities, the source version, chunk receipts, reviews, matches,
--    decisions, coverage, bindings, Storage files and Product data are never touched. Dry run by default.

alter table public.supplier_source_versions add column rows_compacted_at timestamptz;

-- Bounded, resumable, idempotent: each call fills up to p_max_identities identities that lack evidence or source_row_count,
-- in key order. Only those two fields are added; every other identity field stays exactly as it was.
create function public.supplier_backfill_identity_evidence(p_source_id uuid, p_max_identities int default 500) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; rows_n int; cells_n int; done int; remaining int;
begin
  perform public.supplier_capacity_require_owner();
  if p_max_identities is null or p_max_identities not between 1 and 5000 then raise exception 'Backfill step size must be 1-5000 identities'; end if;
  select * into s from public.supplier_source_versions where id=p_source_id for update;
  if not found then raise exception 'Supplier source not found'; end if;
  if s.status<>'imported' then raise exception 'Only an imported Supplier source can be backfilled (status %)', s.status; end if;
  if s.rows_compacted_at is not null then raise exception 'Source rows are already compacted; evidence can no longer be rebuilt'; end if;
  select count(*) into rows_n from public.supplier_source_rows where source_id=s.id;
  select count(*) into cells_n from public.supplier_source_cells where source_id=s.id;
  if rows_n<>s.expected_rows or rows_n<>s.stored_rows or cells_n<>s.expected_cells or cells_n<>s.stored_cells then
    raise exception 'Source rows/cells (%/%) do not match the import (% rows, % cells); not backfilled', rows_n, cells_n, s.stored_rows, s.stored_cells;
  end if;
  -- A finish-driven tier is the only case where dimension differs from raw_dimension; its price is the tier price.
  with pending as (
    select i.key from public.supplier_source_identities i where i.source_id=s.id and (not (i.data ? 'evidence') or not (i.data ? 'source_row_count'))
    order by i.key limit p_max_identities for update)
  update public.supplier_source_identities i set data = i.data || jsonb_build_object(
      'source_row_count', jsonb_array_length(i.data->'row_keys'),
      'evidence', public.supplier_identity_evidence(s.id, s.profile, i.code, i.data->>'price_field', coalesce(i.data->>'raw_dimension', i.data->>'dimension'),
        (i.data->>'dimension') is distinct from coalesce(i.data->>'raw_dimension', i.data->>'dimension'), (i.data->>'price')::numeric))
    from pending where i.source_id=s.id and i.key=pending.key;
  get diagnostics done = row_count;
  select count(*) into remaining from public.supplier_source_identities where source_id=s.id and (not (data ? 'evidence') or not (data ? 'source_row_count'));
  return jsonb_build_object('source_id', s.id, 'backfilled', done, 'remaining', remaining, 'done', remaining=0);
end $$;
revoke all on function public.supplier_backfill_identity_evidence(uuid, int) from public;
grant execute on function public.supplier_backfill_identity_evidence(uuid, int) to authenticated;

-- Deletes a finalised source's cells, then rows, once every identity carries complete evidence. Dry run by default.
-- A real run locks the source, re-checks everything and raises (deleting nothing) on any blocker. Re-running is harmless.
create function public.supplier_compact_finalized_source(p_source_id uuid, p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; rows_n int; cells_n int; ids_n int; missing int; invalid int; file_ok boolean; reasons text[] := '{}'; row_bytes bigint; cell_bytes bigint; del_cells int; del_rows int;
begin
  perform public.supplier_capacity_require_owner();
  if coalesce(p_dry_run, true) then select * into s from public.supplier_source_versions where id=p_source_id;
  else select * into s from public.supplier_source_versions where id=p_source_id for update; end if;
  if not found then raise exception 'Supplier source not found'; end if;
  if s.rows_compacted_at is not null then
    return jsonb_build_object('source_id', s.id, 'title', s.title, 'dry_run', coalesce(p_dry_run, true), 'already_compacted', true, 'compacted_at', s.rows_compacted_at, 'rows', 0, 'cells', 0);
  end if;
  select count(*) into rows_n from public.supplier_source_rows where source_id=s.id;
  select count(*) into cells_n from public.supplier_source_cells where source_id=s.id;
  select count(*),
    count(*) filter (where jsonb_typeof(data->'evidence') is distinct from 'array' or jsonb_typeof(data->'source_row_count') is distinct from 'number'),
    count(*) filter (where jsonb_typeof(data->'evidence')='array' and jsonb_typeof(data->'source_row_count')='number'
      and (jsonb_array_length(data->'evidence')>5 or (data->>'source_row_count')::int<jsonb_array_length(data->'evidence') or (data->>'source_row_count')::int<1))
    into ids_n, missing, invalid from public.supplier_source_identities where source_id=s.id;
  file_ok := coalesce(s.working_reference,'')<>'' and exists(select 1 from storage.objects o where o.bucket_id='supplier-price-sources' and o.name=s.working_reference);
  if s.status<>'imported' then reasons := reasons || ('Source is not imported ('||s.status||')'); end if;
  if ids_n=0 or ids_n<>s.identity_count then reasons := reasons || ('Identity count '||ids_n||' does not match the import ('||s.identity_count||')'); end if;
  if missing>0 then reasons := reasons || (missing||' identities lack evidence or source_row_count'); end if;
  if invalid>0 then reasons := reasons || (invalid||' identities have invalid evidence'); end if;
  if rows_n<>s.stored_rows or rows_n<>s.expected_rows then reasons := reasons || ('Rows '||rows_n||' do not match the import ('||s.stored_rows||')'); end if;
  if cells_n<>s.stored_cells or cells_n<>s.expected_cells then reasons := reasons || ('Cells '||cells_n||' do not match the import ('||s.stored_cells||')'); end if;
  if not file_ok then reasons := reasons || text 'The original price-list file is not retained in Storage'; end if;
  select coalesce(sum(pg_column_size(r.*)),0) into row_bytes from public.supplier_source_rows r where r.source_id=s.id;
  select coalesce(sum(pg_column_size(c.*)),0) into cell_bytes from public.supplier_source_cells c where c.source_id=s.id;
  if coalesce(p_dry_run, true) then
    return jsonb_build_object('source_id', s.id, 'title', s.title, 'dry_run', true, 'safe', cardinality(reasons)=0, 'reasons', to_jsonb(reasons), 'rows', rows_n, 'cells', cells_n,
      'identities', ids_n, 'evidence_ready_percent', case when ids_n=0 then 0 else round(100.0*(ids_n-missing-invalid)/ids_n, 2) end, 'estimated_bytes', row_bytes+cell_bytes);
  end if;
  if cardinality(reasons)>0 then raise exception 'Source % cannot be compacted: %. Nothing was deleted.', s.id, to_jsonb(reasons); end if;
  delete from public.supplier_source_cells where source_id=s.id; get diagnostics del_cells = row_count;
  delete from public.supplier_source_rows where source_id=s.id; get diagnostics del_rows = row_count;
  update public.supplier_source_versions set rows_compacted_at=now() where id=s.id;
  return jsonb_build_object('source_id', s.id, 'title', s.title, 'dry_run', false, 'deleted_cells', del_cells, 'deleted_rows', del_rows, 'estimated_bytes', row_bytes+cell_bytes);
end $$;
revoke all on function public.supplier_compact_finalized_source(uuid, boolean) from public;
grant execute on function public.supplier_compact_finalized_source(uuid, boolean) to authenticated;

commit;
