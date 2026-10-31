-- RUN FIRST: per-product price check sign-off preview. The migration and the tests are fully rolled back. Nothing is saved.
begin;
-- A per-product "price checked" sign-off: one Product (product_templates row) is marked checked against one Supplier price list
-- (source version) WITHOUT completing the brand-wide review. Insert-only history; the newest row per (source_id, template_id) counts.
-- The sign-off remembers the product's pricing_version, so a later price edit makes it stale ("edited since check").
-- Access only through the SECURITY DEFINER functions below (deny-by-default RLS, no policies, no grants). Forward-only.
-- It never changes a price, a review batch, a decision or a brand baseline.

create table public.supplier_template_checks (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.supplier_source_definitions(id) on delete cascade,
  source_id uuid not null references public.supplier_source_versions(id) on delete cascade,
  template_id uuid not null references public.product_templates(id) on delete cascade,
  pricing_version bigint not null,
  line_count int not null check (line_count > 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  checked_by uuid references public.profiles(id),
  checked_at timestamptz not null default clock_timestamp()
);
create index supplier_template_checks_lookup on public.supplier_template_checks(source_id, template_id, checked_at desc);
create index supplier_template_checks_template on public.supplier_template_checks(template_id);
alter table public.supplier_template_checks enable row level security;
revoke all on public.supplier_template_checks from public, anon, authenticated;

-- The newest check per (source, product) for the given brands. Readers who can review Supplier prices need it to show the status.
create function public.supplier_template_checks_latest(p_brand_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.current_user_can_review_brand_prices() then raise insufficient_privilege; end if;
  if p_brand_ids is null or cardinality(p_brand_ids) not between 1 and 50 then raise exception 'Choose between 1 and 50 brands'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('template_id', x.template_id, 'source_id', x.source_id, 'definition_id', x.definition_id,
      'pricing_version', x.pricing_version::text, 'line_count', x.line_count, 'checked_at', x.checked_at) order by x.source_id, x.template_id)
    from (select distinct on (c.source_id, c.template_id) c.source_id, c.template_id, c.definition_id, c.pricing_version, c.line_count, c.checked_at
          from public.supplier_template_checks c join public.supplier_source_definitions d on d.id = c.definition_id
          where d.brand_id = any(p_brand_ids)
          order by c.source_id, c.template_id, c.checked_at desc, c.id desc) x), '[]'::jsonb);
end $$;
revoke all on function public.supplier_template_checks_latest(uuid[]) from public;
grant execute on function public.supplier_template_checks_latest(uuid[]) to authenticated;

