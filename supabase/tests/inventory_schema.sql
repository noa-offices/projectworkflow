-- Run manually against a disposable database AFTER both inventory migrations.
-- Requires a fixture-creating database role. Use psql -X -v ON_ERROR_STOP=1.
-- All users, fixtures and temporary helpers are removed by the final ROLLBACK.
-- No storage object is deleted and no storage trigger is altered.
begin;
select set_config('request.jwt.claims', '{}', true);
select set_config('request.jwt.claim.sub', '', true);

create temporary table inventory_test_actors (
  label text primary key,
  id uuid not null default gen_random_uuid(),
  app_role public.user_role not null,
  account_status public.account_status not null default 'active'
) on commit drop;
insert into inventory_test_actors (label, app_role, account_status) values
  ('system_owner', 'system_owner', 'active'),
  ('admin_manager', 'admin_manager', 'active'),
  ('procurement_manager', 'procurement_manager', 'active'),
  ('sales_designer', 'sales_designer', 'active'),
  ('sales_coordinator', 'sales_coordinator', 'active'),
  ('designer', 'designer', 'active'),
  ('viewer', 'viewer', 'active'),
  ('warehouse_staff', 'warehouse_staff', 'active'),
  ('pending', 'warehouse_staff', 'pending'),
  ('disabled', 'admin_manager', 'disabled');

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, id::text || '@inventory-test.invalid',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
from inventory_test_actors;
insert into public.profiles (id, email, full_name, role, account_status)
select id, id::text || '@inventory-test.invalid', 'Inventory test', app_role, account_status
from inventory_test_actors where true
on conflict (id) do update set role = excluded.role, account_status = excluded.account_status;

create temporary table inventory_test_fixture on commit drop as
select gen_random_uuid() as brand_id, gen_random_uuid() as category_id,
  gen_random_uuid() as product_id, gen_random_uuid() as product_request_id,
  gen_random_uuid() as product_image_id, gen_random_uuid() as movement_id,
  gen_random_uuid() as movement_request_id,
  'inventory-test-' || gen_random_uuid()::text as marker;

insert into public.brands (id, name)
select brand_id, marker from inventory_test_fixture;
insert into inventory.categories (id, name, slug)
select category_id, marker, marker from inventory_test_fixture;
insert into inventory.products (
  id, brand_id, category_id, stock_ref, item_code, item_name, model_name,
  quantity, warehouse_quantity
)
select product_id, brand_id, category_id, marker, marker, marker, marker, 10, 10
from inventory_test_fixture;
insert into inventory.product_requests (
  id, brand_id, category_id, stock_ref, item_code, item_name, model_name, quantity, submitted_by
)
select f.product_request_id, f.brand_id, f.category_id, f.marker, f.marker,
  f.marker, f.marker, 1, a.id
from inventory_test_fixture f, inventory_test_actors a where a.label = 'warehouse_staff';
insert into inventory.product_images (id, product_id, storage_path, sort_order, is_main)
select product_image_id, product_id, 'products/' || product_id::text || '/main.jpg', 0, true
from inventory_test_fixture;
insert into inventory.movements (
  id, product_id, movement_type, action_type, to_location,
  quantity, previous_quantity, new_quantity, created_by
)
select f.movement_id, f.product_id, 'stock_in', 'receive_stock', 'warehouse',
  10, 0, 10, a.id
from inventory_test_fixture f, inventory_test_actors a where a.label = 'admin_manager';
insert into inventory.movement_requests (
  id, product_id, request_type, movement_type, from_location, to_location, quantity, submitted_by
)
select f.movement_request_id, f.product_id, 'take', 'stock_out', 'warehouse',
  'temporary_out', 1, a.id
from inventory_test_fixture f, inventory_test_actors a where a.label = 'warehouse_staff';

