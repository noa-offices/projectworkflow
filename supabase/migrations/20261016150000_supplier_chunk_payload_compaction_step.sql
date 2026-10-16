begin;

-- Bounded, resumable compaction of a source's staging chunk payloads, runnable BEFORE the final finalize step.
-- The final step of supplier_finalize_source_step compacts every chunk payload (hash + null) in one statement; for a 200,000-row source
-- (about 800 payloads) that statement can exceed the role's statement_timeout. This function does the same per-chunk work, in at most
-- p_limit chunks per call, only after every chunk receipt and counter is complete. By then the payloads are never read again:
-- identities are built from the stored rows and cells, and a retry of a compacted chunk is answered from its receipt.
--  * Same expression as the existing compaction: sha256 of the payload text, byte size, payload := null, compacted_at := now().
--  * Source row locked FOR UPDATE; same reviewer authorization as the finalize step; exact source id.
--  * Idempotent: only chunks that still hold a payload are touched, so repeated calls simply continue and then report 0 remaining.
--  * The finalize step is NOT modified; when this has run, its own compaction finds nothing left to do.
-- Forward-only; changes no data when applied. Not run against a database when written.
create function public.supplier_compact_chunk_payloads_step(p_source_id uuid, p_limit int default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; chunk_count int; n int; left_count int;
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Compaction step size must be 1-100 chunks'; end if;
  select * into strict s from public.supplier_source_versions where id=p_source_id for update;
  if s.status not in ('uploading','importing','imported') then raise exception 'Source cannot be compacted in status %', s.status; end if;
  select count(*) into chunk_count from public.supplier_source_chunks where source_id=s.id;
  if s.stored_rows<>s.expected_rows or s.stored_cells<>s.expected_cells or chunk_count<>s.expected_chunks then
    raise exception 'Import incomplete: chunk payloads are kept until every part is stored';
  end if;
  update public.supplier_source_chunks set payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload_bytes=pg_column_size(payload),payload=null,compacted_at=now()
    where source_id=s.id and chunk_index = any(array(select chunk_index from public.supplier_source_chunks where source_id=s.id and payload is not null order by chunk_index limit p_limit));
  get diagnostics n=row_count;
  select count(*) into left_count from public.supplier_source_chunks where source_id=s.id and payload is not null;
  return jsonb_build_object('id', s.id, 'compacted', n, 'remaining', left_count, 'done', left_count=0);
end $$;
revoke all on function public.supplier_compact_chunk_payloads_step(uuid, int) from public, anon;
grant execute on function public.supplier_compact_chunk_payloads_step(uuid, int) to authenticated;

commit;
