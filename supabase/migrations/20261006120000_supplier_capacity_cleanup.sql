begin;

-- Supplier capacity, phases C and D. Forward-only; deletes nothing when applied.
--  * Applied Product price history (Supplier Apply writes "batch: <id>;" into the history note) now protects a review and its source,
--    and outranks other state when choosing the canonical copy of a duplicated file.
--  * System Owner-only dry runs and executors for explicitly named duplicate sources and superseded review runs.
--    Dry run is the default; a real run locks, re-checks everything and aborts the whole call on any unsafe item.
--  * No Storage object is deleted; no Product, price history or quotation row is touched.
--  * The partial unique index on (brand_id, file_hash) for non-archived sources is deliberately NOT created here:
--    live duplicates still exist. It belongs in a tiny migration after the approved cleanup.

-- A batch is linked to applied price history when a Product price-history note carries its id (written by Supplier Apply).
create function public.supplier_capacity_batch_applied(p_batch uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.product_template_price_history h where h.note like '%batch: '||p_batch::text||';%')
    or exists(select 1 from public.product_template_detail_price_history h where h.note like '%batch: '||p_batch::text||';%');
$$;
revoke all on function public.supplier_capacity_batch_applied(uuid) from public;

-- One retention verdict per batch, used by the dry run and re-checked by the executor under lock.
-- Protected: in progress, completed / linked to a Brand price list, applied history, any decision (reviewed, skip, reject,
-- mapping_proposed, confirmed_unchanged, excluded_from_source), the newest batch of its source, or a source still importing.
create function public.supplier_capacity_batch_verdict(p_batch uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare b public.supplier_price_batches; s public.supplier_source_versions; decisions int; matches int; chunks int; units int; applied boolean; newest boolean; verdict text; reason text; est bigint;
begin
  select * into b from public.supplier_price_batches where id=p_batch;
  if not found then return jsonb_build_object('batch_id', p_batch, 'classification', 'MISSING', 'reason', 'Batch not found', 'safe_to_delete', false); end if;
  select * into s from public.supplier_source_versions where id=b.source_id;
  select count(*) into decisions from public.supplier_price_decisions where batch_id=b.id;
  select count(*) into matches from public.supplier_price_matches where batch_id=b.id;
  select count(*) into chunks from public.supplier_price_match_chunks where batch_id=b.id;
  select count(*) into units from public.supplier_template_review_units where batch_id=b.id;
  applied := public.supplier_capacity_batch_applied(b.id);
  newest := not exists(select 1 from public.supplier_price_batches o where o.source_id=b.source_id and (o.created_at, o.id) > (b.created_at, b.id));
  select coalesce(sum(pg_column_size(m.*)),0) + coalesce((select sum(pg_column_size(k.*)) from public.supplier_price_match_chunks k where k.batch_id=b.id),0) into est from public.supplier_price_matches m where m.batch_id=b.id;
  if s.status in ('uploading','importing','failed') then verdict := 'KEEP_SOURCE_PROTECTED'; reason := 'Its Supplier source import is not finished';
  elsif b.status='matching' then verdict := 'KEEP_IN_PROGRESS'; reason := 'Matching is still in progress';
  elsif b.status='completed' or b.completed_at is not null or b.brand_price_list_update_id is not null then verdict := 'KEEP_PROTECTED_COMPLETED'; reason := 'Completed or linked to a Brand price list';
  elsif applied then verdict := 'KEEP_PROTECTED_APPLIED'; reason := 'Applied Product price history references this review';
  elsif decisions>0 then verdict := 'KEEP_PROTECTED_DECISIONS'; reason := decisions||' review decision(s)';
  elsif newest then verdict := 'KEEP_CURRENT'; reason := 'Newest review of its Supplier source';
  else verdict := 'SUPERSEDED_SAFE_TO_DELETE'; reason := 'Superseded by a newer review of the same source; no decisions, completion or applied history';
  end if;
  return jsonb_build_object('batch_id', b.id, 'source_id', b.source_id, 'status', b.status, 'created_at', b.created_at, 'classification', verdict, 'reason', reason,
    'matches', matches, 'match_chunks', chunks, 'review_units', units, 'decisions', decisions, 'applied_history', applied, 'estimated_bytes', est, 'safe_to_delete', verdict='SUPERSEDED_SAFE_TO_DELETE');
end $$;
revoke all on function public.supplier_capacity_batch_verdict(uuid) from public;


create or replace function public.supplier_capacity_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.supplier_capacity_require_owner();
  with
  rel as (select c.relname, pg_total_relation_size(c.oid) total_bytes, pg_table_size(c.oid) table_bytes, pg_indexes_size(c.oid) index_bytes
    from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'supplier\_%'),
  tot as (select (select count(*) from public.supplier_source_rows) rows_n, (select count(*) from public.supplier_source_cells) cells_n,
    (select count(*) from public.supplier_source_identities) ids_n, (select count(*) from public.supplier_price_matches) matches_n),
  sz as (select max(total_bytes) filter (where relname='supplier_source_rows') rows_b, max(total_bytes) filter (where relname='supplier_source_cells') cells_b,
    max(total_bytes) filter (where relname='supplier_source_identities') ids_b, max(total_bytes) filter (where relname='supplier_price_matches') matches_b from rel),
  bat as (
    select b.id, b.source_id, b.status, b.scope, b.created_at, b.brand_price_list_update_id,
      (select count(*) from public.supplier_price_matches m where m.batch_id=b.id) matches_n,
      (select count(*) from public.supplier_price_match_chunks k where k.batch_id=b.id) chunks_n,
      (select coalesce(sum(pg_column_size(k.payload)),0) from public.supplier_price_match_chunks k where k.batch_id=b.id) chunk_bytes,
      (select count(*) from public.supplier_template_review_units u where u.batch_id=b.id) units_n,
      (select count(*) from public.supplier_price_decisions d where d.batch_id=b.id) decisions_n,
      public.supplier_capacity_batch_applied(b.id) applied,
      row_number() over (partition by b.source_id order by b.created_at desc, b.id desc) newest
    from public.supplier_price_batches b),
  bat2 as (
    select bat.*, (bat.matches_n*coalesce(sz.matches_b,0)/nullif(tot.matches_n,0))::bigint + bat.chunk_bytes est_bytes,
      case when bat.decisions_n>0 then 'KEEP_PROTECTED_DECISIONS'
        when bat.status='completed' or bat.brand_price_list_update_id is not null then 'KEEP_PROTECTED_COMPLETED'
        when bat.applied then 'KEEP_PROTECTED_APPLIED'
        when bat.status='matching' then 'KEEP_IN_PROGRESS'
        when bat.newest=1 then 'KEEP_CURRENT'
        else 'SUPERSEDED_SAFE_TO_DELETE' end retention
    from bat, sz, tot),
  src as (
    select v.id, v.brand_id, br.name brand, v.filename, v.title, v.file_hash, v.status, v.created_at, v.definition_id, v.working_reference, v.original_reference,
      (select count(*) from public.supplier_source_rows r where r.source_id=v.id) rows_n,
      (select count(*) from public.supplier_source_cells r where r.source_id=v.id) cells_n,
      (select count(*) from public.supplier_source_identities r where r.source_id=v.id) ids_n,
      (select count(*) from public.supplier_source_chunks k where k.source_id=v.id) chunks_n,
      (select coalesce(sum(pg_column_size(k.payload)),0) from public.supplier_source_chunks k where k.source_id=v.id) chunk_bytes,
      (select count(*) from bat2 where bat2.source_id=v.id) batches_n,
      (select count(*) from bat2 where bat2.source_id=v.id and bat2.status='review') review_batches_n,
      (select coalesce(sum(bat2.matches_n),0) from bat2 where bat2.source_id=v.id) matches_n,
      (select coalesce(sum(bat2.units_n),0) from bat2 where bat2.source_id=v.id) units_n,
      (select coalesce(sum(bat2.decisions_n),0) from bat2 where bat2.source_id=v.id) decisions_n,
      (select count(*) from bat2 where bat2.source_id=v.id and bat2.retention='KEEP_PROTECTED_COMPLETED') completed_n,
      (select count(*) from bat2 where bat2.source_id=v.id and bat2.applied) applied_n,
      (select coalesce(sum(bat2.est_bytes),0) from bat2 where bat2.source_id=v.id) batch_bytes,
      (select count(*) from public.supplier_price_bindings x where x.brand_id=v.brand_id) brand_bindings_n,
      (select coalesce(array_agg(distinct d.key||'='||d.decision order by d.key||'='||d.decision),'{}') from public.supplier_price_decisions d join public.supplier_price_batches pb on pb.id=d.batch_id where pb.source_id=v.id) decision_set
    from public.supplier_source_versions v join public.brands br on br.id=v.brand_id),
  src2 as (
    select src.*, (src.decisions_n>0 or src.completed_n>0 or src.applied_n>0 or src.definition_id is not null) meaningful,
      ((src.rows_n*coalesce(sz.rows_b,0)/nullif(tot.rows_n,0)) + (src.cells_n*coalesce(sz.cells_b,0)/nullif(tot.cells_n,0)) + (src.ids_n*coalesce(sz.ids_b,0)/nullif(tot.ids_n,0)))::bigint + src.chunk_bytes + src.batch_bytes est_bytes,
      exists(select 1 from public.supplier_source_versions o where o.id<>src.id and o.status<>'archived' and src.working_reference is not null and (o.working_reference=src.working_reference or o.original_reference=src.working_reference)) storage_shared
    from src, sz, tot),
  dup as (
    select src2.*, row_number() over (partition by brand_id, file_hash order by applied_n>0 or completed_n>0 desc, meaningful desc, review_batches_n>0 desc, (status='imported') desc, created_at, id) rank
    from src2 where status<>'archived' and file_hash ~ '^[a-f0-9]{64}$'
      and (brand_id, file_hash) in (select brand_id, file_hash from src2 where status<>'archived' group by brand_id, file_hash having count(*)>1)),
  dup2 as (
    select dup.*, case when rank=1 then 'CANONICAL'
        when status in ('uploading','importing','failed') then 'PROTECTED'
        when meaningful then 'MANUAL_REVIEW_REQUIRED'
        else 'SAFE_CANDIDATE' end classification
    from dup)
  select jsonb_build_object(
    'generated_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'supplier_bytes', (select sum(total_bytes) from rel),
    'tables', (select jsonb_agg(jsonb_build_object('name', relname, 'total_bytes', total_bytes, 'table_bytes', table_bytes, 'index_bytes', index_bytes,
        'rows', case relname when 'supplier_source_rows' then tot.rows_n when 'supplier_source_cells' then tot.cells_n when 'supplier_source_identities' then tot.ids_n when 'supplier_price_matches' then tot.matches_n end) order by total_bytes desc) from rel, tot),
    'protected_sources', (select coalesce(jsonb_agg(jsonb_build_object('source_id', id, 'brand', brand, 'filename', filename, 'status', status, 'rows', rows_n, 'reason', 'Import not finished: never cleaned or compacted') order by created_at), '[]') from src2 where status in ('uploading','importing','failed')),
    'duplicate_groups', (select coalesce(jsonb_agg(g order by g->>'file_hash'), '[]') from (
      select jsonb_build_object('brand', min(brand), 'brand_id', brand_id, 'file_hash', file_hash,
        'classification', case when bool_or(classification='MANUAL_REVIEW_REQUIRED') then 'MANUAL_REVIEW_REQUIRED' when bool_or(classification='SAFE_CANDIDATE') then 'SAFE_CANDIDATE' else 'PROTECTED' end,
        'canonical_source_id', (array_agg(id order by rank))[1],
        'members', jsonb_agg(jsonb_build_object('source_id', id, 'filename', filename, 'title', title, 'status', status, 'created_at', created_at, 'classification', classification,
          'rows', rows_n, 'cells', cells_n, 'identities', ids_n, 'chunks', chunks_n, 'chunk_payload_bytes', chunk_bytes, 'batches', batches_n, 'review_batches', review_batches_n,
          'matches', matches_n, 'review_units', units_n, 'decisions', decisions_n, 'decision_set', decision_set, 'completed_batches', completed_n, 'applied_batches', applied_n, 'linked_source_definition', definition_id is not null,
          'brand_bindings', brand_bindings_n, 'working_reference', working_reference, 'storage_shared', storage_shared, 'estimated_bytes', est_bytes) order by rank),
        'reclaimable_bytes', coalesce(sum(est_bytes) filter (where classification='SAFE_CANDIDATE'), 0)) g
      from dup2 group by brand_id, file_hash) groups),
    'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_id', id, 'source_id', source_id, 'status', status, 'scope', scope, 'created_at', created_at, 'matches', matches_n,
        'match_chunk_payload_bytes', chunk_bytes, 'review_units', units_n, 'decisions', decisions_n, 'retention', retention, 'estimated_bytes', est_bytes) order by source_id, created_at), '[]') from bat2),
    'compaction', jsonb_build_object(
      'source_chunk_bytes', (select coalesce(sum(pg_column_size(k.payload)),0) from public.supplier_source_chunks k join public.supplier_source_versions v on v.id=k.source_id where v.status in ('imported','archived')),
      'match_chunk_bytes', (select coalesce(sum(pg_column_size(k.payload)),0) from public.supplier_price_match_chunks k join public.supplier_price_batches b on b.id=k.batch_id where b.status in ('review','completed','archived'))),
    'reclaimable', jsonb_build_object(
      'duplicate_sources_bytes', (select coalesce(sum(est_bytes),0) from dup2 where classification='SAFE_CANDIDATE'),
      'superseded_batches_bytes', (select coalesce(sum(bat2.est_bytes),0) from bat2 where retention='SUPERSEDED_SAFE_TO_DELETE' and bat2.source_id not in (select id from dup2 where classification='SAFE_CANDIDATE')),
      'superseded_match_rows', (select coalesce(sum(bat2.matches_n),0) from bat2 where retention='SUPERSEDED_SAFE_TO_DELETE'))
  ) into result;
  return result;