-- Valid INSERT commands distinguish policy denial from unrelated constraint failures.
create temporary table inventory_test_commands (
  table_name text primary key,
  insert_sql text not null,
  fixture_column text not null
) on commit drop;
insert into inventory_test_commands values
  ('categories', $sql$insert into inventory.categories (name, slug)
    values ('Created category', 'created-' || auth.uid()::text)$sql$, 'category_id'),
  ('products', $sql$insert into inventory.products
    (brand_id, category_id, stock_ref, item_code, item_name, model_name, quantity, warehouse_quantity)
    select brand_id, category_id, 'created-' || auth.uid()::text,
      'created-' || auth.uid()::text, marker, marker, 1, 1 from inventory_test_fixture$sql$, 'product_id'),
  ('product_requests', $sql$insert into inventory.product_requests
    (brand_id, category_id, stock_ref, item_code, item_name, model_name, quantity, submitted_by, request_status)
    select brand_id, category_id, marker, marker, marker, marker, 1, auth.uid(),
      'pending_review' from inventory_test_fixture$sql$, 'product_request_id'),
  ('product_images', $sql$insert into inventory.product_images (product_id, storage_path, sort_order)
    select product_id, 'products/' || product_id::text || '/extra.jpg', 1 from inventory_test_fixture$sql$, 'product_image_id'),
  ('movements', $sql$insert into inventory.movements
    (product_id, movement_type, action_type, to_location, quantity, previous_quantity, new_quantity, created_by)
    select product_id, 'stock_in', 'receive_stock', 'warehouse', 1, 10, 11,
      auth.uid() from inventory_test_fixture$sql$, 'movement_id'),
  ('movement_requests', $sql$insert into inventory.movement_requests
    (product_id, request_type, movement_type, from_location, to_location, quantity, submitted_by, request_status)
    select product_id, 'take', 'stock_out', 'warehouse', 'temporary_out', 1,
      auth.uid(), 'pending_review' from inventory_test_fixture$sql$, 'movement_request_id');
grant select on inventory_test_actors, inventory_test_fixture, inventory_test_commands to authenticated;

create function pg_temp.inventory_expect_count(query text, expected bigint)
returns void language plpgsql security invoker as $$
declare actual bigint;
begin
  execute query into actual;
  if actual is distinct from expected then
    raise exception 'Expected % rows, got %: %', expected, actual, query;
  end if;
end $$;

create function pg_temp.inventory_expect_denied(query text)
returns void language plpgsql security invoker as $$
begin
  begin
    execute query;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'Expected permission denial: %', query;
end $$;

set local role authenticated;
do $$
declare actor record; command record; request_kind text; sql_text text;
  new_id uuid; changed bigint; update_clause text;