-- Write operation: record one sign-off. The server has already rebuilt a clean comparison; the database re-checks what it can own.
do $migration$
declare
  definition text;
  anchor constant text := $anchor$elsif p_operation='archive_dimension' then$anchor$;
  branch constant text := $branch$elsif p_operation='template_check_set' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    if coalesce(p_payload->>'definition_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'source_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'template_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'expected_pricing_version','') !~ '^[0-9]{1,18}$'
      or coalesce(p_payload->>'line_count','') !~ '^[1-9][0-9]{0,8}$'
      or jsonb_typeof(p_payload->'summary') is distinct from 'object' or octet_length((p_payload->'summary')::text) > 20000 then
      raise exception 'Choose the product, the price list, its version and the checked lines';
    end if;
    -- Lock the product and compare its pricing version (brand_basis is only a text holder here).
    select tpl.pricing_version::text into brand_basis from public.product_templates tpl where tpl.id=(p_payload->>'template_id')::uuid and tpl.is_active for update;
    if brand_basis is null then raise exception 'Product unavailable'; end if;
    if brand_basis <> ((p_payload->>'expected_pricing_version')::bigint)::text then
      raise exception 'This Product Template changed. Build a fresh comparison before marking it checked.';
    end if;
    select defn.id into entity_id from public.supplier_source_definitions defn where defn.id=(p_payload->>'definition_id')::uuid and defn.is_active for share;
    if entity_id is null then raise exception 'Supplier price list unavailable'; end if;
    if not exists(select 1 from public.supplier_source_definition_families fam
        join public.supplier_source_definitions defn on defn.id=fam.definition_id join public.product_templates tpl on tpl.id=fam.template_id
        where fam.definition_id=entity_id and fam.template_id=(p_payload->>'template_id')::uuid and tpl.is_active and tpl.brand_id=defn.brand_id) then
      raise exception 'This product is not covered by this Supplier price list';
    end if;
    if not exists(select 1 from public.supplier_source_versions src where src.id=(p_payload->>'source_id')::uuid and src.definition_id=entity_id and src.status='imported') then
      raise exception 'This is not an imported version of this Supplier price list';
    end if;
    insert into public.supplier_template_checks(definition_id,source_id,template_id,pricing_version,line_count,summary,checked_by)
      values(entity_id,(p_payload->>'source_id')::uuid,(p_payload->>'template_id')::uuid,brand_basis::bigint,(p_payload->>'line_count')::int,p_payload->'summary',auth.uid())
      returning id into entity_id;
    insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
      values('supplier_template_check',(p_payload->>'template_id')::uuid,'supplier_source_definition',(p_payload->>'definition_id')::uuid,'supplier_template_checked','Product marked as price checked',
        (p_payload->>'line_count')||' price line(s) matched the Supplier price list',
        jsonb_build_object('source_id',p_payload->>'source_id','pricing_version',brand_basis,'line_count',(p_payload->>'line_count')::int,'summary',p_payload->'summary'),auth.uid());
  elsif p_operation='archive_dimension' then$branch$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if position('template_check_set' in definition)>0
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(definition,anchor,branch);
end $migration$;

select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.chk_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.chk_error(command text, expected text, fragment text default '') returns void language plpgsql as $$
begin begin execute command; exception when others then
  if sqlstate=expected and sqlerrm like '%'||fragment||'%' then return; end if; raise; end;
raise exception 'Expected SQLSTATE %: %',expected,command; end $$;
create function pg_temp.chk_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;
create temp table chk_ctx(template_id uuid, brand_id uuid, definition_id uuid, source_id uuid, version bigint, other_id uuid, other_version bigint);
grant all on chk_ctx to authenticated;

-- Users: 1 system_owner, 2 procurement_manager (both may write), 3 sales_designer, 4 viewer (neither may read or write).
insert into auth.users(id,email) select ('7d1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'chk-test-'||n||'@example.invalid' from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('7d1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'chk-test-'||n||'@example.invalid','Check Test '||n,
 ((array['system_owner','procurement_manager','sales_designer','viewer'])[n])::public.user_role,'active'::public.account_status
from generate_series(1,4) n
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into chk_ctx(template_id,brand_id,version) select id,brand_id,pricing_version from public.product_templates where is_active order by id limit 1;
do $$ begin if not exists(select 1 from chk_ctx) then raise exception 'These checks need at least one active product in the database'; end if; end $$;

-- A fake price list type covering that product, with one small imported source linked to it.
select pg_temp.chk_as('7d1e0000-0000-0000-0000-000000000001');
do $$ declare c chk_ctx; d jsonb; cfg jsonb; p jsonb; s jsonb; rws jsonb; cls jsonb; begin
  select * into c from chk_ctx;
  d := public.supplier_price_review_write('definition', jsonb_build_object('brand_id',c.brand_id,'name','Check Fake List'));
  perform public.supplier_price_review_write('definition_coverage', jsonb_build_object('definition_id',d->>'id','template_ids',jsonb_build_array(c.template_id)));
  cfg := '{"full_code_column":"CODE","strategy":"exact","currency":"EUR","basis":"unknown","price_columns":[{"column":"PRICE","price_field":"unit_price"}]}'::jsonb;
  p := public.supplier_price_review_write('profile', jsonb_build_object('brand_id',c.brand_id,'title','Check Fake Profile','config',cfg));
  s := public.supplier_price_review_write('source', jsonb_build_object('profile_id',p->>'id','expected_profile',cfg,'title','Check Fake Source','filename','c.xlsx','source_type','xlsx','file_hash',repeat('c',64),'expected_rows',2,'expected_cells',2,'expected_chunks',1));
  with v(n,code,price) as (values (1,'CHK-1',10),(2,'CHK-2',20))
  select jsonb_agg(jsonb_build_object('unit_key','s'||n,'sheet','S','row_number',n+1,'values',jsonb_build_object('CODE',code,'PRICE',price)) order by n),
         jsonb_agg(jsonb_build_object('unit_key',format('["s%s","PRICE"]',n),'row_key','s'||n,'code',code,'raw_code',code,'raw_article',code,'finish','','dimension','',
           'price_field','unit_price','price',price,'raw_price',price,'issues','[]'::jsonb,'companion_note','') order by n) into rws, cls from v;
  perform public.supplier_price_review_write('chunk', jsonb_build_object('source_id',s->>'id','chunk_index',0,'rows',rws,'cells',cls));
  perform public.supplier_price_review_write('finalize_source', jsonb_build_object('source_id',s->>'id'));
  perform public.supplier_price_review_write('source_definition', jsonb_build_object('source_id',s->>'id','definition_id',d->>'id'));
  update chk_ctx set definition_id=(d->>'id')::uuid, source_id=(s->>'id')::uuid;
end $$;
reset role;
-- What must never change: the product row, batches, decisions, bindings, brand baselines and components.
create temp table chk_before as select
  (select md5(to_jsonb(t)::text) from public.product_templates t where t.id=(select template_id from chk_ctx)) tpl,
  (select count(*) from public.supplier_price_batches) batches, (select count(*) from public.supplier_price_decisions) decisions,
  (select count(*) from public.supplier_price_bindings) bindings, (select count(*) from public.brand_price_list_updates) baselines, (select count(*) from public.product_components) components;

-- Another active product that is NOT covered (read here, as the database owner; the roles below never read product tables).
update chk_ctx c set other_id=o.id, other_version=o.pricing_version from (select pt.id, pt.pricing_version from public.product_templates pt where pt.is_active and pt.id<>(select template_id from chk_ctx) order by pt.id limit 1) o;

-- Neither a sales_designer nor a viewer, nor a missing profile, nor no login can write or read.
do $$ declare uid text; c chk_ctx; begin
  select * into c from chk_ctx;
  foreach uid in array array['7d1e0000-0000-0000-0000-000000000003','7d1e0000-0000-0000-0000-000000000004','7d1e0000-0000-0000-0000-999999999999',''] loop
    perform pg_temp.chk_as(uid);
    perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version),'42501');
    perform pg_temp.chk_error(format($q$select public.supplier_template_checks_latest(array['%s']::uuid[])$q$,c.brand_id),'42501');
  end loop;
