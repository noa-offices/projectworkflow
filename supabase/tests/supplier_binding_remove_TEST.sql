-- RUN FIRST: supplier mapping removal preview. The migration and the tests are fully rolled back. Nothing is saved.
begin;
-- Remove one saved Supplier price mapping (supplier_price_bindings row) so a wrong mapping can be undone.
-- Hard delete scoped by id AND brand_id; the full removed row (including baseline_snapshot) is kept in audit_activity_log.
-- Nothing references supplier_price_bindings, so no other row is orphaned. Review batches keep their own stored match snapshots.
do $migration$
declare
  definition text;
  anchor constant text := $anchor$elsif p_operation='archive_dimension' then$anchor$;
  branch constant text := $branch$elsif p_operation='binding_remove' then
    if not public.current_user_can_approve_brand_prices() then raise insufficient_privilege; end if;
    if coalesce(p_payload->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(p_payload->>'brand_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Choose the mapping and Brand to remove';
    end if;
    select to_jsonb(x) into existing from public.supplier_price_bindings x
      where x.id=(p_payload->>'id')::uuid and x.brand_id=(p_payload->>'brand_id')::uuid for update;
    if existing is null then raise exception 'Supplier mapping unavailable for this Brand'; end if;
    delete from public.supplier_price_bindings where id=(p_payload->>'id')::uuid and brand_id=(p_payload->>'brand_id')::uuid;
    entity_id := (p_payload->>'id')::uuid;
    insert into public.audit_activity_log(entity_type,entity_id,parent_entity_type,parent_entity_id,action,title,description,metadata,created_by)
      values('supplier_price_binding',entity_id,'brand',(p_payload->>'brand_id')::uuid,'supplier_binding_removed','Supplier mapping removed',existing->>'code',jsonb_build_object('binding',existing),auth.uid());
  elsif p_operation='archive_dimension' then$branch$;
begin
  select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) into definition;
  if position('binding_remove' in definition)>0
    or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Deployed supplier review RPC differs from the expected body; review before migrating';
  end if;
  execute replace(definition,anchor,branch);
end $migration$;

select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.bind_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
-- The command must fail with this SQLSTATE and (optionally) a message containing the text.
create function pg_temp.bind_error(command text, expected text, fragment text default '') returns void language plpgsql as $$
begin begin execute command; exception when others then
  if sqlstate=expected and sqlerrm like '%'||fragment||'%' then return; end if; raise; end;
raise exception 'Expected SQLSTATE %: %',expected,command; end $$;
create function pg_temp.bind_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;

-- Users 1..9: system_owner, admin_manager, procurement_manager, sales_designer, sales_coordinator, designer, viewer, warehouse_staff, disabled owner.
insert into auth.users(id,email) select ('7b1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'binding-test-'||n||'@example.invalid' from generate_series(1,9) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('7b1e0000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'binding-test-'||n||'@example.invalid','Binding Test '||n,
 ((array['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff','system_owner'])[n])::public.user_role,
 (case when n=9 then 'disabled' else 'active' end)::public.account_status
from generate_series(1,9) n
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into public.brands(id,name) values ('7b1e0000-0000-0000-0001-00000000000a','Binding Fake Brand A'),('7b1e0000-0000-0000-0001-00000000000b','Binding Fake Brand B');
-- Brand A: one mapping per user number (a01..a06; a04 belongs to a denied role and is never removed) plus brand B's b01.
insert into public.supplier_price_bindings(id,brand_id,code,price_field,source_dimension,kind,target_keys,baseline_snapshot,confirmed_by)
select ('7b1e0000-0000-0000-0002-'||lpad(n::text,12,'0'))::uuid,'7b1e0000-0000-0000-0001-00000000000a','FAKE-A'||n,'unit_price','Tier '||n,'alias',array['target-'||n],jsonb_build_array(jsonb_build_object('key','target-'||n,'price',n*10)),'7b1e0000-0000-0000-0000-000000000001'
from generate_series(1,6) n;
insert into public.supplier_price_bindings(id,brand_id,code,price_field,source_dimension,kind,target_keys,baseline_snapshot,confirmed_by)
values('7b1e0000-0000-0000-0003-000000000001','7b1e0000-0000-0000-0001-00000000000b','FAKE-B1','unit_price','Tier 1','alias',array['target-b1'],'[{"key":"target-b1","price":5}]','7b1e0000-0000-0000-0000-000000000001');
-- Row fingerprints of the mappings that must never change (a04 and brand B's b01).
create temp table binding_before as select id,md5(to_jsonb(b)::text) h from public.supplier_price_bindings b where id in ('7b1e0000-0000-0000-0002-000000000004','7b1e0000-0000-0000-0003-000000000001');
grant all on binding_before to authenticated;

-- Non-approver roles (sales_designer, viewer, warehouse_staff), a disabled owner, no profile and no login cannot remove anything.
do $$ declare uid text; begin
 foreach uid in array array['7b1e0000-0000-0000-0000-000000000004','7b1e0000-0000-0000-0000-000000000007','7b1e0000-0000-0000-0000-000000000008','7b1e0000-0000-0000-0000-000000000009','7b1e0000-0000-0000-0000-999999999999',''] loop
  perform pg_temp.bind_as(uid);
  perform pg_temp.bind_error($q$select public.supplier_price_review_write('binding_remove','{"id":"7b1e0000-0000-0000-0002-000000000001","brand_id":"7b1e0000-0000-0000-0001-00000000000a"}')$q$,'42501');
 end loop;
end $$;
reset role;
select pg_temp.bind_check((select count(*)=7 from public.supplier_price_bindings where id::text like '7b1e0000%'),'denied roles removed nothing');

select pg_temp.bind_as('7b1e0000-0000-0000-0000-000000000001');
-- Wrong brand: the mapping exists, but not in brand B, so it is untouched and the error is clear.
select pg_temp.bind_error($q$select public.supplier_price_review_write('binding_remove','{"id":"7b1e0000-0000-0000-0002-000000000001","brand_id":"7b1e0000-0000-0000-0001-00000000000b"}')$q$,'P0001','unavailable for this Brand');
-- Missing mapping and malformed input.
select pg_temp.bind_error($q$select public.supplier_price_review_write('binding_remove','{"id":"7b1e0000-0000-0000-0002-0000000000ff","brand_id":"7b1e0000-0000-0000-0001-00000000000a"}')$q$,'P0001','unavailable for this Brand');
select pg_temp.bind_error($q$select public.supplier_price_review_write('binding_remove','{"id":"not-a-uuid","brand_id":"7b1e0000-0000-0000-0001-00000000000a"}')$q$,'P0001','Choose the mapping');
select pg_temp.bind_error($q$select public.supplier_price_review_write('binding_remove','{"brand_id":"7b1e0000-0000-0000-0001-00000000000a"}')$q$,'P0001','Choose the mapping');
reset role;
select pg_temp.bind_check((select count(*)=7 from public.supplier_price_bindings where id::text like '7b1e0000%'),'wrong brand, missing and malformed requests removed nothing');

-- Every allowed role (system_owner, admin_manager, procurement_manager, sales_coordinator, designer) removes exactly one mapping of its own.
do $$ declare n int; removed jsonb; begin
 foreach n in array array[1,2,3,5] loop
  perform pg_temp.bind_as('7b1e0000-0000-0000-0000-'||lpad(n::text,12,'0'));
  removed := public.supplier_price_review_write('binding_remove',jsonb_build_object('id','7b1e0000-0000-0000-0002-'||lpad(n::text,12,'0'),'brand_id','7b1e0000-0000-0000-0001-00000000000a'));
  perform pg_temp.bind_check(removed->>'id'='7b1e0000-0000-0000-0002-'||lpad(n::text,12,'0'),'removal returns the removed id');
 end loop;
 -- The designer (user 6) removes a06.
 perform pg_temp.bind_as('7b1e0000-0000-0000-0000-000000000006');
 removed := public.supplier_price_review_write('binding_remove',jsonb_build_object('id','7b1e0000-0000-0000-0002-000000000006','brand_id','7b1e0000-0000-0000-0001-00000000000a'));
 perform pg_temp.bind_check(removed->>'id'='7b1e0000-0000-0000-0002-000000000006','designer can remove');
end $$;
reset role;
-- Removed: a01, a02, a03, a05, a06. Left: a04 (denied role's mapping) and brand B's b01.
select pg_temp.bind_check((select count(*)=2 from public.supplier_price_bindings where id::text like '7b1e0000%'),'only the five requested mappings were removed');
select pg_temp.bind_check((select count(*)=2 from public.supplier_price_bindings b join binding_before x on x.id=b.id and x.h=md5(to_jsonb(b)::text)),'other mappings (same brand and other brand) are untouched');
-- Removing one again gives the clear error (no silent success).
select pg_temp.bind_as('7b1e0000-0000-0000-0000-000000000001');
select pg_temp.bind_error($q$select public.supplier_price_review_write('binding_remove','{"id":"7b1e0000-0000-0000-0002-000000000001","brand_id":"7b1e0000-0000-0000-0001-00000000000a"}')$q$,'P0001','unavailable for this Brand');
reset role;
-- Audit: one row per removal, with the actor and the full removed mapping (baseline kept for recovery).
select pg_temp.bind_check((select count(*)=5 from public.audit_activity_log where action='supplier_binding_removed' and entity_type='supplier_price_binding' and entity_id::text like '7b1e0000%'),'five audit rows');
select pg_temp.bind_check((select metadata->'binding'->>'code'='FAKE-A3' and metadata->'binding'->'baseline_snapshot'->0->>'key'='target-3' and created_by='7b1e0000-0000-0000-0000-000000000003' and parent_entity_id='7b1e0000-0000-0000-0001-00000000000a'
  from public.audit_activity_log where action='supplier_binding_removed' and entity_id='7b1e0000-0000-0000-0002-000000000003'),'audit keeps who removed it and the full mapping');
-- Existing operations are still in the same function and it stays closed to anon.
select pg_temp.bind_check(pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''bindings''%' and pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) like '%p_operation=''archive_dimension''%','existing operations remain');
select pg_temp.bind_check(not has_function_privilege('anon','public.supplier_price_review_write(text,jsonb)','EXECUTE'),'anon still cannot execute the review function');
rollback;
select 'PASS: supplier binding removal checks completed and rolled back' as result;
