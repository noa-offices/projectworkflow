begin;
create table public.supplier_price_profiles (
  id uuid primary key default gen_random_uuid(), brand_id uuid not null references public.brands(id),
  title text not null, config jsonb not null, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
  unique(brand_id,title), check(jsonb_typeof(config)='object')
);
create table public.supplier_source_versions (
  id uuid primary key default gen_random_uuid(), brand_id uuid not null references public.brands(id),
  title text not null, filename text not null, file_hash text not null, source_type text not null check(source_type in ('xlsx','csv','json')),
  currency text not null check(currency in ('AED','EUR','USD')), basis text not null check(basis in ('list','net','unknown')),
  profile jsonb not null, original_reference text, working_reference text, effective_from date, received_at date,
  status text not null default 'uploading' check(status in ('uploading','importing','imported','failed','archived')),
  expected_rows int not null check(expected_rows>0), expected_cells int not null check(expected_cells>0), expected_chunks int not null check(expected_chunks>0),
  stored_rows int not null default 0,stored_cells int not null default 0,identity_count int not null default 0,
  created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(id,brand_id)
);
create index supplier_source_hash on public.supplier_source_versions(brand_id,file_hash);
create table public.supplier_source_chunks(source_id uuid not null references public.supplier_source_versions(id),chunk_index int not null check(chunk_index>=0),payload jsonb not null,primary key(source_id,chunk_index));
create table public.supplier_source_rows(source_id uuid not null references public.supplier_source_versions(id),unit_key text not null,row_number int not null check(row_number>0),sheet text not null,raw_extras jsonb not null,page_reference text,primary key(source_id,unit_key));
create table public.supplier_source_cells(
  source_id uuid not null,unit_key text not null,row_key text not null,code text not null,raw_code text not null,raw_article text not null,
  finish text not null,dimension text not null,price_field text not null check(price_field in ('unit_price','default_price','additional_price')),
  price numeric check(price>=0 and price::text not in ('NaN','Infinity','-Infinity')),raw_price jsonb,issues text[] not null,companion_note text not null default '',
  primary key(source_id,unit_key),foreign key(source_id,row_key) references public.supplier_source_rows(source_id,unit_key)
);
create index supplier_cells_commercial_key on public.supplier_source_cells(source_id,code,price_field,dimension);
create table public.supplier_source_identities(source_id uuid not null references public.supplier_source_versions(id),key text not null,code text not null,data jsonb not null,primary key(source_id,key));
create index supplier_master_code on public.supplier_source_identities(source_id,code);
create table public.supplier_price_batches(
  id uuid primary key default gen_random_uuid(),brand_id uuid not null references public.brands(id),source_id uuid not null,
  brand_price_list_update_id uuid references public.brand_price_list_updates(id),title text not null,
  scope text not null check(scope in ('complete','selected_templates','partial')),selected_template_ids uuid[] not null default '{}',
  status text not null default 'matching' check(status in ('matching','review','archived')),
  expected_matches int not null check(expected_matches>=0),expected_chunks int not null check(expected_chunks>=0),basis_warning text not null,
  created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),foreign key(source_id,brand_id) references public.supplier_source_versions(id,brand_id)
);
create table public.supplier_price_match_chunks(batch_id uuid not null references public.supplier_price_batches(id),chunk_index int not null check(chunk_index>=0),payload jsonb not null,primary key(batch_id,chunk_index));
create table public.supplier_price_matches(batch_id uuid not null references public.supplier_price_batches(id),key text not null,code text not null,classification text not null check(classification in ('increased','decreased','unchanged','changed','unmatched','referenced_companion','ambiguous','shared','needs_dimension_mapping','baseline_drift','invalid_source','target_not_represented')),comparison text check(comparison in ('increased','decreased','unchanged','changed')),template_ids uuid[] not null,data jsonb not null,primary key(batch_id,key));
create index supplier_matches_filter on public.supplier_price_matches(batch_id,classification,code);
create index supplier_matches_templates on public.supplier_price_matches using gin(template_ids);
create table public.supplier_template_review_units(batch_id uuid not null references public.supplier_price_batches(id),template_id uuid not null references public.product_templates(id),template_name text not null,matched int not null,changed int not null,unchanged int not null,unresolved int not null,state text not null,primary key(batch_id,template_id));
create table public.supplier_price_decisions(batch_id uuid not null,key text not null,decision text not null check(decision in ('reviewed','skip','reject','mapping_proposed')),note text not null default '',proposed_target_keys text[] not null default '{}',reviewed_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),primary key(batch_id,key),foreign key(batch_id,key) references public.supplier_price_matches(batch_id,key));
create table public.supplier_price_bindings(id uuid primary key default gen_random_uuid(),brand_id uuid not null references public.brands(id),code text not null,price_field text not null,source_dimension text not null,kind text not null check(kind in ('alias','shared','disambiguation')),target_keys text[] not null,confirmed boolean not null default true,baseline_snapshot jsonb not null,confirmed_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),unique(brand_id,code,price_field,source_dimension));
create table public.supplier_dimension_vocabulary(id uuid primary key default gen_random_uuid(),brand_id uuid not null references public.brands(id),template_id uuid references public.product_templates(id),group_id text,raw_labels text[] not null default '{}',finish_codes text[] not null default '{}',dimension_code text not null check(dimension_code<>''),is_active boolean not null default true,confirmed_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),check(cardinality(raw_labels)+cardinality(finish_codes)>0),check(group_id is null or template_id is not null));