begin
  for actor in select * from inventory_test_actors order by label loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', actor.id::text, 'role', 'authenticated')::text, true);

    if inventory.can_view() is distinct from (actor.account_status = 'active')
      or inventory.can_manage() is distinct from
        (actor.account_status = 'active' and actor.app_role in ('system_owner', 'admin_manager'))
      or inventory.can_request_hold_book() is distinct from
        (actor.account_status = 'active' and actor.app_role in ('procurement_manager', 'sales_designer', 'sales_coordinator', 'designer'))
      or inventory.can_request_add_take() is distinct from
        (actor.account_status = 'active' and actor.app_role = 'warehouse_staff') then
      raise exception 'Helper permissions mismatch: %', actor.label;
    end if;

    for command in select * from inventory_test_commands order by table_name loop
      if actor.account_status = 'active' then
        perform pg_temp.inventory_expect_count(format(
          'select count(*) from inventory.%I where id = (select %I from inventory_test_fixture)',
          command.table_name, command.fixture_column), 1);
      else
        perform pg_temp.inventory_expect_count(format('select count(*) from inventory.%I', command.table_name), 0);
      end if;

      if actor.account_status <> 'active' or actor.app_role = 'viewer' then
        perform pg_temp.inventory_expect_denied(command.insert_sql);
        perform pg_temp.inventory_expect_count(format(
          'with changed as (update inventory.%I set created_at = created_at returning id) select count(*) from changed',
          command.table_name), 0);
        perform pg_temp.inventory_expect_count(format(
          'with changed as (delete from inventory.%I returning id) select count(*) from changed',
          command.table_name), 0);
      elsif actor.app_role in ('warehouse_staff', 'procurement_manager', 'sales_designer', 'sales_coordinator', 'designer') then
        if command.table_name = 'product_requests' and actor.app_role = 'warehouse_staff' then
          execute command.insert_sql;
          perform pg_temp.inventory_expect_denied(replace(command.insert_sql, '''pending_review''', '''approved'''));
          perform pg_temp.inventory_expect_denied(replace(command.insert_sql, 'auth.uid()',
            '(select id from inventory_test_actors where label = ''admin_manager'')'));
        elsif command.table_name = 'movement_requests' then
          foreach request_kind in array array['take', 'move', 'hold', 'book'] loop
            sql_text := replace(command.insert_sql, '''take''', quote_literal(request_kind));
            if (actor.app_role = 'warehouse_staff' and request_kind in ('take', 'move'))
              or (actor.app_role <> 'warehouse_staff' and request_kind in ('hold', 'book')) then
              execute sql_text;
              perform pg_temp.inventory_expect_denied(replace(sql_text, '''pending_review''', '''approved'''));
              perform pg_temp.inventory_expect_denied(replace(sql_text, 'auth.uid()',
                '(select id from inventory_test_actors where label = ''admin_manager'')'));
            else
              perform pg_temp.inventory_expect_denied(sql_text);
            end if;
          end loop;
        else
          perform pg_temp.inventory_expect_denied(command.insert_sql);
        end if;
        -- Includes stock edits and request approvals: neither is allowed for these roles.
        update_clause := case when command.table_name in ('product_requests', 'movement_requests')
          then 'request_status = ''approved''' when command.table_name = 'products'
          then 'quantity = quantity + 1, warehouse_quantity = warehouse_quantity + 1'
          else 'created_at = created_at' end;
        perform pg_temp.inventory_expect_count(format(
          'with changed as (update inventory.%I set %s returning id) select count(*) from changed',
          command.table_name, update_clause), 0);
      elsif actor.app_role = 'admin_manager' then
        execute command.insert_sql || ' returning id' into new_id;
        if command.table_name in ('product_requests', 'movement_requests') then
          perform pg_temp.inventory_expect_denied(replace(command.insert_sql, 'auth.uid()',
            '(select id from inventory_test_actors where label = ''viewer'')'));
          perform pg_temp.inventory_expect_denied(replace(command.insert_sql, '''pending_review''', '''approved'''));
        end if;
        if command.table_name = 'movement_requests' then
          foreach request_kind in array array['move', 'hold', 'book'] loop
            execute replace(command.insert_sql, '''take''', quote_literal(request_kind));
          end loop;
        end if;
        update_clause := case when command.table_name in ('product_requests', 'movement_requests')
          then 'request_status = ''approved'', reviewed_by = auth.uid(), reviewed_at = now()'
          when command.table_name = 'products' then 'quantity = 2, warehouse_quantity = 2'
          else 'created_at = created_at' end;
        execute format('update inventory.%I set %s where id = %L', command.table_name, update_clause, new_id);
        get diagnostics changed = row_count;
        if changed <> 1 then raise exception 'Manager UPDATE failed: %', command.table_name; end if;
        if command.table_name <> 'movement_requests' then
          execute format('delete from inventory.%I where id = %L', command.table_name, new_id);
          get diagnostics changed = row_count;
          if changed <> 1 then raise exception 'Manager DELETE failed: %', command.table_name; end if;
        else
          execute format('delete from inventory.movement_requests where id = %L', new_id);
          get diagnostics changed = row_count;
          if changed <> 0 then raise exception 'Movement requests must be review-only'; end if;
        end if;
      end if;
    end loop;
  end loop;
