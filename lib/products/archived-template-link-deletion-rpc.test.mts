import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Actual PostgreSQL execution in a disposable in-memory database. No network or project credentials.
// PGlite has one backend: these tests exercise RLS/atomic rollback, not two-session lock waits.
const db = new PGlite();
const sql = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const parent = "10000000-0000-4000-8000-000000000001", child = "10000000-0000-4000-8000-000000000002", other = "10000000-0000-4000-8000-000000000003";
const link = "20000000-0000-4000-8000-000000000001", otherLink = "20000000-0000-4000-8000-000000000002";
const brand = "30000000-0000-4000-8000-000000000001", otherBrand = "30000000-0000-4000-8000-000000000002";
type Outcome = { ok: boolean; code: string; deletedCount?: number; relationshipId?: string };
before(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create type public.user_role as enum ('system_owner','admin_manager','sales_designer','procurement_manager','designer','viewer');
    create table public.profiles(id uuid primary key, role public.user_role, account_status text);
    create function public.current_user_role() returns public.user_role language sql stable security definer set search_path=public as $$ select role from profiles where id=auth.uid() $$;
    create function public.current_account_status() returns text language sql stable security definer set search_path=public as $$ select account_status from profiles where id=auth.uid() $$;
    create function public.current_user_is_active() returns boolean language sql stable as $$ select coalesce(public.current_account_status()='active',false) $$;
    create function public.current_user_can_manage_settings() returns boolean language sql stable as $$ select public.current_user_role()::text in ('system_owner','admin_manager') and public.current_user_is_active() $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
    create table public.brands(id uuid primary key, name text);
    create table public.product_templates(id uuid primary key, brand_id uuid not null references public.brands(id), lifecycle_status text, is_active boolean);
    create table public.product_categories(id uuid primary key);
    create table public.product_components(id uuid primary key);
    create table public.quotation_items(id uuid primary key, source_template_id uuid references public.product_templates(id), snapshot jsonb);
    create table public.fixture_supplier_prices(id uuid primary key, template_id uuid references public.product_templates(id), price numeric);
    grant select,insert,update,delete on public.brands,public.product_templates to authenticated;
    alter table public.brands enable row level security;
    alter table public.product_templates enable row level security;
    create policy product_templates_select_active on public.product_templates for select to authenticated using(is_active and public.current_user_is_active());
  `);
  // Use the actual records permission helper and actual family schema/policies.
  const recordsHelper = sql("005_clients_projects.sql").match(/create or replace function public\.current_user_can_manage_records\(\)[\s\S]*?\$\$;/)![0];
  await db.exec(recordsHelper);
  await db.exec(sql("025_product_template_linked_families.sql"));
  await db.exec("grant delete on public.product_template_linked_families to authenticated"); // grant from 026
  await db.exec(sql("076_product_library_records_managers.sql"));
  await db.exec(sql("077_product_library_delete_records_managers.sql"));
  await db.exec(sql("081_sales_coordinator_role.sql").split("do $$")[0]);
  // Only the three relevant tables from 081's all-table loop are needed in this fixture.
  for (const table of ["brands", "product_templates", "product_template_linked_families"]) {
    await db.exec(`create policy sc_fixture on public.${table} to authenticated using(public.current_user_is_sales_coordinator()) with check(public.current_user_is_sales_coordinator())`);
  }
  await db.exec(sql("20261021120000_guard_archived_template_link_deletion.sql"));
});
after(() => db.close());
beforeEach(async () => {
  await db.exec(`reset role; drop trigger if exists fixture_skip_delete on public.product_template_linked_families;
    truncate public.product_template_linked_families,public.quotation_items,public.fixture_supplier_prices,public.product_templates,public.brands,public.profiles cascade;`);
  await db.exec(sql("076_product_library_records_managers.sql"));
  await db.exec(sql("077_product_library_delete_records_managers.sql"));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("insert into public.profiles values($1,'system_owner','active')", [owner]);
  await db.query("insert into public.brands values($1,'Brand A'),($2,'Brand B')", [brand, otherBrand]);
  await db.query("insert into public.product_templates values($1,$4,'archived',false),($2,$5,'active',true),($3,$4,'archived',false)", [parent, child, other, brand, otherBrand]);
  await db.query("insert into public.product_template_linked_families(id,parent_template_id,linked_template_id,is_active) values($1,$3,$4,false),($2,$3,$5,false)", [link, otherLink, parent, child, other]);
  await db.query("insert into public.quotation_items values($1,$2,$3)", [owner, parent, JSON.stringify({ name: "Historic", price: 125, linkedProducts: [{ id: link, templateId: child, price: 25 }] })]);
  await db.query("insert into public.fixture_supplier_prices values($1,$2,99)", [owner, child]);
});
async function invoke(templateId = parent, relationshipId = link): Promise<Outcome> {
  await db.exec("set role authenticated");
  try { return (await db.query<{ result: Outcome }>("select public.remove_archived_template_family_link($1,$2) result", [templateId, relationshipId])).rows[0].result; }
  finally { await db.exec("reset role"); }
}
async function links() { return (await db.query("select * from public.product_template_linked_families order by id")).rows; }
async function protectedState() { return Promise.all(["product_templates", "quotation_items", "fixture_supplier_prices"].map(async (table) => (await db.query(`select * from public.${table} order by id`)).rows)); }

test("inactive parent link removal is exact; quotations, supplier prices, templates and other links are untouched", async () => {
  const before = await protectedState(); const untouched = (await links())[1];
  const result = await invoke(); assert.equal(result.ok, true); assert.equal(result.deletedCount, 1); assert.equal(result.relationshipId, link);
  assert.deepEqual(await links(), [untouched]); assert.deepEqual(await protectedState(), before);
});
test("linked endpoint is supported; cross-brand relationships remain supported", async () => {
  await db.query("update public.product_templates set lifecycle_status='archived',is_active=false where id=$1", [child]);
  assert.equal((await invoke(child)).ok, true);
});
test("same-brand relationships are also supported", async () => {
  await db.query("update public.product_templates set brand_id=$1 where id=$2", [brand, child]);
  assert.equal((await invoke()).ok, true);
});
test("an inaccessible endpoint brand is rejected even though endpoint ids are supplied", async () => {
  await db.exec("drop policy brands_select_managers on public.brands");
  const before = await links(); assert.equal((await invoke()).code, "brand_unavailable"); assert.deepEqual(await links(), before);
});
test("active links are rejected, including activation committed immediately before the request", async () => {
  await db.query("update public.product_template_linked_families set is_active=true where id=$1", [link]);
  const before = await links(); assert.equal((await invoke()).code, "active_link"); assert.deepEqual(await links(), before);
});
test("selected template must be archived and inactive; a restore committed before the request is rejected", async () => {
  for (const [lifecycle, active] of [["active", true], ["discontinued", false], ["archived", true]] as const) {
    await db.query("update public.product_templates set lifecycle_status=$1,is_active=$2 where id=$3", [lifecycle, active, parent]);
    const before = await links(); assert.equal((await invoke()).code, "not_archived"); assert.deepEqual(await links(), before);
  }
});
test("wrong selected template, missing selected template and repeated deletion do not remove another link", async () => {
  const before = await links(); assert.equal((await invoke(other)).code, "wrong_relationship"); assert.deepEqual(await links(), before);
  assert.equal((await invoke(owner)).code, "template_unavailable"); assert.deepEqual(await links(), before);
  assert.equal((await invoke()).ok, true); const remaining = await links();
  assert.equal((await invoke()).code, "not_found"); assert.deepEqual(await links(), remaining);
});
test("last-link removal only changes relationship eligibility; it never deletes the template", async () => {
  assert.equal((await invoke()).ok, true); assert.equal((await invoke(parent, otherLink)).ok, true);
  assert.equal((await links()).length, 0);
  assert.equal((await db.query("select id from public.product_templates where id=$1", [parent])).rows.length, 1);
});
test("missing endpoint fails closed (orphan fixture bypasses FK triggers only during setup)", async () => {
  await db.exec("set session_replication_role=replica");
  await db.query("delete from public.product_templates where id=$1", [child]);
  await db.exec("set session_replication_role=origin");
  const before = await links(); assert.equal((await invoke()).code, "endpoint_unavailable"); assert.deepEqual(await links(), before);
});
test("unauthenticated, viewer and disabled callers cannot remove links", async () => {
  const before = await links();
  await db.exec("select set_config('request.jwt.claim.sub','',false)"); assert.equal((await invoke()).code, "unauthenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.query("update public.profiles set role='viewer' where id=$1", [owner]); assert.equal((await invoke()).code, "forbidden");
  await db.query("update public.profiles set role='system_owner',account_status='disabled' where id=$1", [owner]); assert.equal((await invoke()).code, "forbidden");
  assert.deepEqual(await links(), before);
});
test("existing RLS manager roles and sales coordinator can lock and delete; no new role permissions are granted", async () => {
  for (const role of ["system_owner", "admin_manager", "sales_designer", "sales_coordinator"]) {
    await db.query("update public.profiles set role=$1 where id=$2", [role, owner]);
    await db.exec("begin");
    try { assert.equal((await invoke()).ok, true, role); } finally { await db.exec("rollback"); }
  }
  for (const role of ["designer", "procurement_manager"]) {
    await db.query("update public.profiles set role=$1 where id=$2", [role, owner]);
    assert.equal((await invoke()).code, "forbidden", "The actual 005 helper, not its later migration comments, determines access");
  }
});
test("SECURITY INVOKER respects missing table privileges and row-lock UPDATE policies", async () => {
  const before = await links();
  await db.exec("revoke update on public.product_templates from authenticated");
  try { assert.equal((await invoke()).code, "forbidden"); } finally { await db.exec("grant update on public.product_templates to authenticated"); }
  await db.exec("drop policy product_templates_update_managers on public.product_templates");
  assert.equal((await invoke()).ok, false); assert.deepEqual(await links(), before);
});
test("zero affected rows rolls back all trigger side effects rather than claiming success", async () => {
  await db.exec(`create or replace function public.fixture_skip_delete() returns trigger language plpgsql as $$ begin
    if old.id='${link}' then delete from public.product_template_linked_families where id='${otherLink}'; return null; end if; return old; end $$;
    create trigger fixture_skip_delete before delete on public.product_template_linked_families for each row execute function public.fixture_skip_delete()`);
  const before = await links(); await assert.rejects(invoke(), /not confirmed/); assert.deepEqual(await links(), before);
});
test("RLS denial at deletion cannot produce a successful acknowledgement", async () => {
  await db.exec("drop policy product_template_linked_families_delete_settings_managers on public.product_template_linked_families");
  const before = await links(); await assert.rejects(invoke(), /not confirmed/); assert.deepEqual(await links(), before);
});
test("RPC is invoker-only with an empty search path, and anon cannot execute it", async () => {
  const settings = (await db.query<{ prosecdef: boolean; proconfig: string[] }>("select prosecdef,proconfig from pg_proc where oid='public.remove_archived_template_family_link(uuid,uuid)'::regprocedure")).rows[0];
  assert.equal(settings.prosecdef, false); assert.ok(settings.proconfig.includes('search_path=""'));
  await db.exec("set role anon");
  try { await assert.rejects(db.query("select public.remove_archived_template_family_link($1,$2)", [parent, link]), /permission denied/); }
  finally { await db.exec("reset role"); }
});
