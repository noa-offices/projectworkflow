begin;

-- DBH-1: one small history table; current metrics remain live aggregate reads.
-- Prerequisites: Supplier capacity hardening, Phase F, and Supplier lifecycle migrations.
-- No existing records, pricing writers, cleanup functions or Storage schemas are changed.
create table public.system_capacity_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default statement_timestamp(),
  database_bytes bigint not null check (database_bytes >= 0),
  storage_bytes bigint check (storage_bytes >= 0),
  supplier_bytes bigint not null check (supplier_bytes >= 0),
  product_image_bytes bigint check (product_image_bytes >= 0),
  quote_image_bytes bigint check (quote_image_bytes >= 0),
  other_storage_bytes bigint check (other_storage_bytes >= 0)
);
create index system_capacity_snapshots_captured_at_idx on public.system_capacity_snapshots(captured_at desc, id desc);
alter table public.system_capacity_snapshots enable row level security;
revoke all on public.system_capacity_snapshots from public, anon, authenticated;
grant select on public.system_capacity_snapshots to authenticated;
grant select, insert on public.system_capacity_snapshots to service_role;
create policy system_capacity_snapshots_owner_read on public.system_capacity_snapshots
  for select to authenticated using (
    (select auth.uid()) is not null and (select public.current_user_role()) = 'system_owner'
    and (select public.current_account_status()) = 'active'
  );

-- Private helper, called only by the guarded definer entry points below.
-- Reuse the existing finalized-chunk dry run exactly once (explicit true, no mutation).
-- Do not reuse the old per-source report: it scans raw identities/matches and fans out by source.
create function supplier_price_private.system_capacity_metrics() returns jsonb
language plpgsql set search_path = '' as $$
declare result jsonb; chunks jsonb;
begin
  perform public.supplier_capacity_require_owner();
  chunks := public.supplier_capacity_compact_finalized(true);
  with relations as materialized (
    select n.nspname schema, c.relname name, c.oid,
      pg_table_size(c.oid) table_bytes, pg_indexes_size(c.oid) index_bytes,
      pg_total_relation_size(c.oid) total_bytes,
      case when c.reltuples < 0 then null else c.reltuples::bigint end rows
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','m') and n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
  ), largest_indexes as (
    select n.nspname schema, c.relname name, t.relname table_name, pg_relation_size(c.oid) bytes
    from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid=i.indexrelid
    join pg_catalog.pg_class t on t.oid=i.indrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
    order by pg_relation_size(c.oid) desc, n.nspname, c.relname limit 50
  ), object_sizes as materialized (
    select o.bucket_id,
      case when o.metadata->>'size' ~ '^[0-9]{1,19}$' then
        case when (o.metadata->>'size')::numeric <= 9223372036854775807 then (o.metadata->>'size')::bigint end
      end bytes
    from storage.objects o
  ), bucket_totals as materialized (
    select b.id name, count(o.bucket_id) objects, coalesce(sum(o.bytes),0) total_bytes,
      max(o.bytes) largest_bytes, count(o.bucket_id) filter (where o.bytes is null) unknown_sizes
    from storage.buckets b left join object_sizes o on o.bucket_id=b.id group by b.id
  ), storage_totals as (
    select case when count(*) filter (where bytes is null)=0 then coalesce(sum(bytes),0) end storage_bytes,
      case when count(*) filter (where bucket_id='product-images' and bytes is null)=0 then coalesce(sum(bytes) filter (where bucket_id='product-images'),0) end product_image_bytes,
      case when count(*) filter (where bucket_id='quote-images' and bytes is null)=0 then coalesce(sum(bytes) filter (where bucket_id='quote-images'),0) end quote_image_bytes,
      case when count(*) filter (where bucket_id not in ('product-images','quote-images') and bytes is null)=0 then coalesce(sum(bytes) filter (where bucket_id not in ('product-images','quote-images')),0) end other_storage_bytes
    from object_sizes
  )
  select jsonb_build_object(
    'generated_at', statement_timestamp(), 'database_bytes', pg_database_size(current_database()),
    'supplier_bytes', (select coalesce(sum(total_bytes),0) from relations where schema='public' and name like 'supplier\_%'),
    'supplier_index_bytes', (select coalesce(sum(index_bytes),0) from relations where schema='public' and name like 'supplier\_%'),
    'tables', (select coalesce(jsonb_agg(to_jsonb(r)-'oid' order by total_bytes desc, schema, name),'[]') from relations r),
    'indexes', (select coalesce(jsonb_agg(i order by bytes desc, schema, name),'[]') from largest_indexes i),
    'buckets', (select coalesce(jsonb_agg(b order by total_bytes desc, name),'[]') from bucket_totals b),
    'storage_bytes', st.storage_bytes, 'product_image_bytes', st.product_image_bytes,
    'quote_image_bytes', st.quote_image_bytes, 'other_storage_bytes', st.other_storage_bytes,
    'reclaimable', jsonb_build_object('bytes', (chunks->>'source_chunk_bytes')::bigint + (chunks->>'match_chunk_bytes')::bigint,
      'items', (chunks->>'source_chunks')::bigint + (chunks->>'match_chunks')::bigint),
    -- Metadata only. The server reuses the existing deterministic lifecycle resolver.
    'source_metadata', (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'brand_id',v.brand_id,'definition_id',v.definition_id,
      'status',v.status,'effective_from',v.effective_from,'created_at',v.created_at,'rows_compacted_at',v.rows_compacted_at)),'[]') from public.supplier_source_versions v),
    'review_metadata', (select coalesce(jsonb_agg(b),'[]') from (
      select source_id, status, max(completed_at) completed_at from public.supplier_price_batches group by source_id,status
    ) b)
  ) into result from storage_totals st;
  return result;
