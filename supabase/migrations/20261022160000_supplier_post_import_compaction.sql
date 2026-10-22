-- Compact an importer's own finished import without deleting its retained file.
-- Separate from owner-only historical cleanup: no changes to those functions/permissions.
begin;
create function public.supplier_compact_imported_source_step(p_source_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.supplier_source_versions;
  identities bigint;
  item jsonb;
  proof jsonb;
  cells_deleted integer;
  rows_deleted integer := 0;
  budget integer := 5000;
  finished boolean;
begin
  if (select auth.uid()) is null or not coalesce((select public.current_user_is_active()),false)
     or not coalesce((select public.current_user_role())::text in
       ('system_owner','admin_manager','procurement_manager','sales_coordinator','designer'),false) then
    raise exception 'Supplier importer access required' using errcode='42501';
  end if;
  select * into s from public.supplier_source_versions where id=p_source_id for update;
  if not found or s.created_by is distinct from (select auth.uid()) then
    raise exception 'Own Supplier import required' using errcode='42501';
  end if;
  if s.status <> 'imported' then raise exception 'Import must finish before compaction'; end if;
  if s.rows_compacted_at is not null then
    return jsonb_build_object('source_id',s.id,'done',true,'rows_compacted_at',s.rows_compacted_at);
  end if;
  select count(*) into identities from public.supplier_source_identities where source_id=s.id;
  if identities=0 or identities<>s.identity_count then raise exception 'Complete identities required'; end if;
  -- Validate before every batch. Legacy/empty evidence still needs its original rows.
  for item in select data from public.supplier_source_identities where source_id=s.id loop
    if jsonb_typeof(item->'evidence') is distinct from 'array'
       or jsonb_typeof(item->'source_row_count') is distinct from 'number'
       or jsonb_typeof(item->'row_keys') is distinct from 'array' then
      raise exception 'Complete nonempty evidence required';
    end if;
    if jsonb_array_length(item->'evidence') not between 1 and 5
       or (item->>'source_row_count')::numeric <> jsonb_array_length(item->'row_keys')
       or jsonb_array_length(item->'evidence') <> least(5,(item->>'source_row_count')::numeric) then
      raise exception 'Complete nonempty evidence required';
    end if;
    for proof in select value from jsonb_array_elements(item->'evidence') loop
      if jsonb_typeof(proof->'row_number') is distinct from 'number'
         or jsonb_typeof(proof->'sheet') is distinct from 'string'
         or jsonb_typeof(proof->'full_supplier_code') is distinct from 'string' then
        raise exception 'Invalid identity evidence';
      end if;
      if (proof->>'row_number')::numeric < 1 or (proof->>'row_number')::numeric <> trunc((proof->>'row_number')::numeric)
         or btrim(proof->>'full_supplier_code')='' then raise exception 'Invalid identity evidence'; end if;
    end loop;
  end loop;
  -- Like bounded unfinished-import cleanup: at most 5,000 records per RPC,
  -- no statement_timeout override. Cells must be gone before their parent rows.
  delete from public.supplier_source_cells where source_id=s.id and ctid=any(array(
    select ctid from public.supplier_source_cells where source_id=s.id limit budget));
  get diagnostics cells_deleted=row_count;
  budget := budget-cells_deleted;
  if budget>0 and not exists(select 1 from public.supplier_source_cells where source_id=s.id) then
    delete from public.supplier_source_rows where source_id=s.id and ctid=any(array(
      select ctid from public.supplier_source_rows where source_id=s.id limit budget));
    get diagnostics rows_deleted=row_count;
  end if;
  finished := not exists(select 1 from public.supplier_source_cells where source_id=s.id)
          and not exists(select 1 from public.supplier_source_rows where source_id=s.id);
  if finished then
    update public.supplier_source_versions set rows_compacted_at=now() where id=s.id returning * into s;
  end if;
  return jsonb_build_object('source_id',s.id,'done',finished,'removed_cells',cells_deleted,
    'removed_rows',rows_deleted,'rows_compacted_at',s.rows_compacted_at);
end $$;
revoke all on function public.supplier_compact_imported_source_step(uuid) from public, anon;
grant execute on function public.supplier_compact_imported_source_step(uuid) to authenticated;
commit;
