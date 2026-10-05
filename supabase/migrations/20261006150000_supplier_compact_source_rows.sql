begin;

-- Supplier capacity, phase E. Forward-only; rewrites no existing data when applied.
--  * New imports keep only the import profile's columns in supplier_source_rows.raw_extras (full code, article, category,
--    description, companion note, price columns, plus any explicit profile "retained_columns"). Every other spreadsheet column
--    stays only in the original file kept in Storage. Cells and identities are unchanged, so matching is unchanged.
--  * System Owner-only, dry-run-by-default compaction of already-finalised sources, one explicit source list at a time.
--  * Previous price list lifecycle for a Supplier Source Definition: read-only state and a System Owner-only, dry-run-by-default
--    delete that reuses the batch verdicts. Keep and Archive need nothing new (archive_source already exists).
--  * No Product, price history, quotation or Storage object is touched.

-- The source-row values a profile actually uses. Same rule for XLSX, CSV and JSON: it only looks at column names.
create function public.supplier_retained_values(p_profile jsonb, p_values jsonb) returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(coalesce(p_values, '{}'::jsonb)) e
  where e.key in (p_profile->>'full_code_column', p_profile->>'article_code_column', p_profile->>'category_column', p_profile->>'description_column', p_profile->>'companion_note_column')
    or e.key in (select pc->>'column' from jsonb_array_elements(coalesce(p_profile->'price_columns', '[]'::jsonb)) pc)
    or e.key in (select jsonb_array_elements_text(case when jsonb_typeof(p_profile->'retained_columns')='array' then p_profile->'retained_columns' else '[]'::jsonb end));
$$;

do $migration$
declare
  definition text;
  old_rows constant text := $old$values(s.id,r->>'unit_key',(r->>'row_number')::int,r->>'sheet',r->'values',r->>'page_reference');$old$;
  new_rows constant text := $new$values(s.id,r->>'unit_key',(r->>'row_number')::int,r->>'sheet',public.supplier_retained_values(s.profile,r->'values'),r->>'page_reference');$new$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,old_rows,'')))/length(old_rows)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(definition,old_rows,new_rows);
end $migration$;