end $$;
revoke all on function supplier_price_private.system_capacity_metrics() from public, anon, authenticated, service_role;

-- Definer is necessary for cross-Brand/Storage metadata; caller is rechecked inside the private helper.
create function public.system_capacity_report() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare metrics jsonb; history jsonb; baseline jsonb; monthly jsonb;
begin
  perform public.supplier_capacity_require_owner();
  metrics := supplier_price_private.system_capacity_metrics();
  select coalesce(jsonb_agg(s order by captured_at desc,id desc),'[]') into history from (
    select * from public.system_capacity_snapshots order by captured_at desc,id desc limit 12
  ) s;
  select to_jsonb(s) into baseline from public.system_capacity_snapshots s
    where captured_at <= statement_timestamp() - interval '30 days' order by captured_at desc,id desc limit 1;
  select coalesce(jsonb_agg(s order by captured_at,id),'[]') into monthly from (
    select distinct on (date_trunc('month',captured_at at time zone 'Asia/Dubai')) *
    from public.system_capacity_snapshots
    where captured_at >= date_trunc('month',statement_timestamp() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' - interval '35 months'
    order by date_trunc('month',captured_at at time zone 'Asia/Dubai'), captured_at desc,id desc
  ) s;
  return metrics || jsonb_build_object('snapshots',history,'baseline_30_day',baseline,'monthly',monthly);
end $$;
revoke all on function public.system_capacity_report() from public, anon, authenticated, service_role;
grant execute on function public.system_capacity_report() to authenticated;

-- Only permitted write: insert server-measured metrics into the snapshot table.
-- No client arguments and no cleanup calls. Nullable Storage values preserve incomplete metadata.
create function public.capture_system_capacity_snapshot() returns uuid
language plpgsql security definer set search_path = '' as $$
declare metrics jsonb; snapshot_id uuid;
begin
  perform public.supplier_capacity_require_owner();
  metrics := supplier_price_private.system_capacity_metrics();
  insert into public.system_capacity_snapshots(captured_at,database_bytes,storage_bytes,supplier_bytes,product_image_bytes,quote_image_bytes,other_storage_bytes)
    values ((metrics->>'generated_at')::timestamptz,(metrics->>'database_bytes')::bigint,(metrics->>'storage_bytes')::bigint,
      (metrics->>'supplier_bytes')::bigint,(metrics->>'product_image_bytes')::bigint,(metrics->>'quote_image_bytes')::bigint,(metrics->>'other_storage_bytes')::bigint)
    returning id into snapshot_id;
  return snapshot_id;
end $$;
revoke all on function public.capture_system_capacity_snapshot() from public, anon, authenticated, service_role;
grant execute on function public.capture_system_capacity_snapshot() to authenticated;

commit;