end $$;

reset role;
do $$
declare helper text; target_table text; policy_record record;
begin
  if has_schema_privilege('anon', 'inventory', 'usage') then
    raise exception 'Anon has inventory schema access';
  end if;
  foreach helper in array array['can_view', 'can_manage', 'can_request_hold_book', 'can_request_add_take'] loop
    if has_function_privilege('anon', format('inventory.%I()', helper), 'execute')
      or not has_function_privilege('authenticated', format('inventory.%I()', helper), 'execute')
      or not has_function_privilege('service_role', format('inventory.%I()', helper), 'execute') then
      raise exception 'Helper grants mismatch: %', helper;
    end if;
  end loop;
  foreach target_table in array array['categories', 'products', 'product_requests', 'product_images', 'movements', 'movement_requests'] loop
    if not (select relrowsecurity from pg_class where oid = format('inventory.%I', target_table)::regclass)
      or has_table_privilege('anon', format('inventory.%I', target_table), 'select,insert,update,delete') then
      raise exception 'RLS/table grants mismatch: %', target_table;
    end if;
  end loop;
  if not exists (select 1 from storage.buckets where id = 'inventory-images'
    and public = false and file_size_limit = 5242880
    and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
    and cardinality(allowed_mime_types) = 3) then
    raise exception 'Inventory image bucket configuration mismatch';
  end if;

  -- Supabase blocks direct object deletes; verify all four storage policies structurally.
  if (select count(*) from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname like 'inventory_images_%') <> 4 then
    raise exception 'Inventory storage policy count mismatch';
  end if;
  for policy_record in select * from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname like 'inventory_images_%' loop
    if policy_record.roles <> array['authenticated']::name[] or policy_record.permissive <> 'PERMISSIVE' then
      raise exception 'Storage policy role/mode mismatch: %', policy_record.policyname;
    end if;
    if policy_record.policyname = 'inventory_images_select' then
      if policy_record.cmd <> 'SELECT' or not coalesce(policy_record.qual like all
        (array['%bucket_id%', '%inventory-images%', '%can_view%']), false) then
        raise exception 'Inventory storage SELECT mismatch';
      end if;
    elsif policy_record.policyname = 'inventory_images_insert' then
      if policy_record.cmd <> 'INSERT' or not coalesce(policy_record.with_check like all
        (array['%bucket_id%', '%inventory-images%', '%can_manage%', '%requests%', '%products%',
          '%foldername%', '%can_request_hold_book%', '%can_request_add_take%']), false) then
        raise exception 'Inventory storage INSERT mismatch';
      end if;
    elsif policy_record.policyname = 'inventory_images_update' then
      if policy_record.cmd <> 'UPDATE' or not coalesce(policy_record.qual like all
        (array['%bucket_id%', '%inventory-images%', '%can_manage%']), false)
        or not coalesce(policy_record.with_check like all
          (array['%bucket_id%', '%inventory-images%', '%can_manage%', '%foldername%']), false) then
        raise exception 'Inventory storage UPDATE mismatch';
      end if;
    elsif policy_record.policyname = 'inventory_images_delete' then
      if policy_record.cmd <> 'DELETE' or not coalesce(policy_record.qual like all
        (array['%bucket_id%', '%inventory-images%', '%can_manage%']), false) then
        raise exception 'Inventory storage DELETE mismatch';
      end if;
    else
      raise exception 'Unexpected inventory storage policy: %', policy_record.policyname;
    end if;
  end loop;
end $$;

set local role anon;
do $$
declare target_table text;
begin
  foreach target_table in array array['categories', 'products', 'product_requests', 'product_images', 'movements', 'movement_requests'] loop
    perform pg_temp.inventory_expect_denied(format('select * from inventory.%I', target_table));
    perform pg_temp.inventory_expect_denied(format('insert into inventory.%I default values', target_table));
  end loop;
end $$;
reset role;
rollback;