end $$;
reset role;
select pg_temp.chk_check((select count(*)=0 from public.supplier_template_checks where definition_id=(select definition_id from chk_ctx)),'denied roles saved nothing');

-- An allowed role records a check; a second one for the same pair becomes the newest.
select pg_temp.chk_as('7d1e0000-0000-0000-0000-000000000002');
do $$ declare c chk_ctx; r jsonb; begin
  select * into c from chk_ctx;
  r := public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id',c.definition_id,'source_id',c.source_id,'template_id',c.template_id,'expected_pricing_version',c.version::text,'line_count',2,'summary','{"same":2}'::jsonb));
  perform pg_temp.chk_check(r->>'id' is not null,'returns the new check id');
  perform pg_temp.chk_check((select jsonb_array_length(public.supplier_template_checks_latest(array[c.brand_id]))>=1),'the check can be read');
  r := public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id',c.definition_id,'source_id',c.source_id,'template_id',c.template_id,'expected_pricing_version',c.version::text,'line_count',5,'summary','{"same":5}'::jsonb));
  perform pg_temp.chk_check((select count(*)=1 and bool_and((x->>'line_count')::int=5 and x->>'pricing_version'=c.version::text and x->>'source_id'=c.source_id::text)
    from jsonb_array_elements(public.supplier_template_checks_latest(array[c.brand_id])) x where x->>'template_id'=c.template_id::text),'only the newest check per product and price list is returned');
  -- A wrong or old pricing version is refused.
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version+1),'P0001','changed');
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version+100),'P0001','changed');
  -- An unknown product, an uncovered product and an unknown price list version are refused.
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','00000000-0000-0000-0000-00000000dead','expected_pricing_version','0','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id),'P0001','Product unavailable');
  if c.other_id is not null then
    perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.other_id,c.other_version),'P0001','not covered');
  end if;
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','00000000-0000-0000-0000-00000000dead','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','{}'::jsonb))$q$,c.definition_id,c.template_id,c.version),'P0001','not an imported version');
  -- Bad input.
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',0,'summary','{}'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version),'P0001','Choose the product');
  perform pg_temp.chk_error(format($q$select public.supplier_price_review_write('template_check_set',jsonb_build_object('definition_id','%s','source_id','%s','template_id','%s','expected_pricing_version','%s','line_count',2,'summary','[]'::jsonb))$q$,c.definition_id,c.source_id,c.template_id,c.version),'P0001','Choose the product');
end $$;
reset role;
-- Nothing else was written.
select pg_temp.chk_check((select (select md5(to_jsonb(t)::text) from public.product_templates t where t.id=(select template_id from chk_ctx))=b.tpl
  and (select count(*) from public.supplier_price_batches)=b.batches and (select count(*) from public.supplier_price_decisions)=b.decisions
  and (select count(*) from public.supplier_price_bindings)=b.bindings and (select count(*) from public.brand_price_list_updates)=b.baselines
  and (select count(*) from public.product_components)=b.components from chk_before b),'no price, batch, decision, binding, baseline or component was changed');
select pg_temp.chk_check((select count(*)=2 from public.supplier_template_checks where definition_id=(select definition_id from chk_ctx)),'only the two valid checks were stored (history kept)');
-- Audit: one row per stored check, with who and what.
select pg_temp.chk_check((select count(*)=2 and bool_and(created_by='7d1e0000-0000-0000-0000-000000000002' and (metadata->>'pricing_version')=(select version::text from chk_ctx) and metadata->>'source_id'=(select source_id::text from chk_ctx))
  from public.audit_activity_log where action='supplier_template_checked' and entity_id=(select template_id from chk_ctx)),'two audit rows with the actor, source and version');
-- Closed table, closed read function, existing operations intact.
select pg_temp.chk_check((select relrowsecurity from pg_class where oid='public.supplier_template_checks'::regclass),'RLS enabled');
select pg_temp.chk_check(not has_table_privilege('authenticated','public.supplier_template_checks','SELECT') and not has_table_privilege('authenticated','public.supplier_template_checks','INSERT') and not has_table_privilege('authenticated','public.supplier_template_checks','UPDATE') and not has_table_privilege('authenticated','public.supplier_template_checks','DELETE'),'no direct table access');
select pg_temp.chk_check(not has_function_privilege('anon','public.supplier_template_checks_latest(uuid[])','EXECUTE'),'anon cannot read');
select pg_temp.chk_check(pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''bindings''%' and pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''archive_dimension''%','existing operations remain');
rollback;
select 'PASS: supplier template check checks completed and rolled back' as result;
