-- RUN FIRST: My Collection (saved_setups) preview. The migration and every check are fully rolled back.
-- Nothing is saved. Needs: the migration file 20261112100000_saved_setups.sql pasted below the BEGIN (or already applied),
-- at least 2 active profiles and at least 1 product template in the database.
begin;

-- >>> Paste the contents of supabase/migrations/20261112100000_saved_setups.sql here if it is not applied yet. <<<

-- 1. Read-only structure checks. Each raises an error on failure.
do $$
declare v_rls boolean; v_policies int; v_bad int;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.saved_setups'::regclass;
  if not coalesce(v_rls, false) then raise exception 'FAIL: RLS is not enabled on saved_setups'; end if;

  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'saved_setups'
     and policyname in ('saved_setups_select_own','saved_setups_insert_own','saved_setups_update_own','saved_setups_delete_own');
  if v_policies <> 4 then raise exception 'FAIL: expected 4 own-only policies, found %', v_policies; end if;

  select count(*) into v_bad from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'saved_setups' and grantee in ('anon','PUBLIC');
  if v_bad <> 0 then raise exception 'FAIL: anon/public still hold grants on saved_setups'; end if;

  -- Ownership and provenance columns must not be updatable by authenticated callers.
  select count(*) into v_bad from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'saved_setups' and grantee = 'authenticated'
     and privilege_type = 'UPDATE' and column_name in ('owner_id','template_id','source_setup_id','shared_by','id');
  if v_bad <> 0 then raise exception 'FAIL: authenticated can update an immutable column'; end if;

  raise notice 'PASS: structure checks';
end $$;

-- 2. Behaviour tests (self-undoing: everything is rolled back at the end).
do $$
declare
  user_a uuid; user_b uuid; tpl uuid := gen_random_uuid(); setup_a uuid;
  seen int; changed int; tpl_row public.product_templates%rowtype;
begin
  select id into user_a from public.profiles where account_status = 'active' order by created_at limit 1;
  select id into user_b from public.profiles where account_status = 'active' and id <> user_a order by created_at limit 1;
  if user_a is null or user_b is null then raise exception 'SKIP: need two active profiles'; end if;

  -- (a) user A inserts a setup, user B sees zero rows and cannot touch it.
  insert into public.saved_setups (owner_id, template_id, brand_name, product_name, setup_name, recipe)
  values (user_a, null, 'Brand', 'Product', 'A setup', '{"recipe_version":1}'::jsonb)
  returning id into setup_a;

  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into seen from public.saved_setups;
  if seen <> 0 then raise exception 'FAIL (a): user B can see % rows of user A', seen; end if;
  update public.saved_setups set setup_name = 'hijack' where id = setup_a;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL (a): user B renamed user A setup'; end if;
  delete from public.saved_setups where id = setup_a;
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL (a): user B deleted user A setup'; end if;
  reset role;

  -- user A sees own row; cannot insert a row for user B.
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into seen from public.saved_setups where id = setup_a;
  if seen <> 1 then raise exception 'FAIL (a): owner cannot see own setup'; end if;
  begin
    insert into public.saved_setups (owner_id, brand_name, product_name, setup_name, recipe)
    values (user_b, 'x', 'x', 'x', '{}'::jsonb);
    raise exception 'FAIL (a): owner inserted a row for someone else';
  exception when insufficient_privilege or check_violation then null; -- RLS rejection is the expected outcome
  end;
  reset role;

  -- (b) deleting a template is not blocked; the setup survives with template_id null and names intact.
  -- Best effort copy of an existing template; adjust unique columns if your schema has others.
  select * into tpl_row from public.product_templates limit 1;
  if tpl_row.id is null then raise exception 'SKIP (b): no product template to copy'; end if;
  tpl_row.id := tpl;
  tpl_row.template_code := 'TMP-SAVED-SETUP-' || left(tpl::text, 8);
  tpl_row.template_name := 'TMP saved setup test';
  insert into public.product_templates select (tpl_row).*;
  update public.saved_setups set template_id = tpl, brand_name = 'Keep Brand', product_name = 'Keep Product' where id = setup_a;
  delete from public.product_templates where id = tpl;   -- must succeed
  if not exists (
    select 1 from public.saved_setups
     where id = setup_a and template_id is null and brand_name = 'Keep Brand' and product_name = 'Keep Product'
  ) then raise exception 'FAIL (b): setup did not survive template deletion with names intact'; end if;

  raise notice 'PASS: behaviour tests';
end $$;

-- Everything above is undone.
rollback;
