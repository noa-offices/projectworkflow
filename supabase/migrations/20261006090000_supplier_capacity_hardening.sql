begin;

-- Supplier capacity hardening, phases A and B. Forward-only.
--  A. One Source Version per Brand + file hash: re-importing the same file reuses the existing source (any title or date),
--     and refuses a different import profile until the existing one is archived. Serialised by the existing per-Brand+hash
--     advisory lock inside the only write path, so concurrent imports cannot create two copies.
--     Read-only, System Owner-only capacity report with a deterministic duplicate / retention dry run.
--  B. Staging chunk payloads are compacted to a receipt (sha256 + bytes) once a source is imported or a match batch is final.
--     A System Owner-only helper compacts already-finalised chunks; it defaults to a dry run.
--  Also: the definition rename/archive branch now checks Brand ownership (the RPC is being patched anyway).
-- Nothing here deletes a source, a batch, a match, a decision, a binding or a Storage object.

alter table public.supplier_source_chunks alter column payload drop not null,
  add column payload_sha256 text, add column payload_bytes int, add column compacted_at timestamptz;
alter table public.supplier_price_match_chunks alter column payload drop not null,
  add column payload_sha256 text, add column payload_bytes int, add column compacted_at timestamptz;

do $migration$
declare
  definition text;
  old_reuse constant text := $old$select id into entity_id from public.supplier_source_versions where brand_id=profile_record.brand_id and file_hash=p_payload->>'file_hash' and profile=profile_record.config and title=p_payload->>'title' and effective_from is not distinct from nullif(p_payload->>'effective_from','')::date and received_at is not distinct from nullif(p_payload->>'received_at','')::date and status<>'archived' order by created_at desc limit 1;$old$;
  new_reuse constant text := $new$select id into entity_id from public.supplier_source_versions where brand_id=profile_record.brand_id and file_hash=p_payload->>'file_hash' and status<>'archived' order by (status='imported') desc, created_at, id limit 1;
    if entity_id is not null and exists(select 1 from public.supplier_source_versions where id=entity_id and profile is distinct from profile_record.config) then
      raise exception 'Supplier source already exists for this Brand and file (%). It uses a different import profile; archive it before importing the file again.', entity_id;
    end if;$new$;
  old_finalize constant text := $old$update public.supplier_source_versions set status='imported',stored_rows=rows_count,stored_cells=cells_count,identity_count=(select count(*) from public.supplier_source_identities where source_id=s.id) where id=s.id;$old$;
  new_finalize constant text := old_finalize || $new$
      -- Durable rows, cells and identities now exist: keep only a receipt of each staging chunk.
      update public.supplier_source_chunks set payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload_bytes=pg_column_size(payload),payload=null,compacted_at=now() where source_id=s.id and payload is not null;$new$;
  old_batch constant text := $old$update public.supplier_price_batches set status='review' where id=b.id;$old$;
  new_batch constant text := old_batch || $new$
      update public.supplier_price_match_chunks set payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload_bytes=pg_column_size(payload),payload=null,compacted_at=now() where batch_id=b.id and payload is not null;$new$;
  -- Brand ownership for rename/archive: a guard in front of the update (the update tail is not unique in the function body).
  old_rename constant text := $old$update public.supplier_source_definitions set name=coalesce($old$;
  new_rename constant text := $new$if not exists(select 1 from public.supplier_source_definitions where id=(p_payload->>'id')::uuid and brand_id=(p_payload->>'brand_id')::uuid) then raise exception 'Source definition unavailable'; end if;
      update public.supplier_source_definitions set name=coalesce($new$;
  anchor text;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  foreach anchor in array array[old_reuse, old_finalize, old_batch, old_rename] loop
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
    end if;
  end loop;
  execute replace(replace(replace(replace(definition,old_reuse,new_reuse),old_finalize,new_finalize),old_batch,new_batch),old_rename,new_rename);
end $migration$;

create function public.supplier_capacity_require_owner() returns void language plpgsql stable set search_path='' as $$
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'system_owner' or public.current_account_status() is distinct from 'active' then raise insufficient_privilege; end if;
end $$;
revoke all on function public.supplier_capacity_require_owner() from public;

-- Read-only. Definer only so the System Owner sees every Brand's supplier data and relation sizes in one consistent snapshot.
-- Per-source and per-batch bytes are estimates: each source's share of rows/cells/identities/matches times that table's footprint,
-- plus the exact staging-payload bytes. Logical estimates only; DELETE does not shrink the database file by itself.
create function public.supplier_capacity_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
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
      row_number() over (partition by b.source_id order by b.created_at desc, b.id desc) newest
    from public.supplier_price_batches b),
  bat2 as (
    select bat.*, (bat.matches_n*coalesce(sz.matches_b,0)/nullif(tot.matches_n,0))::bigint + bat.chunk_bytes est_bytes,
      case when bat.decisions_n>0 then 'KEEP_PROTECTED_DECISIONS'
        when bat.status='completed' or bat.brand_price_list_update_id is not null then 'KEEP_PROTECTED_COMPLETED'
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
      (select coalesce(sum(bat2.est_bytes),0) from bat2 where bat2.source_id=v.id) batch_bytes,
      (select count(*) from public.supplier_price_bindings x where x.brand_id=v.brand_id) brand_bindings_n,
      (select coalesce(array_agg(distinct d.key||'='||d.decision order by d.key||'='||d.decision),'{}') from public.supplier_price_decisions d join public.supplier_price_batches pb on pb.id=d.batch_id where pb.source_id=v.id) decision_set
    from public.supplier_source_versions v join public.brands br on br.id=v.brand_id),
  src2 as (
    select src.*, (src.decisions_n>0 or src.completed_n>0 or src.definition_id is not null) meaningful,
      ((src.rows_n*coalesce(sz.rows_b,0)/nullif(tot.rows_n,0)) + (src.cells_n*coalesce(sz.cells_b,0)/nullif(tot.cells_n,0)) + (src.ids_n*coalesce(sz.ids_b,0)/nullif(tot.ids_n,0)))::bigint + src.chunk_bytes + src.batch_bytes est_bytes,
      exists(select 1 from public.supplier_source_versions o where o.id<>src.id and o.status<>'archived' and src.working_reference is not null and (o.working_reference=src.working_reference or o.original_reference=src.working_reference)) storage_shared
    from src, sz, tot),
  dup as (
    select src2.*, row_number() over (partition by brand_id, file_hash order by meaningful desc, review_batches_n>0 desc, (status='imported') desc, created_at, id) rank
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
          'matches', matches_n, 'review_units', units_n, 'decisions', decisions_n, 'decision_set', decision_set, 'completed_batches', completed_n, 'linked_source_definition', definition_id is not null,
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

-- Compacts staging payloads that finalised before this migration. Imports and batches still in progress are never touched.
-- Dry run by default; even a real run removes only staging JSON, never rows, cells, identities, matches or decisions.
create function public.supplier_capacity_compact_finalized(p_dry_run boolean default true) returns jsonb language plpgsql security definer set search_path='' as $$
declare source_chunks int; source_bytes bigint; match_chunks int; match_bytes bigint;
begin
  perform public.supplier_capacity_require_owner();
  select count(*), coalesce(sum(pg_column_size(k.payload)),0) into source_chunks, source_bytes from public.supplier_source_chunks k join public.supplier_source_versions v on v.id=k.source_id where v.status in ('imported','archived') and k.payload is not null;
  select count(*), coalesce(sum(pg_column_size(k.payload)),0) into match_chunks, match_bytes from public.supplier_price_match_chunks k join public.supplier_price_batches b on b.id=k.batch_id where b.status in ('review','completed','archived') and k.payload is not null;
  if not coalesce(p_dry_run, true) then
    update public.supplier_source_chunks k set payload_sha256=encode(sha256(convert_to(k.payload::text,'UTF8')),'hex'),payload_bytes=pg_column_size(k.payload),payload=null,compacted_at=now()
      from public.supplier_source_versions v where v.id=k.source_id and v.status in ('imported','archived') and k.payload is not null;
    update public.supplier_price_match_chunks k set payload_sha256=encode(sha256(convert_to(k.payload::text,'UTF8')),'hex'),payload_bytes=pg_column_size(k.payload),payload=null,compacted_at=now()
      from public.supplier_price_batches b where b.id=k.batch_id and b.status in ('review','completed','archived') and k.payload is not null;
  end if;
  return jsonb_build_object('dry_run', coalesce(p_dry_run, true), 'source_chunks', source_chunks, 'source_chunk_bytes', source_bytes, 'match_chunks', match_chunks, 'match_chunk_bytes', match_bytes);
end $$;
revoke all on function public.supplier_capacity_compact_finalized(boolean) from public;
grant execute on function public.supplier_capacity_compact_finalized(boolean) to authenticated;

commit;
