begin;

alter table public.supplier_price_batches drop constraint supplier_price_batches_status_check;
alter table public.supplier_price_batches add constraint supplier_price_batches_status_check
  check (status in ('matching','review','archived','completed','abandoned'));
alter table public.supplier_price_batches
  add column abandoned_at timestamptz,
  add column abandoned_by uuid references public.profiles(id);
alter table public.supplier_source_versions add column archived_from_status text
  check (archived_from_status in ('uploading','importing','imported','failed'));

-- Extend the existing guarded writer; no new direct table privileges or pricing writer.
do $migration$
declare definition text; anchor text;
  dispatch constant text := $old$elsif p_operation in ('chunk','finalize_source','archive_source','fail_source','attach_file') then$old$;
  archive_branch constant text := $old$elsif p_operation='archive_source' then update public.supplier_source_versions set status='archived' where id=s.id;$old$;
  lifecycle constant text := $new$elsif p_operation='review_abandon' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    if p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Explicit Leave review confirmation required.'; end if;
    select * into strict b from public.supplier_price_batches where id=(p_payload->>'batch_id')::uuid for update;
    if b.status not in ('matching','review','abandoned') or b.completed_at is not null then raise exception 'Only an open Supplier review can be abandoned.'; end if;
    if b.status<>'abandoned' then
      update public.supplier_price_batches set status='abandoned',abandoned_at=now(),abandoned_by=auth.uid() where id=b.id;
    end if;
    entity_id:=b.id;
  elsif p_operation='source_unarchive' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    -- Use the import writer's Brand/hash lock before row locks: never restore a duplicate active file.
    select * into strict s from public.supplier_source_versions where id=(p_payload->>'source_id')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(s.brand_id::text||s.file_hash,0));
    select * into strict s from public.supplier_source_versions where id=s.id for update;
    if s.status<>'archived' then raise exception 'Only an archived Supplier price list can be unarchived.'; end if;
    -- Legacy archives have no prior-state marker. Require complete receipts/counters/identities too;
    -- never turn an unfinished import into an applicable list. Compacted imports retain these proofs.
    if (s.archived_from_status is not null and s.archived_from_status<>'imported') or
      s.stored_rows<>s.expected_rows or s.stored_cells<>s.expected_cells or s.identity_count<=0 or
      (select count(*) from public.supplier_source_chunks where source_id=s.id)<>s.expected_chunks or
      (select count(*) from public.supplier_source_identities where source_id=s.id)<>s.identity_count then
      raise exception 'Only a finalized Supplier import can be unarchived.';
    end if;
    if exists(select 1 from public.supplier_source_versions o where o.id<>s.id and o.brand_id=s.brand_id and o.file_hash=s.file_hash and o.status<>'archived') then
      raise exception 'Another active import already uses this Supplier file. Archive it before unarchiving this version.';
    end if;
    update public.supplier_source_versions set status='imported',archived_from_status=null where id=s.id;
    entity_id:=s.id;
  $new$ || dispatch;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  foreach anchor in array array[dispatch,archive_branch] loop
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Deployed Supplier writer differs from expected lifecycle anchors; review before migrating';
    end if;
  end loop;
  execute replace(replace(definition,dispatch,lifecycle),archive_branch,
    $new$elsif p_operation='archive_source' then update public.supplier_source_versions set archived_from_status=case when status='archived' then archived_from_status else status end,status='archived' where id=s.id;$new$);
end $migration$;

-- Reuse the purge transaction and every business-history/Storage safeguard. Only unfinished
-- decisions on explicitly abandoned batches are now disposable. Applied outcomes remain protected.
do $migration$
declare definition text;
  old_guard constant text := $old$if exists(select 1 from public.supplier_price_decisions where batch_id=any(batch_ids)) then$old$;
  new_guard constant text := $new$if exists(select 1 from public.supplier_price_decisions d join public.supplier_price_batches b on b.id=d.batch_id
    where d.batch_id=any(batch_ids) and b.status<>'abandoned') then$new$;
  old_message constant text := 'This price list is referenced by completed pricing history and cannot be permanently deleted.';
begin
  select pg_get_functiondef('public.purge_archived_supplier_source(uuid,boolean)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 or
    (length(definition)-length(replace(definition,old_message,'')))/length(old_message)<>1 then
    raise exception 'Deployed Supplier purge differs from expected lifecycle anchors; review before migrating';
  end if;
  execute replace(replace(definition,old_guard,new_guard),old_message,
    'This price list is referenced by completed pricing history and cannot be fully deleted.');
end $migration$;

commit;