-- Compacts finalised sources only. Projected bytes are exact for the named sources. Explicit sources keep each call bounded.
create function public.supplier_capacity_compact_source_rows(p_source_ids uuid[], p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb := '[]'::jsonb; v public.supplier_source_versions; sid uuid; rows_n int; changed int; raw_bytes bigint; kept_bytes bigint;
begin
  perform public.supplier_capacity_require_owner();
  if cardinality(coalesce(p_source_ids,'{}'))=0 then raise exception 'Name the Supplier sources to compact'; end if;
  foreach sid in array array(select distinct x from unnest(p_source_ids) x where x is not null order by x) loop
    select * into v from public.supplier_source_versions where id=sid for update;
    if not found then result := result || jsonb_build_object('source_id', sid, 'compacted', false, 'reason', 'Source not found'); continue; end if;
    if v.status not in ('imported','archived') then result := result || jsonb_build_object('source_id', sid, 'status', v.status, 'compacted', false, 'reason', 'Import not finished: never compacted'); continue; end if;
    select count(*), coalesce(sum(pg_column_size(r.raw_extras)),0), coalesce(sum(pg_column_size(public.supplier_retained_values(v.profile, r.raw_extras))),0),
      count(*) filter (where r.raw_extras is distinct from public.supplier_retained_values(v.profile, r.raw_extras))
      into rows_n, raw_bytes, kept_bytes, changed from public.supplier_source_rows r where r.source_id=sid;
    if not coalesce(p_dry_run, true) and changed>0 then
      update public.supplier_source_rows r set raw_extras=public.supplier_retained_values(v.profile, r.raw_extras)
        where r.source_id=sid and r.raw_extras is distinct from public.supplier_retained_values(v.profile, r.raw_extras);
    end if;
    result := result || jsonb_build_object('source_id', sid, 'status', v.status, 'rows', rows_n, 'rows_to_compact', changed, 'raw_extras_bytes', raw_bytes,
      'retained_bytes', kept_bytes, 'saved_bytes', raw_bytes-kept_bytes, 'compacted', not coalesce(p_dry_run, true) and changed>0);
  end loop;
  return jsonb_build_object('dry_run', coalesce(p_dry_run, true), 'sources', result);
end $$;
revoke all on function public.supplier_capacity_compact_source_rows(uuid[], boolean) from public;
grant execute on function public.supplier_capacity_compact_source_rows(uuid[], boolean) to authenticated;

-- Per-source row storage for the capacity report. raw_extras bytes are exact (compressed sizes); savings are sampled estimates.
create function public.supplier_capacity_source_storage() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.supplier_capacity_require_owner();
  select coalesce(jsonb_agg(x order by x->>'created_at'), '[]') into result from (
    select jsonb_build_object('source_id', v.id, 'title', v.title, 'status', v.status, 'created_at', v.created_at, 'definition_id', v.definition_id,
      'definition', (select d.name from public.supplier_source_definitions d where d.id=v.definition_id),
      'current_for_definition', v.definition_id is not null and v.status='imported' and not exists(select 1 from public.supplier_source_versions o where o.definition_id=v.definition_id and o.status='imported' and (o.created_at, o.id) > (v.created_at, v.id)),
      'rows', st.rows_n, 'raw_extras_bytes', st.raw_bytes,
      'estimated_saving_bytes', case when v.status in ('imported','archived') then (st.rows_n * greatest(sample.avg_raw - sample.avg_kept, 0))::bigint else 0 end,
      'compactable', v.status in ('imported','archived') and sample.avg_raw > sample.avg_kept) x
    from public.supplier_source_versions v
    cross join lateral (select count(*) rows_n, coalesce(sum(pg_column_size(r.raw_extras)),0) raw_bytes from public.supplier_source_rows r where r.source_id=v.id) st
    cross join lateral (select coalesce(avg(pg_column_size(r.raw_extras)),0) avg_raw, coalesce(avg(pg_column_size(public.supplier_retained_values(v.profile, r.raw_extras))),0) avg_kept
      from (select raw_extras from public.supplier_source_rows r where r.source_id=v.id limit 1000) r) sample) rows_by_source;
  return result;
end $$;
revoke all on function public.supplier_capacity_source_storage() from public;
grant execute on function public.supplier_capacity_source_storage() to authenticated;

-- Can an older version of the same Supplier Source Definition be deleted once a newer one is imported?
-- Reuses the batch verdicts: every review of the old version must be unprotected (only superseded or merely newest).
create function public.supplier_previous_source_verdict(p_current uuid, p_previous uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare c public.supplier_source_versions; p public.supplier_source_versions; reasons text[] := '{}'; review text[] := '{}'; verdict jsonb; shared boolean; batches int := 0;
begin
  select * into c from public.supplier_source_versions where id=p_current;
  select * into p from public.supplier_source_versions where id=p_previous;
  if c.id is null or p.id is null then return jsonb_build_object('source_id', p_previous, 'safe_to_delete', false, 'reasons', jsonb_build_array('Price list not found')); end if;
  if c.status<>'imported' then reasons := reasons || text 'The new price list is not fully imported'; end if;
  if c.definition_id is null or p.definition_id is distinct from c.definition_id or p.brand_id<>c.brand_id then reasons := reasons || text 'Not a version of the same Supplier source'; end if;
  if p.id=c.id or (p.created_at, p.id) >= (c.created_at, c.id) then reasons := reasons || text 'Not an older version'; end if;
  if p.status not in ('imported','archived') then reasons := reasons || ('Previous import is not finished ('||p.status||')'); end if;
  for verdict in select public.supplier_capacity_batch_verdict(b.id) from public.supplier_price_batches b where b.source_id=p.id loop
    batches := batches + 1;
    if verdict->>'classification' not in ('SUPERSEDED_SAFE_TO_DELETE','KEEP_CURRENT') then review := review || (verdict->>'classification'); end if;
  end loop;
  if cardinality(review)>0 then reasons := reasons || text 'This previous price list contains review history that must be retained.'; end if;
  shared := coalesce(p.working_reference,'')<>'' and exists(select 1 from public.supplier_source_versions o where o.id<>p.id and (o.working_reference=p.working_reference or o.original_reference=p.working_reference));
  return jsonb_build_object('source_id', p.id, 'current_source_id', c.id, 'title', p.title, 'status', p.status, 'created_at', p.created_at, 'batches', batches, 'protected_reviews', to_jsonb(review),
    'reasons', to_jsonb(reasons), 'safe_to_delete', cardinality(reasons)=0, 'storage_shared', shared, 'storage_object_candidate', case when shared then null else nullif(p.working_reference,'') end,
    'rows', (select count(*) from public.supplier_source_rows r where r.source_id=p.id));
end $$;
revoke all on function public.supplier_previous_source_verdict(uuid, uuid) from public;

-- Older versions of the current price list's Supplier source, newest first, with their verdicts. Read-only, for reviewers.
create function public.supplier_previous_source_state(p_current uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.supplier_source_versions;
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  select * into c from public.supplier_source_versions where id=p_current;
  if c.id is null or c.definition_id is null then return jsonb_build_object('current_source_id', p_current, 'previous', '[]'::jsonb); end if;
  return jsonb_build_object('current_source_id', c.id, 'definition_id', c.definition_id, 'previous', coalesce((select jsonb_agg(public.supplier_previous_source_verdict(c.id, p.id) order by p.created_at desc, p.id desc)
    from public.supplier_source_versions p where p.definition_id=c.definition_id and p.id<>c.id and p.status in ('imported','archived') and (p.created_at, p.id) < (c.created_at, c.id)), '[]'::jsonb));
end $$;
revoke all on function public.supplier_previous_source_state(uuid) from public;
grant execute on function public.supplier_previous_source_state(uuid) to authenticated;

-- Delete an older version after a newer one of the same Supplier source is imported. System Owner only, dry run by default.
-- A real run locks both versions and the old reviews, re-checks the verdict and deletes only the old version's own rows.
-- The new version, Brand bindings, decisions elsewhere, price history and Storage objects are never touched.
create function public.cleanup_previous_supplier_source(p_current_source uuid, p_previous_source uuid, p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare verdict jsonb; batch_ids uuid[]; deleted jsonb := '{}'::jsonb; n int;
begin
  perform public.supplier_capacity_require_owner();
  if not coalesce(p_dry_run, true) then
    perform 1 from public.supplier_source_versions where id in (p_current_source, p_previous_source) order by id for update;
    perform 1 from public.supplier_price_batches where source_id=p_previous_source order by id for update;
  end if;
  verdict := public.supplier_previous_source_verdict(p_current_source, p_previous_source);
  if coalesce(p_dry_run, true) then return jsonb_build_object('dry_run', true, 'previous', verdict); end if;
  if not (verdict->>'safe_to_delete')::boolean then raise exception 'Previous price list % cannot be deleted: %. Nothing was deleted.', p_previous_source, verdict->'reasons'; end if;
  batch_ids := array(select id from public.supplier_price_batches where source_id=p_previous_source);
  delete from public.supplier_template_review_units x where x.batch_id=any(batch_ids); get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_template_review_units', n);
  delete from public.supplier_price_match_chunks x where x.batch_id=any(batch_ids); get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_price_match_chunks', n);
  delete from public.supplier_price_matches x where x.batch_id=any(batch_ids); get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_price_matches', n);
  delete from public.supplier_price_batches x where x.id=any(batch_ids); get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_price_batches', n);
  delete from public.supplier_source_identities x where x.source_id=p_previous_source; get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_source_identities', n);
  delete from public.supplier_source_cells x where x.source_id=p_previous_source; get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_source_cells', n);
  delete from public.supplier_source_rows x where x.source_id=p_previous_source; get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_source_rows', n);
  delete from public.supplier_source_chunks x where x.source_id=p_previous_source; get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_source_chunks', n);
  delete from public.supplier_source_versions x where x.id=p_previous_source; get diagnostics n = row_count; deleted := deleted || jsonb_build_object('supplier_source_versions', n);
  return jsonb_build_object('dry_run', false, 'previous', verdict, 'deleted', deleted, 'storage_object_candidate', verdict->'storage_object_candidate');
end $$;
revoke all on function public.cleanup_previous_supplier_source(uuid, uuid, boolean) from public;
grant execute on function public.cleanup_previous_supplier_source(uuid, uuid, boolean) to authenticated;

commit;
