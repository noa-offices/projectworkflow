-- Manual regression script for a disposable database AFTER both migrations.
-- Run as postgres (or an equivalent fixture-creating owner), with stop-on-error:
--   psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/warehouse_staff_lockdown.sql
-- Do not run against production. This script applies no migrations.
-- All fixture rows/users/functions are transaction-local and removed by ROLLBACK.
begin;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);

create temporary table lockdown_actors (
  label text primary key,
  id uuid not null default gen_random_uuid(),
  app_role public.user_role not null,
  account_status public.account_status not null
) on commit drop;
insert into lockdown_actors (label, app_role, account_status) values
  ('warehouse', 'warehouse_staff', 'active'),
  ('viewer', 'viewer', 'active'),
  ('sales', 'sales_designer', 'active'),
  ('pending', 'viewer', 'pending');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, id::text || '@warehouse-lockdown.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from lockdown_actors;
-- The normal auth trigger may already have inserted the profiles.
insert into public.profiles (id, email, full_name, role, account_status)
select id, id::text || '@warehouse-lockdown.invalid', 'Lockdown test', app_role, account_status
from lockdown_actors where true
on conflict (id) do update set role = excluded.role, account_status = excluded.account_status;

create temporary table lockdown_fixture on commit drop as
select gen_random_uuid() as client_id, gen_random_uuid() as project_id,
  gen_random_uuid() as quotation_id, gen_random_uuid() as brand_id,
  gen_random_uuid() as inactive_brand_id, gen_random_uuid() as category_id,
  gen_random_uuid() as template_id, gen_random_uuid() as worker_id,
  gen_random_uuid() as own_notification_id, gen_random_uuid() as sent_notification_id,
  gen_random_uuid() as unrelated_notification_id,
  'warehouse-lockdown-' || gen_random_uuid()::text as marker;

-- Explicit numbering avoids advancing the nontransactional client-number sequence.
insert into public.clients (id, company_name, client_number)
select client_id, marker, marker from lockdown_fixture;
insert into public.projects (id, client_id, project_name, project_number, project_sequence)
select project_id, client_id, marker, marker || '/0001', 1 from lockdown_fixture;
insert into public.quotations (id, client_id, project_id, title)
select quotation_id, client_id, project_id, marker from lockdown_fixture;
insert into public.brands (id, name, is_active)
select brand_id, marker, true from lockdown_fixture
union all select inactive_brand_id, marker || '-inactive', false from lockdown_fixture;
insert into public.product_categories (id, brand_id, name)
select category_id, brand_id, marker from lockdown_fixture;
insert into public.product_templates (id, brand_id, template_name)
select template_id, brand_id, marker from lockdown_fixture;
insert into public.workers (id, full_name)
select worker_id, marker from lockdown_fixture;
insert into public.company_settings (company_name)
select marker from lockdown_fixture where true on conflict do nothing;
insert into public.ai_provider_settings (provider_id)
select marker from lockdown_fixture;
insert into public.ai_agent_settings (agent_id)
select marker from lockdown_fixture;

insert into public.notifications (id, recipient_id, sender_id, body)
select f.own_notification_id, w.id, v.id, f.marker
from lockdown_fixture f, lockdown_actors w, lockdown_actors v
where w.label = 'warehouse' and v.label = 'viewer'
union all
select f.sent_notification_id, v.id, w.id, f.marker
from lockdown_fixture f, lockdown_actors w, lockdown_actors v
where w.label = 'warehouse' and v.label = 'viewer'
union all
select f.unrelated_notification_id, v.id, s.id, f.marker
from lockdown_fixture f, lockdown_actors v, lockdown_actors s
where v.label = 'viewer' and s.label = 'sales';

-- Fail if expected buckets are missing; do not fabricate deployment configuration.
do $$
begin
  if (select count(*) from storage.buckets where id in
    ('avatars', 'quote-images', 'product-images', 'project-documents')) <> 4 then
    raise exception 'Prerequisite missing: all four storage buckets must exist';
  end if;
end $$;
insert into storage.objects (bucket_id, name)
select b.bucket, a.id::text || '/' || f.marker || '.png'
from lockdown_fixture f, lockdown_actors a,
  (values ('avatars'), ('quote-images'), ('product-images'), ('project-documents')) b(bucket)
where a.label = 'warehouse';

grant select on lockdown_actors, lockdown_fixture to authenticated;

-- SECURITY INVOKER is essential: assertions execute under authenticated RLS.
create function pg_temp.lockdown_expect_count(query text, expected bigint)
returns void language plpgsql security invoker as $$
declare actual bigint;
begin
  execute query into actual;
  if actual is distinct from expected then
    raise exception 'Expected % rows, got %: %', expected, actual, query;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', id::text, 'role', 'authenticated')::text, true)
from lockdown_actors where label = 'warehouse';