-- New tables expose read access only. Mutations go through the constrained RPC
-- below; no authenticated direct DML can forge import completeness or confirmations.
do $$ declare table_name text; begin
  foreach table_name in array array['supplier_price_profiles','supplier_source_versions','supplier_source_chunks','supplier_source_rows','supplier_source_cells','supplier_source_identities','supplier_price_batches','supplier_price_match_chunks','supplier_price_matches','supplier_template_review_units','supplier_price_decisions','supplier_price_bindings','supplier_dimension_vocabulary'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('create policy reviewer_read on public.%I for select to authenticated using (public.current_user_can_review_brand_prices())',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
  end loop;
end $$;

create schema supplier_price_private;
revoke all on schema supplier_price_private from public;
-- Independent DB verification of the baseline locator, not trust in submitted
-- snapshots. The helper is private and contains SELECTs only.
create function supplier_price_private.verify_target(p_target jsonb,p_brand uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare template_data jsonb; group_data jsonb; row_data jsonb; column_data jsonb; expected_price jsonb; expected_code text; expected_currency text;
  architecture text:=p_target->>'architecture'; field_name text:=p_target->>'physical_field'; field_key text:=p_target->>'price_field'; matches int;
begin
  select to_jsonb(t) into strict template_data from public.product_templates t where id=(p_target->>'template_id')::uuid and brand_id=p_brand and is_active for share;
  if template_data->>'pricing_version'<>p_target->>'pricing_version' then raise exception 'Target baseline version changed'; end if;
  if architecture='simple' then
    if p_target->>'group_id'<>'default' or p_target->>'row_id'<>template_data->>'id' or field_name<>'default_unit_price' or field_key<>'unit_price' or p_target->>'column_id'<>'' or p_target->>'dimension'<>'' then raise exception 'Invalid simple target'; end if;
    row_data:=template_data; expected_code:=row_data->>'item_code';
  elsif architecture='product_components' then
    select to_jsonb(c) into strict row_data from public.product_components c where id=(p_target->>'row_id')::uuid;
    if row_data->>'template_id'<>template_data->>'id' or coalesce((row_data->>'is_active')::boolean,true)=false or field_name<>'unit_price' or field_key<>'unit_price' or p_target->>'group_id'<>'components' or p_target->>'column_id'<>'' or p_target->>'dimension'<>'' then raise exception 'Invalid component target'; end if;
    expected_code:=row_data->>'component_code';
  elsif architecture in ('variant_pricing','category_pricing','desking_size_pricing','accessory_pricing') then
    if p_target->>'group_id'='legacy-flat:'||architecture then
      group_data:=jsonb_build_object('id',p_target->>'group_id');
      select count(*),jsonb_agg(x)->0 into matches,row_data from jsonb_array_elements(template_data->architecture) x where x->>'id'=p_target->>'row_id' and not(x ? 'items');
      group_data:=row_data;
    else
      select count(*),jsonb_agg(x)->0 into matches,group_data from jsonb_array_elements(template_data->architecture) x where x->>'id'=p_target->>'group_id';
      if matches<>1 then raise exception 'Group identity is missing/ambiguous'; end if;
      select count(*),jsonb_agg(x)->0 into matches,row_data from jsonb_array_elements(group_data->'items') x where x->>'id'=p_target->>'row_id';
    end if;
    if matches<>1 or coalesce((row_data->>'is_active')::boolean,true)=false or coalesce((group_data->>'is_active')::boolean,true)=false then raise exception 'Row identity is missing/ambiguous/inactive'; end if;
    expected_code:=row_data->>'supplier_price_list_code';
    if architecture='desking_size_pricing' then
      if field_name='default_price' and field_key='unit_price' then expected_code:=coalesce(row_data->>'base_supplier_price_list_code',expected_code);
      elsif field_name='additional_price' and field_key='additional_price' then expected_code:=row_data->>'additional_supplier_price_list_code';
      else raise exception 'Invalid workstation price field'; end if;
    elsif field_key<>'unit_price' or field_name not in ('price','prices') then raise exception 'Invalid target price field'; end if;
    if field_name='prices' then
      if architecture='category_pricing' then
        select count(*),jsonb_agg(x)->0 into matches,column_data from jsonb_array_elements(group_data->'price_columns') x where x->>'id'=p_target->>'column_id';
      elsif architecture='accessory_pricing' then
        select count(*),jsonb_agg(x)->0 into matches,column_data from jsonb_array_elements(group_data->'price_categories') x where x->>'id'=p_target->>'column_id';
      else raise exception 'Invalid matrix architecture'; end if;
      if matches<>1 or coalesce(column_data->>'dimension_code',column_data->>'id')<>p_target->>'dimension' then raise exception 'Stable dimension identity changed'; end if;
      expected_price:=row_data->'prices'->(p_target->>'column_id');
    elsif p_target->>'column_id'<>'' or p_target->>'dimension'<>'' then raise exception 'Scalar target has a dimension'; end if;
  else raise exception 'Unsupported target architecture'; end if;
  if field_name<>'prices' then expected_price:=row_data->field_name; end if;
  if jsonb_typeof(expected_price) is distinct from 'number' then expected_price:='null'; end if;
  expected_currency:=upper(btrim(coalesce(row_data->>'currency',template_data->>'currency')));
  if expected_price is distinct from p_target->'price' or expected_currency is distinct from p_target->>'currency' or expected_code is distinct from p_target->>'raw_code' or (p_target->>'key')::jsonb is distinct from jsonb_build_array(p_target->>'template_id',architecture,p_target->>'group_id',p_target->>'row_id',field_name,p_target->>'column_id') then raise exception 'Target baseline/locator was changed or forged'; end if;
end $$;
revoke all on function supplier_price_private.verify_target(jsonb,uuid) from public;

-- Definer is needed only to write protected new workflow tables. Every operation
-- checks trusted active-profile permissions; no Product/Brand pricing mutations.
create function public.supplier_price_review_write(p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.supplier_source_versions; b public.supplier_price_batches; profile_record public.supplier_price_profiles;
  entity_id uuid; chunk int; existing jsonb; r jsonb; c jsonb; match_record jsonb; target jsonb; rule jsonb;
  rows_count int; cells_count int; chunk_count int; brand_basis text; bound_keys text[]; baselines jsonb;
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if p_operation in ('profile','dimension','bindings','archive_dimension') and not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
  if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>1500000 then raise exception 'Invalid or oversized workflow payload'; end if;
  if p_operation='profile' then
    if p_payload->'config'->>'currency' not in ('AED','EUR','USD') or p_payload->'config'->>'basis' not in ('list','net','unknown') or jsonb_typeof(p_payload->'config'->'price_columns')<>'array' then raise exception 'Invalid import profile'; end if;
    insert into public.supplier_price_profiles(brand_id,title,config,updated_by) values((p_payload->>'brand_id')::uuid,p_payload->>'title',p_payload->'config',auth.uid())
    on conflict(brand_id,title) do update set config=excluded.config,updated_by=auth.uid(),updated_at=now() returning id into entity_id;
  elsif p_operation='source' then
    select * into strict profile_record from public.supplier_price_profiles where id=(p_payload->>'profile_id')::uuid;
    if p_payload->'expected_profile' is distinct from profile_record.config then raise exception 'Import profile changed; reload before creating source'; end if;
    if (p_payload->>'expected_cells')::int<>(p_payload->>'expected_rows')::int*jsonb_array_length(profile_record.config->'price_columns') then raise exception 'Expected source cell count disagrees with profile'; end if;
    if profile_record.config->>'currency' not in ('AED','EUR','USD') or profile_record.config->>'basis' not in ('list','net','unknown') then raise exception 'Invalid source currency/basis'; end if;
    if p_payload->>'file_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid source hash'; end if;
    perform pg_advisory_xact_lock(hashtextextended(profile_record.brand_id::text||(p_payload->>'file_hash'),0));
    select id into entity_id from public.supplier_source_versions where brand_id=profile_record.brand_id and file_hash=p_payload->>'file_hash' and profile=profile_record.config and title=p_payload->>'title' and effective_from is not distinct from nullif(p_payload->>'effective_from','')::date and received_at is not distinct from nullif(p_payload->>'received_at','')::date and status<>'archived' order by created_at desc limit 1;
    if entity_id is null then
      insert into public.supplier_source_versions(brand_id,title,filename,file_hash,source_type,currency,basis,profile,original_reference,effective_from,received_at,expected_rows,expected_cells,expected_chunks,created_by)
      values(profile_record.brand_id,p_payload->>'title',p_payload->>'filename',p_payload->>'file_hash',p_payload->>'source_type',profile_record.config->>'currency',profile_record.config->>'basis',profile_record.config,p_payload->>'original_reference',nullif(p_payload->>'effective_from','')::date,nullif(p_payload->>'received_at','')::date,(p_payload->>'expected_rows')::int,(p_payload->>'expected_cells')::int,(p_payload->>'expected_chunks')::int,auth.uid()) returning id into entity_id;
    end if;
  elsif p_operation in ('chunk','finalize_source','archive_source','fail_source','attach_file') then
    select * into strict s from public.supplier_source_versions where id=(p_payload->>'source_id')::uuid for update;
    entity_id:=s.id;
    if p_operation='attach_file' then
      if s.status not in ('uploading','importing') or p_payload->>'path' not in (s.brand_id::text||'/'||s.id::text||'/'||s.file_hash||'.xlsx',s.brand_id::text||'/'||s.id::text||'/'||s.file_hash||'.csv',s.brand_id::text||'/'||s.id::text||'/'||s.file_hash||'.json') then raise exception 'Invalid immutable working-file path'; end if;
      if not exists(select 1 from storage.objects where bucket_id='supplier-price-sources' and name=p_payload->>'path') then raise exception 'Working file is not stored'; end if;
      update public.supplier_source_versions set working_reference=p_payload->>'path' where id=s.id;
    elsif p_operation='archive_source' then update public.supplier_source_versions set status='archived' where id=s.id;
    elsif p_operation='fail_source' then
      if s.status='imported' then raise exception 'Cannot fail an imported source'; end if;
      update public.supplier_source_versions set status='failed' where id=s.id;
    elsif p_operation='chunk' then
      if s.status not in ('uploading','importing','failed') then raise exception 'Source is immutable'; end if;
      chunk:=(p_payload->>'chunk_index')::int;
      if chunk<0 or chunk>=s.expected_chunks or jsonb_array_length(p_payload->'rows') not between 1 and 1000 or jsonb_array_length(p_payload->'cells')+jsonb_array_length(p_payload->'rows')>1000 then raise exception 'Invalid import chunk'; end if;
      select payload into existing from public.supplier_source_chunks where source_id=s.id and chunk_index=chunk;
      if found then
        if existing<>p_payload then raise exception 'Chunk retry payload changed'; end if;
        return jsonb_build_object('id',s.id,'reused',true);
      end if;
      for r in select value from jsonb_array_elements(p_payload->'rows') loop
        insert into public.supplier_source_rows(source_id,unit_key,row_number,sheet,raw_extras,page_reference) values(s.id,r->>'unit_key',(r->>'row_number')::int,r->>'sheet',r->'values',r->>'page_reference');
      end loop;
      for c in select value from jsonb_array_elements(p_payload->'cells') loop
        if not exists(select 1 from jsonb_array_elements(p_payload->'rows') x where x->>'unit_key'=c->>'row_key') then raise exception 'Cell provenance is outside this chunk'; end if;
        insert into public.supplier_source_cells values(s.id,c->>'unit_key',c->>'row_key',c->>'code',c->>'raw_code',c->>'raw_article',c->>'finish',c->>'dimension',c->>'price_field',(c->>'price')::numeric,c->'raw_price',array(select jsonb_array_elements_text(c->'issues')),coalesce(c->>'companion_note',''));
      end loop;
      insert into public.supplier_source_chunks values(s.id,chunk,p_payload);
      update public.supplier_source_versions set status='importing',stored_rows=stored_rows+jsonb_array_length(p_payload->'rows'),stored_cells=stored_cells+jsonb_array_length(p_payload->'cells') where id=s.id;
    else
      if s.status='imported' then return jsonb_build_object('id',s.id,'reused',true); end if;
      if s.status not in ('uploading','importing') then raise exception 'Source cannot finalize'; end if;
      select count(*) into rows_count from public.supplier_source_rows where source_id=s.id;
      select count(*) into cells_count from public.supplier_source_cells where source_id=s.id;
      select count(*) into chunk_count from public.supplier_source_chunks where source_id=s.id;
      if rows_count<>s.expected_rows or cells_count<>s.expected_cells or chunk_count<>s.expected_chunks or exists(select 1 from generate_series(0,s.expected_chunks-1) n where not exists(select 1 from public.supplier_source_chunks where source_id=s.id and chunk_index=n)) then raise exception 'Import incomplete: expected/stored counts or chunks differ'; end if;
      insert into public.supplier_source_identities(source_id,key,code,data)
      with groups as (
        select code,price_field,dimension,count(distinct coalesce(price::text,'null'))>1 as varied,bool_and(finish<>'') as finish_driven
        from public.supplier_source_cells where source_id=s.id group by code,price_field,dimension
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
        jsonb_build_object('key',jsonb_build_array(code,price_field,source_dim)::text,'code',code,'price_field',price_field,'dimension',source_dim,'raw_dimension',dimension,'finishes',case when varied and finish_driven then to_jsonb(finishes) else '[]'::jsonb end,'price',case when varied and not finish_driven then null else price end,'currency',s.currency,'row_keys',to_jsonb(row_keys),'companion_notes',coalesce(to_jsonb(companion_notes),'[]'::jsonb),'issues',to_jsonb(problems)) from identities;
      update public.supplier_source_versions set status='imported',stored_rows=rows_count,stored_cells=cells_count,identity_count=(select count(*) from public.supplier_source_identities where source_id=s.id) where id=s.id;
    end if;
  elsif p_operation='batch' then
    select * into strict s from public.supplier_source_versions where id=(p_payload->>'source_id')::uuid for share;
    if s.status<>'imported' then raise exception 'Matching requires a finalized imported source'; end if;
    bound_keys:=array(select jsonb_array_elements_text(coalesce(p_payload->'selected_template_ids','[]')));
    if p_payload->>'scope'='selected_templates' and cardinality(bound_keys)=0 then raise exception 'Select existing Templates'; end if;
    if exists(select 1 from unnest(bound_keys) x where not exists(select 1 from public.product_templates where id=x::uuid and brand_id=s.brand_id and is_active)) then raise exception 'Invalid selected Template'; end if;
    select stored_price_basis into brand_basis from public.brands where id=s.brand_id;
    if p_payload->>'brand_price_list_update_id' is not null and not exists(select 1 from public.brand_price_list_updates where id=(p_payload->>'brand_price_list_update_id')::uuid and brand_id=s.brand_id) then raise exception 'Brand-list metadata belongs to another Brand'; end if;
    insert into public.supplier_price_batches(brand_id,source_id,brand_price_list_update_id,title,scope,selected_template_ids,expected_matches,expected_chunks,basis_warning,created_by)
    values(s.brand_id,s.id,(p_payload->>'brand_price_list_update_id')::uuid,p_payload->>'title',p_payload->>'scope',bound_keys::uuid[],(p_payload->>'expected_matches')::int,(p_payload->>'expected_chunks')::int,case when s.basis='unknown' or brand_basis='unknown' or s.basis<>brand_basis then 'NOT APPLY-READY: unknown or mismatched price basis.' else 'Review only. Phase 2 must revalidate before application.' end,auth.uid()) returning id into entity_id;
  elsif p_operation in ('match_chunk','finalize_batch','decision') then
    select * into strict b from public.supplier_price_batches where id=(p_payload->>'batch_id')::uuid for update;
    entity_id:=b.id;
    if p_operation='decision' then
      if b.status<>'review' then raise exception 'Batch is not ready for review'; end if;
      select data into strict match_record from public.supplier_price_matches where batch_id=b.id and key=p_payload->>'key';
      if b.scope='selected_templates' and jsonb_array_length(match_record->'targets')>0 and not exists(select 1 from jsonb_array_elements(match_record->'targets') t where (t->>'template_id')::uuid=any(b.selected_template_ids)) then raise exception 'Decision is outside selected review scope'; end if;
      if p_payload->>'decision'='reviewed' and match_record->>'classification' not in ('increased','decreased','changed','unchanged','shared') then raise exception 'Resolve the match before marking reviewed'; end if;
      insert into public.supplier_price_decisions(batch_id,key,decision,note,proposed_target_keys,reviewed_by) values(b.id,p_payload->>'key',p_payload->>'decision',coalesce(p_payload->>'note',''),array(select jsonb_array_elements_text(coalesce(p_payload->'proposed_target_keys','[]'))),auth.uid())
      on conflict(batch_id,key) do update set decision=excluded.decision,note=excluded.note,proposed_target_keys=excluded.proposed_target_keys,reviewed_by=auth.uid(),updated_at=now();
      update public.supplier_template_review_units u set state=case when not exists(select 1 from public.supplier_price_matches m where m.batch_id=u.batch_id and u.template_id=any(m.template_ids) and not exists(select 1 from public.supplier_price_decisions d where d.batch_id=m.batch_id and d.key=m.key and d.decision in ('reviewed','skip','reject'))) then 'REVIEWED' else case when u.unresolved>0 then 'NEEDS_MAPPING' else 'READY' end end where u.batch_id=b.id;
    elsif p_operation='match_chunk' then
      if b.status<>'matching' then raise exception 'Batch snapshot is immutable'; end if;
      chunk:=(p_payload->>'chunk_index')::int;
      if chunk<0 or chunk>=b.expected_chunks or jsonb_array_length(p_payload->'matches') not between 1 and 1000 then raise exception 'Invalid match chunk'; end if;
      select payload into existing from public.supplier_price_match_chunks where batch_id=b.id and chunk_index=chunk;
      if found then if existing<>p_payload then raise exception 'Match chunk retry changed'; end if; return jsonb_build_object('id',b.id,'reused',true); end if;
      for match_record in select value from jsonb_array_elements(p_payload->'matches') loop
        for target in select value from jsonb_array_elements(match_record->'targets') loop
          if not exists(select 1 from public.product_templates where id=(target->>'template_id')::uuid and brand_id=b.brand_id and is_active and pricing_version=(target->>'pricing_version')::bigint) then raise exception 'Target changed or belongs to another Brand. Start a fresh batch.'; end if;
          perform supplier_price_private.verify_target(target,b.brand_id);
        end loop;
        if match_record->'source'<>'null'::jsonb and not exists(select 1 from public.supplier_source_identities where source_id=b.source_id and key=match_record->'source'->>'key' and data=match_record->'source') then raise exception 'Source identity unavailable or forged'; end if;
        insert into public.supplier_price_matches values(b.id,match_record->>'key',coalesce(match_record->'source'->>'code',''),match_record->>'classification',match_record->>'comparison',array(select distinct (t->>'template_id')::uuid from jsonb_array_elements(match_record->'targets') t),match_record);
      end loop;
      insert into public.supplier_price_match_chunks values(b.id,chunk,p_payload);
    else
      if b.status='review' then return jsonb_build_object('id',b.id,'reused',true); end if;
      select count(*) into rows_count from public.supplier_price_matches where batch_id=b.id;
      select count(*) into chunk_count from public.supplier_price_match_chunks where batch_id=b.id;
      if rows_count<>b.expected_matches or chunk_count<>b.expected_chunks then raise exception 'Matching incomplete'; end if;
      insert into public.supplier_template_review_units
      select b.id,t.id,t.template_name,count(*) filter(where m.classification in ('increased','decreased','changed','unchanged','shared')),
        count(*) filter(where m.classification in ('increased','decreased','changed','shared') and m.comparison<>'unchanged'),count(*) filter(where m.classification in ('increased','decreased','changed','unchanged','shared') and m.comparison='unchanged'),
        count(*) filter(where m.classification not in ('increased','decreased','changed','unchanged','shared')),
        case when count(*) filter(where m.classification not in ('increased','decreased','changed','unchanged','shared'))>0 then 'NEEDS_MAPPING' else 'READY' end
      from public.supplier_price_matches m cross join lateral unnest(m.template_ids) template_id join public.product_templates t on t.id=template_id
      where m.batch_id=b.id and (b.scope<>'selected_templates' or t.id=any(b.selected_template_ids)) group by t.id,t.template_name;
      update public.supplier_price_batches set status='review' where id=b.id;
    end if;
  elsif p_operation='archive_dimension' then
    update public.supplier_dimension_vocabulary set is_active=false,confirmed_by=auth.uid(),updated_at=now() where id=(p_payload->>'id')::uuid returning id into entity_id;
    if not found then raise exception 'Dimension mapping unavailable'; end if;
  elsif p_operation='dimension' then
    rule:=p_payload;
    if rule->>'template_id' is not null and not exists(select 1 from public.product_templates where id=(rule->>'template_id')::uuid and brand_id=(rule->>'brand_id')::uuid) then raise exception 'Invalid vocabulary Template'; end if;
    insert into public.supplier_dimension_vocabulary(brand_id,template_id,group_id,raw_labels,finish_codes,dimension_code,confirmed_by)
    values((rule->>'brand_id')::uuid,(rule->>'template_id')::uuid,nullif(rule->>'group_id',''),array(select jsonb_array_elements_text(rule->'raw_labels')),array(select jsonb_array_elements_text(rule->'finish_codes')),rule->>'dimension_code',auth.uid()) returning id into entity_id;
  elsif p_operation='bindings' then
    if jsonb_array_length(p_payload->'bindings') not between 1 and 500 then raise exception 'Select 1–500 mappings'; end if;
    for rule in select value from jsonb_array_elements(p_payload->'bindings') loop
      baselines:=rule->'baseline_snapshot';
      if jsonb_array_length(baselines)=0 then raise exception 'Mapping has no targets'; end if;
      if rule->>'kind'<>'shared' and jsonb_array_length(baselines)<>1 then raise exception 'Alias/disambiguation requires one target'; end if;
      if (select count(distinct t->>'key') from jsonb_array_elements(baselines) t)<>jsonb_array_length(baselines) then raise exception 'Duplicate binding targets'; end if;
      if rule->>'kind'='shared' and (jsonb_array_length(baselines)<2 or (select count(distinct jsonb_build_array(t->'price',t->'currency',t->'dimension',t->'price_field')) from jsonb_array_elements(baselines) t)<>1 or exists(select 1 from jsonb_array_elements(baselines) t where t->'price'='null'::jsonb)) then raise exception 'Shared baseline drift requires individual review'; end if;
      for target in select value from jsonb_array_elements(baselines) loop
        if target->>'price_field' is distinct from rule->>'price_field' then raise exception 'Binding price-field mismatch'; end if;
        if not exists(select 1 from public.product_templates where id=(target->>'template_id')::uuid and brand_id=(rule->>'brand_id')::uuid and is_active and pricing_version=(target->>'pricing_version')::bigint) then raise exception 'Binding baseline changed'; end if;
        perform supplier_price_private.verify_target(target,(rule->>'brand_id')::uuid);
      end loop;
      insert into public.supplier_price_bindings(brand_id,code,price_field,source_dimension,kind,target_keys,baseline_snapshot,confirmed_by)
      values((rule->>'brand_id')::uuid,rule->>'code',rule->>'price_field',rule->>'source_dimension',rule->>'kind',array(select t->>'key' from jsonb_array_elements(baselines) t),baselines,auth.uid())
      on conflict(brand_id,code,price_field,source_dimension) do update set kind=excluded.kind,target_keys=excluded.target_keys,baseline_snapshot=excluded.baseline_snapshot,confirmed_by=auth.uid(),updated_at=now() returning id into entity_id;
    end loop;
  else raise exception 'Unsupported review operation'; end if;
  return jsonb_build_object('id',entity_id);
end $$;
revoke all on function public.supplier_price_review_write(text,jsonb) from public;
grant execute on function public.supplier_price_review_write(text,jsonb) to authenticated;

-- Original structured files are private immutable provenance. No overwrite/delete
-- policy is granted. External original-PDF references remain metadata only.
insert into storage.buckets(id,name,public,file_size_limit) values('supplier-price-sources','supplier-price-sources',false,40000000) on conflict(id) do nothing;
create policy supplier_source_file_read on storage.objects for select to authenticated
using(bucket_id='supplier-price-sources' and public.current_user_can_review_brand_prices());
create policy supplier_source_file_insert on storage.objects for insert to authenticated
with check(bucket_id='supplier-price-sources' and public.current_user_can_review_brand_prices() and exists(
  select 1 from public.supplier_source_versions s where s.status in ('uploading','importing') and name=s.brand_id::text||'/'||s.id::text||'/'||s.file_hash||'.'||s.source_type
));
commit;
