begin;

-- Reuse Phase F's identity/evidence/count checks and raw row/cell compactor for
-- finalized archives too. Completion/matches/decisions/receipts remain intact.
do $migration$
declare definition text;
  anchor constant text := $old$if s.status<>'imported' then reasons := reasons || ('Source is not imported ('||s.status||')'); end if;$old$;
begin
  select pg_get_functiondef('public.supplier_compact_finalized_source(uuid,boolean)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Phase F compaction differs from expected body; review before migrating';
  end if;
  execute replace(definition,anchor,$new$if s.status not in ('imported','archived') then reasons := reasons || ('Source is not finalized ('||s.status||')'); end if;$new$);
end $migration$;

create function public.remove_supplier_source_technical_data(p_source_id uuid, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; operative uuid; expected_path text; paths text[]; compacted jsonb;
begin
  perform public.supplier_capacity_require_owner();
  if p_confirm is distinct from true then raise exception 'Explicit technical cleanup confirmation required.'; end if;
  select * into strict s from public.supplier_source_versions where id=p_source_id;
  -- Deterministic locks on the Brand's version and review metadata before checking lifecycle eligibility.
  perform 1 from public.supplier_source_versions where brand_id=s.brand_id order by id for update;
  perform 1 from public.supplier_price_batches where brand_id=s.brand_id order by id for update;
  select * into strict s from public.supplier_source_versions where id=p_source_id;
  if s.status not in ('imported','archived') then raise exception 'Only finalized historical Supplier sources can be cleaned.'; end if;
  if exists(select 1 from public.supplier_price_batches where source_id=s.id and status in ('matching','review')) then
    raise exception 'Leave all open reviews before removing source technical data.';
  end if;
  if not exists(select 1 from public.supplier_price_batches where source_id=s.id and status='completed' and completed_at is not null) then
    raise exception 'A durable completed review is required for preserve-history cleanup.';
  end if;
  -- Mirrors the completion-aware view baseline: future dates are never applicable;
  -- the latest successful completion replaces the prior baseline.
  select v.id into operative from public.supplier_source_versions v
    where v.brand_id=s.brand_id and v.definition_id is not distinct from s.definition_id and v.status='imported'
      and (v.effective_from is null or v.effective_from <= (now() at time zone 'Asia/Dubai')::date)
      and exists(select 1 from public.supplier_price_batches b where b.source_id=v.id and b.status='completed' and b.completed_at is not null)
    order by (select max(b.completed_at) from public.supplier_price_batches b where b.source_id=v.id and b.status='completed') desc, v.created_at desc, v.id desc limit 1;
  if operative=s.id or (s.status='imported' and s.effective_from > (now() at time zone 'Asia/Dubai')::date) then
    raise exception 'Archive the current or upcoming price list before removing its technical data.';
  end if;
  -- This operation deletes only raw rows/cells after validating retained identity evidence.
  compacted := public.supplier_compact_finalized_source(s.id,false);
  expected_path := s.brand_id::text || '/' || s.id::text || '/' || s.file_hash || '.' || s.source_type;
  -- Shared/external/audit-linked files are retained. Only the canonical owned upload is disposable.
  if exists(select 1 from storage.objects where bucket_id='supplier-price-sources' and name=expected_path)
    and not exists(select 1 from public.supplier_source_versions v where v.id<>s.id and (v.working_reference=expected_path or v.original_reference=expected_path))
    and not exists(select 1 from public.brand_price_list_updates u where position(expected_path in coalesce(u.attachment_url,'') || coalesce(u.notes,''))>0)
    and not exists(select 1 from public.audit_activity_log a where position(expected_path in coalesce(a.metadata::text,'') || coalesce(a.description,''))>0) then
    insert into supplier_price_private.source_file_cleanup(source_id,path,requested_by)
      values(s.id,expected_path,auth.uid()) on conflict do nothing;
    update public.supplier_source_versions set
      working_reference=case when working_reference=expected_path then null else working_reference end,
      original_reference=case when original_reference=expected_path then null else original_reference end
      where id=s.id;
  end if;
  select coalesce(array_agg(path order by path),'{}') into paths from supplier_price_private.source_file_cleanup where source_id=s.id;
  return jsonb_build_object('source_id',s.id,'compaction',compacted,'storage_paths',to_jsonb(paths),'history_preserved',true);
end $$;
revoke all on function public.remove_supplier_source_technical_data(uuid,boolean) from public, anon;
grant execute on function public.remove_supplier_source_technical_data(uuid,boolean) to authenticated;

commit;
