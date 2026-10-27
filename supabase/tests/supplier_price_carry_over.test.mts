import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Task 19c read-only carry-over SQL contract rolls back with all roles and source boundaries", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role;
      create schema auth; create schema inventory;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,inventory to authenticated; grant execute on function auth.uid() to authenticated;
      create table auth.users(id uuid primary key,email text);
      create type public.user_role as enum ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff');
      create type public.account_status as enum ('active','pending','disabled');
      create table public.profiles(id uuid primary key references auth.users(id),email text,full_name text,role public.user_role,account_status public.account_status);
      alter table public.profiles enable row level security; grant select on public.profiles to authenticated;
      create policy self_only on public.profiles to authenticated using(id=auth.uid());
      create function public.current_user_role() returns public.user_role language sql stable security definer as $$select role from public.profiles where id=auth.uid()$$;
      create function public.current_account_status() returns public.account_status language sql stable security definer as $$select account_status from public.profiles where id=auth.uid()$$;
      create table public.brands(id uuid primary key,name text);
      create table public.supplier_source_versions(id uuid primary key,brand_id uuid references public.brands(id),title text,filename text,file_hash text,source_type text,currency text,basis text,profile jsonb,status text,expected_rows int,expected_cells int,expected_chunks int,created_by uuid references public.profiles(id));`);
    const inventory = await readFile(new URL("../migrations/20261023100000_inventory_schema.sql", import.meta.url), "utf8");
    await db.exec(inventory.slice(inventory.indexOf("create or replace function inventory.can_manage()"), inventory.indexOf("create or replace function inventory.can_request_hold_book()")));
    await db.exec(await readFile(new URL("../migrations/20261028100000_supplier_price_review_decisions.sql", import.meta.url), "utf8"));
    const migration = await readFile(new URL("../migrations/20261029100000_supplier_price_carry_over_decisions.sql", import.meta.url), "utf8");
    const contract = await readFile(new URL("./supplier_price_carry_over.sql", import.meta.url), "utf8");
    const combined = await readFile(new URL("./supplier_price_carry_over_TEST.sql", import.meta.url), "utf8");
    assert.ok(combined.includes(migration.replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, "").trim()));
    assert.ok(combined.includes(contract.replace(/^[\s\S]*?\bbegin;\s*/i, "").trim()));
    assert.ok(combined.includes("select 'ALL 19c TESTS PASSED' as result;"));
    await db.exec(combined);
    assert.equal((await db.query<{ name: string | null }>("select to_regprocedure('public.list_carry_over_decisions(uuid)') as name")).rows[0].name, null);
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from auth.users")).rows[0].n, 0);
  } finally { await db.close(); }
});
