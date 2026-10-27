-- RUN FIRST: Task 19b preview. Schema + tests are fully rolled back. No permanent migration.
begin;
-- Task 19b APPLY. Run ../tests/supplier_price_review_decisions_TEST.sql first.
-- Decisions only: no product-price, draft, price-update or notification writes.
create table public.supplier_price_review_decisions (
  id uuid primary key default gen_random_uuid(),
  supplier_source_id uuid not null references public.supplier_source_versions(id) on delete cascade,
  supplier_price_list_label text not null check (length(btrim(supplier_price_list_label)) between 1 and 500),
  model_code text not null check (length(btrim(model_code)) between 1 and 200 and model_code=btrim(model_code)),
  price_field text not null check (price_field in ('unit_price','default_price','additional_price')),
  category text check (length(category)<=500),
  imported_price numeric check (imported_price>=0 and imported_price<=1000000000000000),
  supplier_price numeric check (supplier_price>=0 and supplier_price<=1000000000000000),
  currency text check (currency in ('AED','EUR','USD')),
  decision text not null check (decision in ('use_supplier','keep_imported','set_custom','check_later','ignore')),
  custom_price numeric check (custom_price>=0 and custom_price<=1000000000000000),
  note text check (length(note)<=500),
  status text not null default 'open' check (status in ('open','applied','cancelled')),
  decided_by uuid default auth.uid() references public.profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (supplier_source_id, model_code, price_field),
  check ((decision='set_custom' and custom_price is not null) or (decision<>'set_custom' and custom_price is null)),
  check (decision<>'use_supplier' or supplier_price is not null)
);
alter table public.supplier_price_review_decisions enable row level security;
-- Reuse the exact manager-only gate protecting inventory.product_costs.
create policy manager_read on public.supplier_price_review_decisions for select to authenticated
  using (auth.uid() is not null and inventory.can_manage());
-- No direct access, even for managers. RPCs below are the only application interface.
revoke all on public.supplier_price_review_decisions from public, anon, authenticated, service_role;

create function public.supplier_price_review_decisions_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=clock_timestamp(); new.updated_by=auth.uid(); return new; end;
$$;
revoke all on function public.supplier_price_review_decisions_updated_at() from public, anon, authenticated, service_role;
create trigger supplier_price_review_decisions_updated_at before update on public.supplier_price_review_decisions
for each row execute function public.supplier_price_review_decisions_updated_at();

create function public.list_supplier_price_decisions(p_supplier_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(inventory.can_manage(),false) then
    raise exception 'Only System Owner and Admin Manager can read review decisions.' using errcode='42501';
  end if;
  if p_supplier_source_id is null then raise exception 'Choose a supplier source.' using errcode='22023'; end if;
  -- Definer lookup intentionally bypasses profiles RLS; only full_name leaves this function.
  return coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('decided_by_name',
    case when nullif(btrim(p.full_name),'') is null or position('@' in p.full_name)>0 then 'Team member' else btrim(p.full_name) end)
    order by d.model_code,d.price_field)
    from public.supplier_price_review_decisions d left join public.profiles p on p.id=d.decided_by
    where d.supplier_source_id=p_supplier_source_id),'[]'::jsonb);
end;
$$;