end $$;
revoke all on function public.supplier_capacity_report() from public;
grant execute on function public.supplier_capacity_report() to authenticated;

-- Phase D: delete only explicitly named superseded review runs. Dry run by default. A real run locks every batch,
-- re-checks every verdict and aborts the whole call if any batch is not SUPERSEDED_SAFE_TO_DELETE.
create function public.cleanup_supplier_review_batches(p_batch_ids uuid[], p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; verdicts jsonb := '[]'::jsonb; v jsonb; bid uuid; deleted jsonb := jsonb_build_object('batches',0,'matches',0,'match_chunks',0,'review_units',0); n int;
begin
  perform public.supplier_capacity_require_owner();
  ids := array(select distinct x from unnest(coalesce(p_batch_ids,'{}')) x where x is not null order by x);
  if cardinality(ids)=0 then raise exception 'Name the review batches to clean up'; end if;
  if not coalesce(p_dry_run, true) then perform 1 from public.supplier_price_batches where id=any(ids) order by id for update; end if;
  foreach bid in array ids loop verdicts := verdicts || public.supplier_capacity_batch_verdict(bid); end loop;
  if coalesce(p_dry_run, true) then return jsonb_build_object('dry_run', true, 'batches', verdicts); end if;
  for v in select value from jsonb_array_elements(verdicts) loop
    if not (v->>'safe_to_delete')::boolean then raise exception 'Review batch % is %: %. Nothing was deleted.', v->>'batch_id', v->>'classification', v->>'reason'; end if;
  end loop;
  foreach bid in array ids loop
    if exists(select 1 from public.supplier_price_decisions where supplier_price_decisions.batch_id=bid) then raise exception 'Review batch % gained a decision. Nothing was deleted.', bid; end if;
    delete from public.supplier_template_review_units u where u.batch_id=bid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{review_units}',to_jsonb((deleted->>'review_units')::int+n));
    delete from public.supplier_price_match_chunks k where k.batch_id=bid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{match_chunks}',to_jsonb((deleted->>'match_chunks')::int+n));
    delete from public.supplier_price_matches m where m.batch_id=bid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{matches}',to_jsonb((deleted->>'matches')::int+n));
    delete from public.supplier_price_batches b where b.id=bid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{batches}',to_jsonb((deleted->>'batches')::int+n));
  end loop;
  return jsonb_build_object('dry_run', false, 'batches', verdicts, 'deleted', deleted);
end $$;
revoke all on function public.cleanup_supplier_review_batches(uuid[], boolean) from public;
grant execute on function public.cleanup_supplier_review_batches(uuid[], boolean) to authenticated;

-- Phase C verdict for one requested duplicate against an explicit canonical source.
create function public.supplier_capacity_duplicate_verdict(p_canonical uuid, p_duplicate uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare c public.supplier_source_versions; d public.supplier_source_versions; reasons text[] := '{}'; protected text[] := '{}';
  decisions int; unique_decisions int; batches int; matches int; units int; chunks int; rows_n int; cells int; ids int; applied int; completed int; running int; shared boolean; est bigint; verdict text;
begin
  select * into c from public.supplier_source_versions where id=p_canonical;
  select * into d from public.supplier_source_versions where id=p_duplicate;
  if c.id is null then return jsonb_build_object('source_id', p_duplicate, 'classification', 'PROTECTED', 'reasons', jsonb_build_array('Canonical source not found'), 'safe_to_delete', false); end if;
  if d.id is null then return jsonb_build_object('source_id', p_duplicate, 'classification', 'PROTECTED', 'reasons', jsonb_build_array('Duplicate source not found'), 'safe_to_delete', false); end if;
  if d.id=c.id then protected := protected || text 'This is the canonical source'; end if;
  if d.brand_id<>c.brand_id then protected := protected || text 'Different Brand from the canonical source'; end if;
  if d.file_hash is distinct from c.file_hash or d.file_hash !~ '^[a-f0-9]{64}$' then protected := protected || text 'Different or missing file hash'; end if;
  if c.status<>'imported' then protected := protected || text 'Canonical source is not imported'; end if;
  if d.status not in ('imported','archived') then protected := protected || ('Duplicate import is not finished ('||d.status||')'); end if;
  select count(*) into batches from public.supplier_price_batches where source_id=d.id;
  select count(*) into running from public.supplier_price_batches where source_id=d.id and status='matching';
  if running>0 then protected := protected || text 'A review run of this source is still matching'; end if;
  select count(*) into completed from public.supplier_price_batches where source_id=d.id and (status='completed' or completed_at is not null or brand_price_list_update_id is not null);
  select count(*) into applied from public.supplier_price_batches pb where pb.source_id=d.id and public.supplier_capacity_batch_applied(pb.id);
  select count(*) into decisions from public.supplier_price_decisions x join public.supplier_price_batches pb on pb.id=x.batch_id where pb.source_id=d.id;
  -- A duplicate decision is equivalent when the canonical source has the same decision, note, proposals and targets for the same match key.
  select count(*) into unique_decisions from public.supplier_price_decisions x join public.supplier_price_batches pb on pb.id=x.batch_id join public.supplier_price_matches m on m.batch_id=x.batch_id and m.key=x.key
    where pb.source_id=d.id and not exists(select 1 from public.supplier_price_decisions y join public.supplier_price_batches cb on cb.id=y.batch_id join public.supplier_price_matches cm on cm.batch_id=y.batch_id and cm.key=y.key
      where cb.source_id=c.id and y.key=x.key and y.decision=x.decision and y.note=x.note and y.proposed_target_keys=x.proposed_target_keys
        and (select array_agg(t->>'key' order by t->>'key') from jsonb_array_elements(cm.data->'targets') t) is not distinct from (select array_agg(t->>'key' order by t->>'key') from jsonb_array_elements(m.data->'targets') t));
  if d.definition_id is not null then reasons := reasons || text 'Linked to a Supplier source definition'; end if;
  if completed>0 then reasons := reasons || (completed||' completed review(s)'); end if;
  if applied>0 then reasons := reasons || (applied||' review(s) referenced by applied Product price history'); end if;
  if unique_decisions>0 then reasons := reasons || (unique_decisions||' review decision(s) not present on the canonical source');
  elsif decisions>0 then reasons := reasons || ('DUPLICATED_EQUIVALENT_STATE: '||decisions||' decision(s) identical to the canonical source'); end if;
  select count(*) into matches from public.supplier_price_matches m join public.supplier_price_batches pb on pb.id=m.batch_id where pb.source_id=d.id;
  select count(*) into units from public.supplier_template_review_units u join public.supplier_price_batches pb on pb.id=u.batch_id where pb.source_id=d.id;
  select count(*) into chunks from public.supplier_source_chunks where source_id=d.id;
  select count(*) into rows_n from public.supplier_source_rows where source_id=d.id;
  select count(*) into cells from public.supplier_source_cells where source_id=d.id;
  select count(*) into ids from public.supplier_source_identities where source_id=d.id;
  shared := exists(select 1 from public.supplier_source_versions o where o.id<>d.id and d.working_reference is not null and d.working_reference<>'' and (o.working_reference=d.working_reference or o.original_reference=d.working_reference))
    or exists(select 1 from public.supplier_source_versions o where o.id<>d.id and coalesce(d.original_reference,'')<>'' and (o.working_reference=d.original_reference or o.original_reference=d.original_reference));
  est := (select coalesce(sum(pg_column_size(r.*)),0) from public.supplier_source_rows r where r.source_id=d.id) + (select coalesce(sum(pg_column_size(x.*)),0) from public.supplier_source_cells x where x.source_id=d.id)
    + (select coalesce(sum(pg_column_size(x.*)),0) from public.supplier_source_identities x where x.source_id=d.id) + (select coalesce(sum(pg_column_size(x.*)),0) from public.supplier_source_chunks x where x.source_id=d.id)
    + (select coalesce(sum(pg_column_size(m.*)),0) from public.supplier_price_matches m join public.supplier_price_batches pb on pb.id=m.batch_id where pb.source_id=d.id)
    + (select coalesce(sum(pg_column_size(k.*)),0) from public.supplier_price_match_chunks k join public.supplier_price_batches pb on pb.id=k.batch_id where pb.source_id=d.id);
  verdict := case when cardinality(protected)>0 then 'PROTECTED' when cardinality(reasons)>0 then 'MANUAL_REVIEW_REQUIRED' else 'SAFE_TO_DELETE' end;
  return jsonb_build_object('source_id', d.id, 'canonical_source_id', c.id, 'status', d.status, 'title', d.title, 'created_at', d.created_at, 'classification', verdict, 'reasons', to_jsonb(protected || reasons),
    'safe_to_delete', verdict='SAFE_TO_DELETE',
    -- Only identical decisions block: an approver can confirm them, and nothing else stands in the way.
    'safe_after_equivalence_confirmation', verdict='MANUAL_REVIEW_REQUIRED' and cardinality(reasons)=1 and reasons[1] like 'DUPLICATED_EQUIVALENT_STATE%',
    'batches', batches, 'matches', matches, 'review_units', units, 'decisions', decisions, 'unique_decisions', unique_decisions, 'applied_reviews', applied, 'completed_reviews', completed,
    'chunks', chunks, 'rows', rows_n, 'cells', cells, 'identities', ids, 'working_reference', d.working_reference, 'original_reference', d.original_reference,
    'storage_shared', shared, 'storage_object_candidate', case when shared then null else nullif(d.working_reference,'') end, 'estimated_bytes', est);
end $$;
revoke all on function public.supplier_capacity_duplicate_verdict(uuid, uuid) from public;

-- Phase C: delete only explicitly named duplicates of an explicit canonical source. Dry run by default.
-- A real run locks the canonical and every duplicate, re-checks every verdict, and aborts the whole call unless each one is
-- SAFE_TO_DELETE (or, with p_confirm_equivalent_state, blocked only by decisions identical to the canonical's).
-- Storage objects are never deleted here: unshared paths are returned as candidates for a separate decision.
create function public.cleanup_duplicate_supplier_sources(p_canonical_source uuid, p_duplicate_source_ids uuid[], p_dry_run boolean default true, p_confirm_equivalent_state boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[]; verdicts jsonb := '[]'::jsonb; v jsonb; sid uuid; batch_ids uuid[]; deleted jsonb := '{}'::jsonb; n int; table_name text;
begin
  perform public.supplier_capacity_require_owner();
  ids := array(select distinct x from unnest(coalesce(p_duplicate_source_ids,'{}')) x where x is not null order by x);
  if p_canonical_source is null or cardinality(ids)=0 then raise exception 'Name the canonical source and the duplicates to clean up'; end if;
  if not coalesce(p_dry_run, true) then
    perform 1 from public.supplier_source_versions where id=p_canonical_source or id=any(ids) order by id for update;
    perform 1 from public.supplier_price_batches where source_id=any(ids) order by id for update;
  end if;
  foreach sid in array ids loop verdicts := verdicts || public.supplier_capacity_duplicate_verdict(p_canonical_source, sid); end loop;
  if coalesce(p_dry_run, true) then return jsonb_build_object('dry_run', true, 'canonical_source_id', p_canonical_source, 'duplicates', verdicts); end if;
  for v in select value from jsonb_array_elements(verdicts) loop
    if not ((v->>'safe_to_delete')::boolean or (coalesce(p_confirm_equivalent_state,false) and (v->>'safe_after_equivalence_confirmation')::boolean)) then
      raise exception 'Supplier source % is %: %. Nothing was deleted.', v->>'source_id', v->>'classification', v->'reasons';
    end if;
  end loop;
  foreach table_name in array array['supplier_price_decisions','supplier_template_review_units','supplier_price_match_chunks','supplier_price_matches','supplier_price_batches','supplier_source_identities','supplier_source_cells','supplier_source_rows','supplier_source_chunks','supplier_source_versions'] loop
    deleted := deleted || jsonb_build_object(table_name, 0);
  end loop;
  foreach sid in array ids loop
    batch_ids := array(select id from public.supplier_price_batches where supplier_price_batches.source_id=sid);
    delete from public.supplier_price_decisions x where x.batch_id=any(batch_ids); get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_price_decisions}',to_jsonb((deleted->>'supplier_price_decisions')::int+n));
    delete from public.supplier_template_review_units x where x.batch_id=any(batch_ids); get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_template_review_units}',to_jsonb((deleted->>'supplier_template_review_units')::int+n));
    delete from public.supplier_price_match_chunks x where x.batch_id=any(batch_ids); get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_price_match_chunks}',to_jsonb((deleted->>'supplier_price_match_chunks')::int+n));
    delete from public.supplier_price_matches x where x.batch_id=any(batch_ids); get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_price_matches}',to_jsonb((deleted->>'supplier_price_matches')::int+n));
    delete from public.supplier_price_batches x where x.id=any(batch_ids); get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_price_batches}',to_jsonb((deleted->>'supplier_price_batches')::int+n));
    delete from public.supplier_source_identities x where x.source_id=sid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_source_identities}',to_jsonb((deleted->>'supplier_source_identities')::int+n));
    delete from public.supplier_source_cells x where x.source_id=sid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_source_cells}',to_jsonb((deleted->>'supplier_source_cells')::int+n));
    delete from public.supplier_source_rows x where x.source_id=sid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_source_rows}',to_jsonb((deleted->>'supplier_source_rows')::int+n));
    delete from public.supplier_source_chunks x where x.source_id=sid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_source_chunks}',to_jsonb((deleted->>'supplier_source_chunks')::int+n));
    delete from public.supplier_source_versions x where x.id=sid; get diagnostics n = row_count; deleted := jsonb_set(deleted,'{supplier_source_versions}',to_jsonb((deleted->>'supplier_source_versions')::int+n));
  end loop;
  return jsonb_build_object('dry_run', false, 'canonical_source_id', p_canonical_source, 'duplicates', verdicts, 'deleted', deleted,
    'storage_object_candidates', (select coalesce(jsonb_agg(x->'storage_object_candidate'), '[]') from jsonb_array_elements(verdicts) x where x->>'storage_object_candidate' is not null));
end $$;
revoke all on function public.cleanup_duplicate_supplier_sources(uuid, uuid[], boolean, boolean) from public;
grant execute on function public.cleanup_duplicate_supplier_sources(uuid, uuid[], boolean, boolean) to authenticated;

commit;
