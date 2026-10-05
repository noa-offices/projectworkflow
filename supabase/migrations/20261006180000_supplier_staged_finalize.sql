begin;

-- Staged Supplier source finalize. The single-statement finalize builds every identity at once; for a 203,870-cell source
-- that cannot finish inside the authenticated role's 8s statement_timeout. This function does the same work in bounded,
-- idempotent steps: each call builds identities for whole codes only (never part of a code), up to p_max_cells cells,
-- then returns. The last call checks completeness, records identity_count, compacts staging chunks and marks the source imported.
-- Identity content is byte-for-byte the same as finalize_source: groups never span codes, so splitting by code changes nothing.
-- The role-wide timeout is unchanged. Re-running a step never duplicates identities (unique key + on conflict do nothing).
create or replace function public.supplier_finalize_source_step(p_source_id uuid, p_max_cells int default 20000) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; codes text[]; rows_count int; cells_count int; chunk_count int; pending int; built int;
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if p_max_cells is null or p_max_cells not between 100 and 200000 then raise exception 'Finalize step size must be 100-200000 cells'; end if;
  select * into strict s from public.supplier_source_versions where id=p_source_id for update;
  if s.status='imported' then return jsonb_build_object('id', s.id, 'status', s.status, 'done', true, 'reused', true, 'identity_count', s.identity_count, 'remaining_codes', 0); end if;
  if s.status not in ('uploading','importing') then raise exception 'Source cannot finalize'; end if;
  -- Every step: the chunk receipts and the stored counters (both written atomically with each chunk's rows and cells) must be complete.
  -- The last step also recounts rows and cells exactly before marking the source imported.
  select count(*) into chunk_count from public.supplier_source_chunks where source_id=s.id;
  if s.stored_rows<>s.expected_rows or s.stored_cells<>s.expected_cells or chunk_count<>s.expected_chunks then
    raise exception 'Import incomplete: expected/stored rows %/%, cells %/%, chunks %/%', s.expected_rows, s.stored_rows, s.expected_cells, s.stored_cells, s.expected_chunks, chunk_count;
  end if;
  -- Next whole codes without identities, in code order, until the cell budget is reached (always at least one code).
  select coalesce(array_agg(code order by code) filter (where before < p_max_cells), '{}'), count(*) into codes, pending from (
    select code, sum(n) over (order by code) - n as before from (
      select g.code, g.n from (select c.code, count(*) n from public.supplier_source_cells c where c.source_id=s.id group by c.code) g
        where not exists(select 1 from public.supplier_source_identities i where i.source_id=s.id and i.code=g.code)) waiting) budget;
  if cardinality(codes)>0 then
    insert into public.supplier_source_identities(source_id,key,code,data)
      with groups as (
        select code,price_field,dimension,count(distinct coalesce(price::text,'null'))>1 as varied,bool_and(finish<>'') as finish_driven
        from public.supplier_source_cells where source_id=s.id and code=any(codes) group by code,price_field,dimension
      ), tiers as (
        select g.code,g.price_field,g.dimension,g.varied,g.finish_driven,
          case when g.varied and g.finish_driven then c.price else null end as tier_price,
          min(c.price) as price,array_agg(distinct c.row_key order by c.row_key) as row_keys,array_agg(distinct c.finish order by c.finish) as finishes,array_agg(distinct c.companion_note) filter(where c.companion_note<>'') as companion_notes
        from groups g join public.supplier_source_cells c on c.source_id=s.id and c.code=g.code and c.price_field=g.price_field and c.dimension=g.dimension
        group by g.code,g.price_field,g.dimension,g.varied,g.finish_driven,case when g.varied and g.finish_driven then c.price else null end
      ), identities as (
        select t.*,case when varied and finish_driven then jsonb_build_array(dimension,'finish_set',to_jsonb(finishes))::text else dimension end as source_dim,
          array(select distinct issue from public.supplier_source_cells c cross join lateral unnest(c.issues) issue where c.source_id=s.id and c.code=t.code and c.price_field=t.price_field and c.dimension=t.dimension and (not (t.varied and t.finish_driven) or c.price is not distinct from t.tier_price)) ||
          case when (varied and not finish_driven) or exists(select 1 from public.supplier_source_cells c where c.source_id=s.id and c.code=t.code and c.price_field=t.price_field and c.dimension=t.dimension group by c.raw_code having count(distinct coalesce(c.price::text,'null'))>1) then array['conflicting_source_prices']::text[] else '{}'::text[] end as problems
        from tiers t
      ) select s.id,jsonb_build_array(code,price_field,source_dim)::text,code,
        jsonb_build_object('key',jsonb_build_array(code,price_field,source_dim)::text,'code',code,'price_field',price_field,'dimension',source_dim,'raw_dimension',dimension,'finishes',coalesce(to_jsonb(array_remove(finishes,'')),'[]'::jsonb),'price',case when varied and not finish_driven then null else price end,'currency',s.currency,'row_keys',to_jsonb(row_keys),'companion_notes',coalesce(to_jsonb(companion_notes),'[]'::jsonb),'issues',to_jsonb(problems)) from identities
      on conflict (source_id,key) do nothing;
    get diagnostics built = row_count;
  else built := 0;
  end if;
  if pending > cardinality(codes) then
    update public.supplier_source_versions set status='importing' where id=s.id and status='uploading';
    return jsonb_build_object('id', s.id, 'status', 'importing', 'done', false, 'codes', cardinality(codes), 'identities_built', built, 'remaining_codes', pending - cardinality(codes));
  end if;
  select count(*) into rows_count from public.supplier_source_rows where source_id=s.id;
  select count(*) into cells_count from public.supplier_source_cells where source_id=s.id;
  if rows_count<>s.expected_rows or cells_count<>s.expected_cells or exists(select 1 from generate_series(0,s.expected_chunks-1) n where not exists(select 1 from public.supplier_source_chunks where source_id=s.id and chunk_index=n)) then
    raise exception 'Import incomplete: expected/stored rows %/%, cells %/%', s.expected_rows, rows_count, s.expected_cells, cells_count;
  end if;
  update public.supplier_source_versions set status='imported',stored_rows=rows_count,stored_cells=cells_count,identity_count=(select count(*) from public.supplier_source_identities where source_id=s.id) where id=s.id;
  update public.supplier_source_chunks set payload_sha256=encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload_bytes=pg_column_size(payload),payload=null,compacted_at=now() where source_id=s.id and payload is not null;
  return jsonb_build_object('id', s.id, 'status', 'imported', 'done', true, 'codes', cardinality(codes), 'identities_built', built, 'remaining_codes', 0,
    'identity_count', (select identity_count from public.supplier_source_versions where id=s.id));
end $$;
revoke all on function public.supplier_finalize_source_step(uuid, int) from public;
grant execute on function public.supplier_finalize_source_step(uuid, int) to authenticated;

commit;