create function public.save_supplier_price_decisions(p_decisions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb; field text; source_id uuid; saved_id uuid; saved_ids uuid[] := '{}';
  number_value numeric; seen text[] := '{}'; row_key text;
begin
  -- Check the live profile, never user-editable claims. Null/no profile fails closed.
  if auth.uid() is null or not coalesce(inventory.can_manage(),false) then
    raise exception 'Only System Owner and Admin Manager can save review decisions.' using errcode='42501';
  end if;
  if p_decisions is null or jsonb_typeof(p_decisions)<>'array' then
    raise exception 'Send an array of decisions.' using errcode='22023';
  end if;
  if jsonb_array_length(p_decisions) not between 1 and 200 then
    raise exception 'Save between 1 and 200 decisions at a time.' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_decisions) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Each decision must be an object.' using errcode='22023'; end if;
    if exists(select 1 from jsonb_object_keys(item) k where k not in
      ('supplier_source_id','supplier_price_list_label','model_code','price_field','category','imported_price','supplier_price','currency','decision','custom_price','note','status')) then
      raise exception 'Unsupported decision field.' using errcode='22023';
    end if;
    foreach field in array array['supplier_source_id','supplier_price_list_label','model_code','price_field','decision'] loop
      if jsonb_typeof(item->field) is distinct from 'string' or nullif(btrim(item->>field),'') is null or item->>field<>btrim(item->>field) then
        raise exception 'Invalid required text field: %',field using errcode='22023';
      end if;
    end loop;
    if (item->>'supplier_source_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or length(item->>'supplier_price_list_label')>500 or length(item->>'model_code')>200
      or item->>'price_field' not in ('unit_price','default_price','additional_price')
      or item->>'decision' not in ('use_supplier','keep_imported','set_custom','check_later','ignore') then
      raise exception 'Invalid source, code, price field or decision.' using errcode='22023';
    end if;
    foreach field in array array['category','note','currency'] loop
      if item ? field and jsonb_typeof(item->field) not in ('string','null') then raise exception 'Invalid text field: %',field using errcode='22023'; end if;
    end loop;
    if length(item->>'category')>500 or length(item->>'note')>500 or (item->>'currency' is not null and item->>'currency' not in ('AED','EUR','USD')) then
      raise exception 'Invalid currency or text longer than 500 characters.' using errcode='22023';
    end if;
    foreach field in array array['imported_price','supplier_price','custom_price'] loop
      if item ? field and jsonb_typeof(item->field)<>'null' then
        if jsonb_typeof(item->field)<>'number' then raise exception 'Invalid numeric field: %',field using errcode='22023'; end if;
        number_value=(item->>field)::numeric;
        if number_value<0 or number_value>1000000000000000 then raise exception 'Price out of range: %',field using errcode='22023'; end if;
      end if;
    end loop;
    if (item->>'decision'='set_custom' and item->>'custom_price' is null)
      or (item->>'decision'<>'set_custom' and item->>'custom_price' is not null)
      or (item->>'decision'='use_supplier' and item->>'supplier_price' is null) then
      raise exception 'This decision needs a valid price.' using errcode='22023';
    end if;
    -- Applied is reserved for the future price-application workflow, never accepted here.
    if item ? 'status' and (jsonb_typeof(item->'status') is distinct from 'string' or item->>'status' not in ('open','cancelled')) then
      raise exception 'Status must be open or cancelled.' using errcode='22023';
    end if;
    source_id=(item->>'supplier_source_id')::uuid;
    if not exists(select 1 from public.supplier_source_versions s where s.id=source_id and s.status='imported') then
      raise exception 'Supplier price list is unavailable.' using errcode='22023';
    end if;
    row_key=jsonb_build_array(source_id,item->>'model_code',item->>'price_field')::text;
    if row_key=any(seen) then raise exception 'Send each source, model code and price field only once.' using errcode='22023'; end if;
    seen=array_append(seen,row_key);
    insert into public.supplier_price_review_decisions as d
      (supplier_source_id,supplier_price_list_label,model_code,price_field,category,imported_price,supplier_price,currency,decision,custom_price,note,status,decided_by,decided_at,updated_by)
    values (source_id,item->>'supplier_price_list_label',item->>'model_code',item->>'price_field',item->>'category',(item->>'imported_price')::numeric,
      (item->>'supplier_price')::numeric,item->>'currency',item->>'decision',(item->>'custom_price')::numeric,item->>'note',coalesce(item->>'status','open'),auth.uid(),clock_timestamp(),auth.uid())
    on conflict (supplier_source_id,model_code,price_field) do update set
      supplier_price_list_label=excluded.supplier_price_list_label,category=excluded.category,imported_price=excluded.imported_price,supplier_price=excluded.supplier_price,
      currency=excluded.currency,decision=excluded.decision,custom_price=excluded.custom_price,note=excluded.note,status=excluded.status,
      decided_by=excluded.decided_by,decided_at=excluded.decided_at,updated_by=auth.uid()
    returning d.id into saved_id;
    saved_ids=array_append(saved_ids,saved_id);
  end loop;
  return (select jsonb_agg(to_jsonb(d) || jsonb_build_object('decided_by_name',
    case when nullif(btrim(p.full_name),'') is null or position('@' in p.full_name)>0 then 'Team member' else btrim(p.full_name) end)
    order by d.model_code,d.price_field)
    from public.supplier_price_review_decisions d left join public.profiles p on p.id=d.decided_by where d.id=any(saved_ids));
end;
$$;
revoke all on function public.list_supplier_price_decisions(uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_supplier_price_decisions(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.list_supplier_price_decisions(uuid) to authenticated;
grant execute on function public.save_supplier_price_decisions(jsonb) to authenticated;

select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
create function pg_temp.review_check(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.review_error(command text, expected text) returns void language plpgsql as $$
begin begin execute command; exception when others then if sqlstate=expected then return; end if; raise; end;
raise exception 'Expected SQLSTATE %: %',expected,command; end $$;
create function pg_temp.review_as(uid text) returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub',uid,true); execute 'set local role authenticated'; end $$;

-- Reserved fake IDs only. Profile upserts also work with the auth.users profile trigger.
insert into auth.users(id,email) select ('19b00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'review-test-'||n||'@example.invalid' from generate_series(1,11) n;
insert into public.profiles(id,email,full_name,role,account_status)
select ('19b00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'review-test-'||n||'@example.invalid',
 (array['Olivia Review Owner','Amal Review Manager','Priya Review Procurement','Samir Review Sales','Sara Review Coordinator','Dina Review Designer','Vera Review Viewer','Waleed Review Warehouse','Dana Disabled Owner','Pavel Pending Manager',''])[n],
 ((array['system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff','system_owner','admin_manager','admin_manager'])[n])::public.user_role,
 (case when n=9 then 'disabled' when n=10 then 'pending' else 'active' end)::public.account_status
from generate_series(1,11) n
on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, role=excluded.role, account_status=excluded.account_status;
insert into public.brands(id,name) values ('19b00000-0000-0000-0001-000000000001','Task 19b Fake Brand');
insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by)
values ('19b00000-0000-0000-0002-000000000001','19b00000-0000-0000-0001-000000000001','Task 19b Fake List','fake.csv','19b-fake','csv','EUR','list','{}','imported',1,1,1,'19b00000-0000-0000-0000-000000000001');

create function pg_temp.review_payload(patch jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_array('{"supplier_source_id":"19b00000-0000-0000-0002-000000000001","supplier_price_list_label":"Task 19b Fake List","model_code":"FAKE-19B-A1","price_field":"unit_price","category":null,"imported_price":120,"supplier_price":100,"currency":"EUR","decision":"use_supplier","custom_price":null,"note":null,"status":"open"}'::jsonb || patch)
$$;

-- Every non-manager role, inactive managers, no profile, and unauthenticated calls fail.
do $$ declare n int; uid text; begin
 for n in 3..10 loop
  uid := '19b00000-0000-0000-0000-'||lpad(n::text,12,'0'); perform pg_temp.review_as(uid);
  perform pg_temp.review_error('select public.save_supplier_price_decisions(pg_temp.review_payload())','42501');
  perform pg_temp.review_error($q$select public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')$q$,'42501');
 end loop;
 perform pg_temp.review_as('19b00000-0000-0000-0000-999999999999');
 perform pg_temp.review_error('select public.save_supplier_price_decisions(pg_temp.review_payload())','42501');
 perform pg_temp.review_as('');
 perform pg_temp.review_error('select public.save_supplier_price_decisions(pg_temp.review_payload())','42501');
end $$;

select pg_temp.review_as('19b00000-0000-0000-0000-000000000001');
select pg_temp.review_check(jsonb_array_length(public.save_supplier_price_decisions(pg_temp.review_payload()))=1,'owner can save');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Olivia Review Owner','full name, despite profiles RLS');
select pg_temp.review_error($q$select * from public.supplier_price_review_decisions where supplier_source_id='19b00000-0000-0000-0002-000000000001'$q$,'42501');
select pg_temp.review_error($q$update public.supplier_price_review_decisions set note='bypass' where supplier_source_id='19b00000-0000-0000-0002-000000000001'$q$,'42501');

select pg_temp.review_as('19b00000-0000-0000-0000-000000000002');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Olivia Review Owner','another saver full name works through profiles RLS');
select set_config('review.previous_id',public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'id',true);
select set_config('review.previous_updated_at',public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'updated_at',true);
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"keep_imported","note":"Manager checked"}'));
select pg_temp.review_check(jsonb_array_length(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001'))=1,'upsert keeps exactly one row');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decision'='keep_imported','upsert replaces decision');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Amal Review Manager','latest saver name');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'id'=current_setting('review.previous_id'),'upsert preserves record id');
select pg_temp.review_check((public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'updated_at')::timestamptz>current_setting('review.previous_updated_at')::timestamptz,'updated_at trigger runs');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'updated_by'='19b00000-0000-0000-0000-000000000002','updated_by is authenticated manager');

do $$ declare patch jsonb; begin
 for patch in select value from jsonb_array_elements('[{"decision":"bad"},{"decision":"set_custom"},{"decision":"set_custom","custom_price":-1},{"custom_price":1},{"supplier_price":null},{"supplier_price":"100"},{"imported_price":-1},{"supplier_source_id":"bad"},{"model_code":" "},{"price_field":"bad"},{"currency":"XXX"},{"category":3},{"note":3},{"status":"applied"},{"decided_by":"19b00000-0000-0000-0000-000000000001"}]'::jsonb) loop
  perform pg_temp.review_error(format('select public.save_supplier_price_decisions(pg_temp.review_payload(%L::jsonb))',patch),'22023');
 end loop;
 perform pg_temp.review_error(format('select public.save_supplier_price_decisions(pg_temp.review_payload(%L::jsonb))',jsonb_build_object('note',repeat('x',501))),'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('{}')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('null')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('[1]')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions('[]')$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions(pg_temp.review_payload('{"supplier_source_id":"19b00000-0000-0000-0002-999999999999"}'))$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions((select jsonb_agg(pg_temp.review_payload()->0) from generate_series(1,201)))$q$,'22023');
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions(pg_temp.review_payload() || pg_temp.review_payload())$q$,'22023');
 -- A bad second row must undo the first row too.
 perform pg_temp.review_error($q$select public.save_supplier_price_decisions(pg_temp.review_payload('{"model_code":"FAKE-19B-ATOMIC"}') || pg_temp.review_payload('{"decision":"bad"}'))$q$,'22023');
 perform pg_temp.review_check(jsonb_array_length(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001'))=1,'invalid batch is atomic');
end $$;
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"set_custom","custom_price":0}'));
select pg_temp.review_check((public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'custom_price')::numeric=0,'zero custom price allowed');
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"check_later"}'));
select public.save_supplier_price_decisions(pg_temp.review_payload('{"decision":"ignore","status":"cancelled"}'));
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'status'='cancelled','Not decided can cancel a saved decision');
select pg_temp.review_as('19b00000-0000-0000-0000-000000000011');
select public.save_supplier_price_decisions(pg_temp.review_payload());
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Team member','blank name never exposes an email');
select pg_temp.review_check(jsonb_array_length(public.save_supplier_price_decisions((select jsonb_agg(pg_temp.review_payload(jsonb_build_object('model_code','FAKE-19B-BULK-'||n))->0) from generate_series(1,200) n)))=200,'exactly 200 distinct decisions accepted');

reset role;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
update public.profiles set full_name='review-test-11@example.invalid' where id='19b00000-0000-0000-0000-000000000011';
select pg_temp.review_as('19b00000-0000-0000-0000-000000000011');
select pg_temp.review_check(public.list_supplier_price_decisions('19b00000-0000-0000-0002-000000000001')->0->>'decided_by_name'='Team member','an email stored as full_name is not disclosed');
reset role;
select set_config('request.jwt.claim.sub','',true), set_config('request.jwt.claims','{}',true);
-- Only fake rows are examined; table security/grants are metadata checks.
select pg_temp.review_check((select relrowsecurity from pg_class where oid='public.supplier_price_review_decisions'::regclass),'RLS enabled');
select pg_temp.review_check(not has_table_privilege('authenticated','public.supplier_price_review_decisions','INSERT,UPDATE,DELETE,SELECT'),'no direct table access');
select pg_temp.review_check(not has_function_privilege('anon','public.save_supplier_price_decisions(jsonb)','EXECUTE'),'anon cannot save');
select pg_temp.review_check(not has_function_privilege('anon','public.list_supplier_price_decisions(uuid)','EXECUTE'),'anon cannot list');
select pg_temp.review_check((select count(*)=1 from pg_trigger where tgrelid='public.supplier_price_review_decisions'::regclass and not tgisinternal),'updated_at trigger only, no notifications');
select pg_temp.review_check((select count(*)=1 from public.supplier_price_review_decisions where supplier_source_id='19b00000-0000-0000-0002-000000000001' and model_code='FAKE-19B-A1'),'one current decision');
rollback;