do $$
declare table_name text; changed bigint;
begin
  if public.current_user_is_active() is distinct from false
    or public.current_user_can_access_inventory() is distinct from true then
    raise exception 'Warehouse helper authorization mismatch';
  end if;
  foreach table_name in array array[
    'clients', 'projects', 'quotations', 'product_templates', 'workers',
    'company_settings', 'ai_provider_settings', 'ai_agent_settings', 'product_categories'
  ] loop
    perform pg_temp.lockdown_expect_count(format('select count(*) from public.%I', table_name), 0);
  end loop;
  perform pg_temp.lockdown_expect_count(
    'select count(*) from public.brands where id = (select brand_id from lockdown_fixture)', 1);
  perform pg_temp.lockdown_expect_count('select count(*) from public.brands where not is_active', 0);
  perform pg_temp.lockdown_expect_count(
    'select count(*) from public.notifications where id in (select own_notification_id from lockdown_fixture union all select sent_notification_id from lockdown_fixture)', 2);
  perform pg_temp.lockdown_expect_count(
    'select count(*) from public.notifications where id = (select unrelated_notification_id from lockdown_fixture)', 0);
  update public.notifications set read_at = now()
  where id = (select own_notification_id from lockdown_fixture);
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Warehouse cannot mark own notification read'; end if;
  update public.notifications set read_at = now()
  where id = (select sent_notification_id from lockdown_fixture);
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Warehouse updated another recipient notification'; end if;
  perform pg_temp.lockdown_expect_count(
    'select count(*) from storage.objects where bucket_id = ''avatars'' and name like ''%'' || (select marker from lockdown_fixture) || ''.png''', 1);
  perform pg_temp.lockdown_expect_count(
    'select count(*) from storage.objects where bucket_id in (''quote-images'', ''product-images'', ''project-documents'')', 0);

  -- Exercise avatar insert and update exceptions, retaining the existing own-folder constraint.
  insert into storage.objects (bucket_id, name)
  select 'avatars', auth.uid()::text || '/' || marker || '-write.png' from lockdown_fixture;
  update storage.objects set metadata = '{"lockdown_test":true}'::jsonb
  where bucket_id = 'avatars' and name = auth.uid()::text || '/' || (select marker from lockdown_fixture) || '-write.png';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Warehouse avatar update failed'; end if;
end $$;

-- Existing-role positive controls use populated fixtures, not empty-table assertions.
-- These are SELECT regressions; business write policies are outside this change.
do $$
declare actor record; spec record;
begin
  for actor in select * from lockdown_actors where label in ('viewer', 'sales') loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', actor.id::text, 'role', 'authenticated')::text, true);
    if public.current_user_is_active() is distinct from true
      or public.current_user_can_access_inventory() is distinct from true then
      raise exception 'Existing role helper regression: %', actor.label;
    end if;
    for spec in select * from (values
      ('clients', 'client_id'), ('projects', 'project_id'), ('quotations', 'quotation_id'),
      ('brands', 'brand_id'), ('product_categories', 'category_id'),
      ('product_templates', 'template_id'), ('workers', 'worker_id')
    ) s(table_name, fixture_column) loop
      perform pg_temp.lockdown_expect_count(format(
        'select count(*) from public.%I where id = (select %I from lockdown_fixture)',
        spec.table_name, spec.fixture_column), 1);
    end loop;
    perform pg_temp.lockdown_expect_count('select count(*) from public.company_settings', 1);
    perform pg_temp.lockdown_expect_count(
      'select count(*) from public.ai_provider_settings where provider_id = (select marker from lockdown_fixture)', 1);
    perform pg_temp.lockdown_expect_count(
      'select count(*) from public.ai_agent_settings where agent_id = (select marker from lockdown_fixture)', 1);
    perform pg_temp.lockdown_expect_count(
      'select count(*) from storage.objects where bucket_id in (''avatars'', ''quote-images'', ''product-images'', ''project-documents'') and name like ''%'' || (select marker from lockdown_fixture) || ''.png''', 4);
    perform pg_temp.lockdown_expect_count(
      'select count(*) from public.notifications where id = (select unrelated_notification_id from lockdown_fixture)', 1);
  end loop;
end $$;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', id::text, 'role', 'authenticated')::text, true)
from lockdown_actors where label = 'pending';
do $$
begin
  if public.current_user_is_active() is distinct from false
    or public.current_user_can_access_inventory() is distinct from false then
    raise exception 'Pending user passed active helper checks';
  end if;
  perform pg_temp.lockdown_expect_count(
    'select count(*) from storage.objects where bucket_id = ''project-documents''', 0);
end $$;

reset role;
-- Direct deletes on storage.objects are blocked by Supabase, so the delete policy is checked structurally; insert and update are tested for real above.
do $$
declare policy_count integer; policy_qual text;
begin
  select count(*), min(qual) into policy_count, policy_qual
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'avatars_delete_own'
    and cmd = 'DELETE';

  if policy_count <> 1 or not coalesce(policy_qual like all (array[
    '%bucket_id%', '%avatars%', '%foldername%', '%auth.uid()%',
    '%current_account_status%', '%active%'
  ]), false) then
    raise exception 'Avatar delete policy structure mismatch';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.current_user_can_access_inventory()', 'execute')
    or not has_function_privilege('authenticated', 'public.current_user_can_access_inventory()', 'execute')
    or not has_function_privilege('service_role', 'public.current_user_can_access_inventory()', 'execute') then
    raise exception 'Inventory helper EXECUTE grants mismatch';
  end if;
end $$;
rollback;
