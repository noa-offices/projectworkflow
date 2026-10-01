import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { preparePublication } from "./quotation-publication-payload";
import { oldWorkspace, quotationId, clientId, projectId, userId } from "./quotation-publication-fixture.mjs";

const db = new PGlite();
const payload = () => preparePublication(oldWorkspace(), userId);
const uuidFields = new Set(["id", "quotation_id", "client_id", "project_id", "created_by", "section_id", "parent_section_id", "parent_item_id", "source_template_id"]);
const jsonFields = new Set(["layout_settings", "source_component_data", "finish_selections_snapshot", "selected_options_snapshot", "internal_components_snapshot", "cell_layout"]);
function columns(row: Record<string, unknown>) {
  return Object.entries(row).filter(([key]) => key !== "source_id").map(([key, value]) =>
    key + " " + (uuidFields.has(key) ? "uuid" : jsonFields.has(key) ? "jsonb" : typeof value === "number" ? "numeric" : typeof value === "boolean" ? "boolean" : "text")
  ).join(",");
}
async function insertRow(table: string, row: Record<string, unknown>) {
  const entries = Object.entries(row).filter(([key]) => key !== "source_id");
  await db.query("insert into " + table + "(" + entries.map(([key]) => key).join(",") + ") values (" + entries.map((_, i) => "$" + (i + 1)).join(",") + ")",
    entries.map(([, value]) => typeof value === "object" && value !== null ? JSON.stringify(value) : value));
}
before(async () => {
  const p = payload();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.profiles(id uuid primary key, role text, account_status text);
    create table public.clients(id uuid primary key, company_name text);
    create table public.projects(id uuid primary key, client_id uuid, ${columns(p.project)});
    create table public.quotations(id uuid primary key, client_id uuid, project_id uuid,
      quotation_no text, created_by uuid, ${columns(p.quotation)});
    create table public.quotation_sections(${columns(p.sections[0])}, primary key(id));
    create table public.quotation_items(${columns(p.items[0])}, primary key(id));
    alter table public.quotation_items add check (qty >= 0);
    create table public.quotation_presentations(id uuid primary key default gen_random_uuid(), quotation_id uuid unique, settings_json jsonb);
    create table public.audit_activity_log(id uuid primary key default gen_random_uuid(), entity_type text, entity_id uuid, action text, title text, description text, metadata jsonb, created_by uuid);
    grant select on public.profiles to authenticated;
    grant select,insert,update on public.quotations,public.quotation_sections,public.quotation_items,public.quotation_presentations,public.projects,public.clients to authenticated;
    alter table public.quotations enable row level security;
    create policy quotation_owner on public.quotations to authenticated using(created_by=auth.uid()) with check(created_by=auth.uid());
    alter table public.quotation_sections enable row level security;
    create policy section_owner on public.quotation_sections to authenticated using(exists(select 1 from public.quotations q where q.id=quotation_id)) with check(exists(select 1 from public.quotations q where q.id=quotation_id));
    alter table public.quotation_items enable row level security;
    create policy item_owner on public.quotation_items to authenticated using(exists(select 1 from public.quotations q where q.id=quotation_id)) with check(exists(select 1 from public.quotations q where q.id=quotation_id));
  `);
  await db.exec(readFileSync("supabase/migrations/20261001093911_local_builder_atomic_publication.sql", "utf8"));
  await db.exec(`
    create function public.fixture_failure() returns trigger language plpgsql as $$
    begin
      if current_setting('fixture.fail_at',true)=tg_table_name then raise exception 'Injected mid-operation failure'; end if;
      return new;
    end; $$;
    create trigger fixture_item_failure before insert on public.quotation_items for each row execute function public.fixture_failure();
    create trigger fixture_project_failure before update on public.projects for each row execute function public.fixture_failure();
    create trigger fixture_presentation_failure before update on public.quotation_presentations for each row execute function public.fixture_failure();
    create trigger fixture_audit_failure before insert on public.audit_activity_log for each row execute function public.fixture_failure();
  `);
});
beforeEach(async () => {
  await db.exec("reset role; select set_config('fixture.fail_at','',false); truncate local_builder_private.publication_receipts,public.audit_activity_log,public.quotation_presentations,public.quotation_items,public.quotation_sections,public.quotations,public.projects,public.clients,public.profiles,auth.users cascade;");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.query("insert into auth.users values($1);", [userId]);
  await db.query("insert into public.profiles values($1,'designer','active')", [userId]);
  await db.query("insert into public.clients values($1,'Client')", [clientId]);
  await insertRow("public.projects", { id: projectId, client_id: clientId, ...payload().project });
  await insertRow("public.quotations", { id: quotationId, client_id: clientId, project_id: projectId, quotation_no: "QN-0001-001", created_by: userId, ...payload().quotation, title: "Prior server state" });
  await insertRow("public.quotation_sections", payload().sections[0]);
  await insertRow("public.quotation_items", payload().items[0]);
  await db.query("insert into public.quotation_presentations(quotation_id,settings_json) values($1,$2)", [quotationId, JSON.stringify({
    hiddenItemIds: [payload().items[0].id], sectionOverrides: { [payload().sections[0].id]: { title: "Keep" } }, unrelatedSetting: true,
  })]);
});
after(() => db.close());
async function version() {
  return (await db.query<{ workspace_version: string }>("select workspace_version from public.quotations where id=$1", [quotationId])).rows[0].workspace_version;
}
async function publish(base: string, mutation = crypto.randomUUID(), data = payload()) {
  await db.exec("set role authenticated");
  try {
    return (await db.query<{ result: { ok: boolean; code?: string; version: string; savedAt: string; mutationId: string } }>(
      "select public.publish_local_builder_workspace($1,$2,$3,$4) result", [quotationId, base, mutation, JSON.stringify(data)]
    )).rows[0].result;
  } finally { await db.exec("reset role"); }
}
async function state() {
  const tables = ["quotations", "quotation_sections", "quotation_items", "quotation_presentations", "projects", "audit_activity_log"];
  return Promise.all(tables.map(async (table) => (await db.query<Record<string, unknown>>("select * from public." + table + " order by id")).rows));
}
test("matching version publishes all state and remaps presentation references atomically", async () => {
  const base = await version();
  const result = await publish(base);
  assert.equal(result.ok, true);
  assert.notEqual(result.version, base);
  assert.equal(result.version, await version());
  const [q, sections, items, presentations, projects, audits] = await state();
  assert.equal(q[0].title, payload().quotation.title);
  assert.equal(Number(q[0].grand_total), payload().quotation.grand_total);
  const activeSections = sections.filter((r) => r.is_active);
  const activeItems = items.filter((r) => r.is_active);
  assert.equal(activeSections.length, 1);
  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].section_id, activeSections[0].id);
  assert.equal(Number(activeItems[0].qty), 2);
  assert.equal(projects[0].project_name, "Project");
  const settings = presentations[0].settings_json as { hiddenItemIds: string[]; sectionOverrides: Record<string, unknown>; unrelatedSetting: boolean };
  assert.deepEqual(settings.hiddenItemIds, [activeItems[0].id]);
  assert.ok(settings.sectionOverrides[String(activeSections[0].id)]);
  assert.equal(settings.unrelatedSetting, true);
  assert.equal(audits.length, 1);
});
for (const table of ["quotation_items", "quotation_presentations", "projects", "audit_activity_log"]) {
  test("failure at " + table + " rolls back replacement, versions, receipt and audit", async () => {
    const before = await state();
    const base = await version();
    await db.query("select set_config('fixture.fail_at',$1,false)", [table]);
    await assert.rejects(publish(base), /Injected mid-operation failure/);
    assert.deepEqual(await state(), before);
    assert.equal((await db.query("select * from local_builder_private.publication_receipts")).rows.length, 0);
  });
}
test("stale baseline conflicts without any writes", async () => {
  const stale = await version();
  await db.query("update public.quotation_items set qty=3 where quotation_id=$1", [quotationId]);
  const before = await state();
  const result = await publish(stale);
  assert.equal(result.code, "CONFLICT");
  assert.deepEqual(await state(), before);
});
test("same mutation retry after lost acknowledgement returns same result without another replacement/audit", async () => {
  const base = await version();
  const mutation = crypto.randomUUID();
  const first = await publish(base, mutation);
  const committed = await state();
  const retry = await publish(base, mutation);
  assert.deepEqual(retry, first);
  assert.deepEqual(await state(), committed);
});
test("same mutation ID cannot be reused with different content or base", async () => {
  const base = await version();
  const mutation = crypto.randomUUID();
  await publish(base, mutation);
  const before = await state();
  await assert.rejects(publish(base, mutation, { ...payload(), quotation: { ...payload().quotation, title: "Different intent" } }), /different content/);
  await assert.rejects(publish(await version(), mutation), /different content/);
  assert.deepEqual(await state(), before);
});
test("receipt retry acknowledges original version even after another writer changes server", async () => {
  const base = await version();
  const mutation = crypto.randomUUID();
  const first = await publish(base, mutation);
  await db.query("update public.quotations set title='Other device' where id=$1", [quotationId]);
  assert.deepEqual(await publish(base, mutation), first);
  assert.notEqual(await version(), first.version);
});
test("section, presentation, project and client writes all invalidate the aggregate baseline", async () => {
  for (const sql of [
    "update public.quotation_sections set section_title='Other'",
    "update public.quotation_presentations set settings_json='{}'",
    "update public.projects set project_name='Other'",
    "update public.clients set company_name='Other'",
  ]) {
    const before = await version(); await db.exec(sql); assert.notEqual(await version(), before);
  }
});
test("a client cannot assign the aggregate server version", async () => {
  const before = await version();
  await db.query("update public.quotations set workspace_version=$1 where id=$2", [before, quotationId]);
  assert.notEqual(await version(), before);
});
test("unauthenticated, inactive and forbidden users cannot publish", async () => {
  const base = await version();
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(publish(base), /Unauthorized/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec("update public.profiles set account_status='disabled'");
  await assert.rejects(publish(base), /Forbidden/);
  await db.exec("update public.profiles set account_status='active',role='viewer'");
  await assert.rejects(publish(base), /Forbidden/);
  assert.equal((await db.query("select * from public.audit_activity_log")).rows.length, 0);
});
test("SECURITY INVOKER publication respects target quotation RLS", async () => {
  const base = await version();
  const other = crypto.randomUUID();
  await db.query("insert into auth.users values($1)", [other]);
  await db.query("insert into public.profiles values($1,'designer','active')", [other]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  await assert.rejects(publish(base), /Quotation not found/);
});
test("anonymous role cannot call publication RPC or private receipt helpers", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select public.publish_local_builder_workspace($1,$2,$3,$4)", [quotationId, crypto.randomUUID(), crypto.randomUUID(), "{}"]), /permission denied/);
    await assert.rejects(db.query("select local_builder_private.publication_receipt($1,$2)", [quotationId, crypto.randomUUID()]), /permission denied/);
  } finally { await db.exec("reset role"); }
});
test("existing document setup remains authoritative for quotation and linked Project", async () => {
  await db.query("update public.quotations set layout_settings=$1 where id=$2", [JSON.stringify({ documentSetup: { header: { reference: "Server reference", contactName: "Server contact" } } }), quotationId]);
  await publish(await version());
  const [q, , , , projects] = await state();
  assert.equal((q[0].layout_settings as { documentSetup: { header: { reference: string } } }).documentSetup.header.reference, "Server reference");
  assert.equal(projects[0].project_name, "Server reference");
  assert.equal(projects[0].attention_to, "Server contact");
});
test("duplicate copied rows with shared source ID still get distinct server IDs", async () => {
  const data = payload();
  const source = data.items[0];
  data.items.push({ ...source, id: "copied-row", source_id: source.id, sort_order: 20 });
  await publish(await version(), crypto.randomUUID(), data);
  const rows = (await db.query<{ id: string }>("select id from public.quotation_items where is_active")).rows;
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
});

test("RLS-denied deactivation cannot silently create a mixed replacement", async () => {
  const before = await state();
  const base = await version();
  await db.exec(`
    drop policy item_owner on public.quotation_items;
    create policy item_read on public.quotation_items for select to authenticated using(true);
    create policy item_insert on public.quotation_items for insert to authenticated with check(true);
  `);
  try {
    await assert.rejects(publish(base), /Item replacement denied/);
    assert.deepEqual(await state(), before);
    assert.equal(await version(), base);
  } finally {
    await db.exec(`
      drop policy item_read on public.quotation_items;
      drop policy item_insert on public.quotation_items;
      create policy item_owner on public.quotation_items to authenticated using(exists(select 1 from public.quotations q where q.id=quotation_id)) with check(exists(select 1 from public.quotations q where q.id=quotation_id));
    `);
  }
});

test("presentation overrides retain user text even when text matches a replaced ID", async () => {
  const id = payload().items[0].id;
  await db.query("update public.quotation_presentations set settings_json=$1 where quotation_id=$2",
    [JSON.stringify({ itemOverrides: { [id]: { specification: id } } }), quotationId]);
  await publish(await version());
  const rows = (await db.query<{ settings_json: { itemOverrides: Record<string, { specification: string }> } }>(
    "select settings_json from public.quotation_presentations where quotation_id=$1", [quotationId])).rows;
  const overrides = rows[0].settings_json.itemOverrides;
  assert.notEqual(Object.keys(overrides)[0], id);
  assert.equal(Object.values(overrides)[0].specification, id);
});
