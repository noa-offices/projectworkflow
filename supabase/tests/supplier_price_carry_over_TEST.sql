-- RUN FIRST: Task 19c migration and assertions, fully rolled back.
begin;
-- Task 19c APPLY. Read-only history from other uploads of this brand.
-- Run ../tests/supplier_price_carry_over_TEST.sql before applying this migration.
create function public.list_carry_over_decisions(p_supplier_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_brand_id uuid;
begin
  if auth.uid() is null or not coalesce(inventory.can_manage(),false) then
    raise exception 'Only System Owner and Admin Manager can read review decisions.' using errcode='42501';
  end if;
  select s.brand_id into v_brand_id
  from public.supplier_source_versions s
  where s.id=p_supplier_source_id and s.status='imported';
  if not found then
    raise exception 'Supplier price list is unavailable.' using errcode='22023';
  end if;

  -- Rank before limiting so one code/field always has its latest open choice.
  -- Archived earlier versions are included; they remain part of this brand's history.
  return coalesce((
    with ranked as (
      select d.model_code,d.price_field,d.category,d.decision,d.custom_price,d.note,
        d.imported_price,d.supplier_price,d.currency,d.decided_at,d.decided_by,
        d.supplier_source_id,d.supplier_price_list_label,
        row_number() over (partition by d.model_code,d.price_field order by d.decided_at desc,d.id desc) as choice_rank
      from public.supplier_price_review_decisions d
      join public.supplier_source_versions previous on previous.id=d.supplier_source_id
      where previous.brand_id=v_brand_id and d.supplier_source_id<>p_supplier_source_id and d.status='open'
    ), chosen as (
      select * from ranked where choice_rank=1 order by model_code,price_field limit 5000
    )
    select jsonb_agg(jsonb_build_object(
      'model_code',c.model_code,'price_field',c.price_field,'category',c.category,
      'decision',c.decision,'custom_price',c.custom_price,'note',c.note,
      'imported_price',c.imported_price,'supplier_price',c.supplier_price,'currency',c.currency,
      'decided_at',c.decided_at,'decided_by_name',
        case when nullif(btrim(p.full_name),'') is null or position('@' in p.full_name)>0
          then 'Team member' else btrim(p.full_name) end,
      'from_source_id',c.supplier_source_id,'from_label',c.supplier_price_list_label)
      order by c.model_code,c.price_field)
    from chosen c left join public.profiles p on p.id=c.decided_by
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.list_carry_over_decisions(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_carry_over_decisions(uuid) to authenticated;

select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.carry_check(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',message; end if; end $$;
create function pg_temp.carry_error(command text,state text) returns void language plpgsql as $$
begin begin execute command; exception when others then if sqlstate=state then return; end if; raise; end; raise exception 'Expected SQLSTATE %',state; end $$;
create function pg_temp.carry_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;

insert into auth.users(id,email) select ('19c00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'carry-test-'||n||'@example.invalid' from generate_series(1,11) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('19c00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'carry-test-'||n||'@example.invalid',
 (array['Olivia Carry Owner','Amal Carry Manager','Priya Carry Procurement','Samir Carry Sales','Sara Carry Coordinator','Dina Carry Designer','Vera Carry Viewer','Waleed Carry Warehouse','Dana Carry Disabled','Pavel Carry Pending',''])[n],
 ((array['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff','system_owner','admin_manager','admin_manager'])[n])::public.user_role,
 (case when n=9 then 'disabled' when n=10 then 'pending' else 'active' end)::public.account_status
from generate_series(1,11) n
on conflict (id) do update set email=excluded.email,full_name=excluded.full_name,role=excluded.role,account_status=excluded.account_status;
insert into public.brands(id,name) values ('19c00000-0000-0000-0001-000000000001','Task 19c Brand A'),('19c00000-0000-0000-0001-000000000002','Task 19c Brand B');
insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by)
select ('19c00000-0000-0000-0002-'||lpad(n::text,12,'0'))::uuid,
 case when n=5 then '19c00000-0000-0000-0001-000000000002'::uuid else '19c00000-0000-0000-0001-000000000001'::uuid end,
 '19c Fake List '||n,'19c-fake-'||n||'.csv','19c-fake-'||n,'csv','EUR','list','{}'::jsonb,
 case when n=4 then 'uploading' when n=1 then 'archived' else 'imported' end,1,1,1,'19c00000-0000-0000-0000-000000000001'::uuid from generate_series(1,5) n;
-- 1 and 2 earlier A uploads, 3 current A, 4 incomplete A, 5 another brand.
insert into public.supplier_price_review_decisions(id,supplier_source_id,supplier_price_list_label,model_code,price_field,category,imported_price,supplier_price,currency,decision,custom_price,note,status,decided_by,decided_at)
values
 ('19c00000-0000-0000-0003-000000000001','19c00000-0000-0000-0002-000000000001','19c Old A1','FAKE-CARRY-LATEST','unit_price','Standard',120,100,'EUR','keep_imported',null,'old note','open','19c00000-0000-0000-0000-000000000001','2026-10-01T00:00:00Z'),
 ('19c00000-0000-0000-0003-000000000002','19c00000-0000-0000-0002-000000000002','19c Old A2','FAKE-CARRY-LATEST','unit_price','Standard',120,100,'EUR','set_custom',85,'new note','open','19c00000-0000-0000-0000-000000000002','2026-10-02T00:00:00Z'),
 ('19c00000-0000-0000-0003-000000000003','19c00000-0000-0000-0002-000000000001','19c Old A1','FAKE-CARRY-CANCEL','unit_price',null,120,100,'EUR','ignore',null,null,'cancelled','19c00000-0000-0000-0000-000000000001','2026-10-03T00:00:00Z'),
 ('19c00000-0000-0000-0003-000000000004','19c00000-0000-0000-0002-000000000001','19c Old A1','FAKE-CARRY-APPLIED','unit_price',null,120,100,'EUR','ignore',null,null,'applied','19c00000-0000-0000-0000-000000000001','2026-10-03T00:00:00Z'),
 ('19c00000-0000-0000-0003-000000000005','19c00000-0000-0000-0002-000000000003','19c Current A','FAKE-CARRY-SELF','unit_price',null,120,100,'EUR','ignore',null,null,'open','19c00000-0000-0000-0000-000000000001','2026-10-04T00:00:00Z'),
 ('19c00000-0000-0000-0003-000000000006','19c00000-0000-0000-0002-000000000005','19c Brand B','FAKE-CARRY-OTHER','unit_price',null,120,100,'EUR','ignore',null,null,'open','19c00000-0000-0000-0000-000000000001','2026-10-04T00:00:00Z'),
 ('19c00000-0000-0000-0003-000000000007','19c00000-0000-0000-0002-000000000001','19c Old A1','FAKE-CARRY-TIE','unit_price',null,120,100,'EUR','ignore',null,null,'open','19c00000-0000-0000-0000-000000000001','2026-10-05T00:00:00Z'),
 ('19c00000-0000-0000-0003-000000000008','19c00000-0000-0000-0002-000000000002','19c Old A2','FAKE-CARRY-TIE','unit_price',null,120,100,'EUR','check_later',null,null,'open','19c00000-0000-0000-0000-000000000002','2026-10-05T00:00:00Z');

do $$ declare n int; uid text; begin
 for n in 3..10 loop
  uid='19c00000-0000-0000-0000-'||lpad(n::text,12,'0'); perform pg_temp.carry_as(uid);
  perform pg_temp.carry_error($q$select public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')$q$,'42501');
 end loop;
 perform pg_temp.carry_as('19c00000-0000-0000-0000-999999999999');
 perform pg_temp.carry_error($q$select public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')$q$,'42501');
 perform pg_temp.carry_as('');
 perform pg_temp.carry_error($q$select public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')$q$,'42501');
end $$;
select pg_temp.carry_as('19c00000-0000-0000-0000-000000000001');
select pg_temp.carry_check(jsonb_array_length(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003'))=2,'only two open other-version A decisions');
select pg_temp.carry_check(not exists(select 1 from jsonb_array_elements(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')) e where e->>'model_code' in ('FAKE-CARRY-CANCEL','FAKE-CARRY-APPLIED','FAKE-CARRY-SELF','FAKE-CARRY-OTHER')),'cancelled, applied, own and other-brand decisions excluded');
select pg_temp.carry_check((select e->>'decision' from jsonb_array_elements(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')) e where e->>'model_code'='FAKE-CARRY-LATEST')='set_custom','latest date wins');
select pg_temp.carry_check((select e->>'decision' from jsonb_array_elements(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')) e where e->>'model_code'='FAKE-CARRY-TIE')='check_later','id breaks timestamp ties');
select pg_temp.carry_check((select e->>'decided_by_name' from jsonb_array_elements(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')) e where e->>'model_code'='FAKE-CARRY-LATEST')='Amal Carry Manager','full name through profiles RLS');
select pg_temp.carry_check((select e->>'from_label' from jsonb_array_elements(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')) e where e->>'model_code'='FAKE-CARRY-LATEST')='19c Old A2','earlier label returned');
select pg_temp.carry_check((select e->>'from_source_id' from jsonb_array_elements(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')) e where e->>'model_code'='FAKE-CARRY-LATEST')='19c00000-0000-0000-0002-000000000002','earlier source returned');
select pg_temp.carry_error($q$select public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000004')$q$,'22023');
select pg_temp.carry_error($q$select public.list_carry_over_decisions('19c00000-0000-0000-0002-999999999999')$q$,'22023');
select pg_temp.carry_error($q$select public.list_carry_over_decisions(null)$q$,'22023');
select pg_temp.carry_as('19c00000-0000-0000-0000-000000000002');
select pg_temp.carry_check(jsonb_array_length(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003'))=2,'admin manager can read');
reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
update public.profiles set full_name='carry-test-2@example.invalid' where id='19c00000-0000-0000-0000-000000000002';
select pg_temp.carry_as('19c00000-0000-0000-0000-000000000001');
select pg_temp.carry_check((select e->>'decided_by_name' from jsonb_array_elements(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003')) e where e->>'model_code'='FAKE-CARRY-LATEST')='Team member','email-like name never returned');
reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
insert into public.supplier_price_review_decisions(id,supplier_source_id,supplier_price_list_label,model_code,price_field,imported_price,supplier_price,currency,decision,status,decided_by,decided_at)
select ('19c00000-0000-0000-0004-'||lpad(n::text,12,'0'))::uuid,'19c00000-0000-0000-0002-000000000001','19c Old A1','FAKE-CARRY-BULK-'||n,'unit_price',120,100,'EUR','ignore','open','19c00000-0000-0000-0000-000000000001','2026-10-01T00:00:00Z'
from generate_series(1,5001) n;
select pg_temp.carry_as('19c00000-0000-0000-0000-000000000001');
select pg_temp.carry_check(jsonb_array_length(public.list_carry_over_decisions('19c00000-0000-0000-0002-000000000003'))=5000,'output capped at 5000 latest keys');
reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true);
select pg_temp.carry_check(not has_function_privilege('anon','public.list_carry_over_decisions(uuid)','EXECUTE'),'anon execute revoked');
select pg_temp.carry_check(not has_function_privilege('service_role','public.list_carry_over_decisions(uuid)','EXECUTE'),'service role execute revoked');
select pg_temp.carry_check(has_function_privilege('authenticated','public.list_carry_over_decisions(uuid)','EXECUTE'),'authenticated execute granted');
select 'ALL 19c TESTS PASSED' as result;
rollback;
