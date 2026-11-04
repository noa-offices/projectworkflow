import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { projectFileRecordValue } from "./project-file";
import { isMissingFunctionError, projectSnapshotNotice, saveProjectSnapshot, snapshotItemGrands, snapshotPricedLines, snapshotTotalsMatch, type ProjectSnapshotLine } from "./project-snapshot";

const migration = readFileSync("supabase/migrations/20261107100000_project_snapshots.sql", "utf8").replace(/\r\n/g, "\n");
const line = (over: Partial<ProjectSnapshotLine> = {}): ProjectSnapshotLine => ({ original_item_id: "a", item_type: "product", line_style: "normal", is_rate_only: false, is_optional: false, include_in_total: true, qty: 1, net_total: 1399, ...over });

// ---- Pure rule ----

test("only the lines that count towards totals are priced", () => {
  const lines = [line(), line({ is_rate_only: true }), line({ is_optional: true, include_in_total: false }), line({ is_optional: true }), line({ line_style: "heading" }), line({ item_type: "note" })];
  assert.equal(snapshotPricedLines(lines).length, 2);
});

test("whole AED must match to the cent: equal passes, off by 0.01 does not", () => {
  const grands = snapshotItemGrands({ lines: [line()], overallDiscountType: "amount", overallDiscountValue: 0, vatPercent: 5 });
  assert.equal(grands.exact, 1468.95);
  assert.equal(snapshotTotalsMatch("whole_aed_v1", grands, 1468.95), true);
  assert.equal(snapshotTotalsMatch("whole_aed_v1", grands, 1468.96), false);
  assert.equal(snapshotTotalsMatch("whole_aed_v1", grands, 1468.94), false);
  assert.equal(snapshotTotalsMatch("whole_aed_v1", grands, 1470), false);
});

test("legacy accepts the rounded total, the exact total, and 0.01 of binary-fraction drift, and nothing else", () => {
  const grands = snapshotItemGrands({ lines: [line({ net_total: 1399.5 })], overallDiscountType: "amount", overallDiscountValue: 0, vatPercent: 5 });
  assert.deepEqual(grands, { rounded: 1470, exact: 1469.48 });
  assert.equal(snapshotTotalsMatch("round_up_5_legacy", grands, 1470), true); // the shared builder
  assert.equal(snapshotTotalsMatch("round_up_5_legacy", grands, 1469.48), true); // exact
  assert.equal(snapshotTotalsMatch("round_up_5_legacy", grands, 1469.47), true); // the local builder's binary fraction, 69.97 VAT
  const twoLines = snapshotItemGrands({ lines: [line({ net_total: 101 }), line({ net_total: 101 })], overallDiscountType: "amount", overallDiscountValue: 0, vatPercent: 5 });
  assert.deepEqual(twoLines, { rounded: 225, exact: 212.1 });
  assert.equal(snapshotTotalsMatch("round_up_5_legacy", twoLines, 215), true); // a legacy Project File total: the exact total rounded up to 5
  assert.equal(snapshotTotalsMatch("round_up_5_legacy", grands, 1469.45), false);
  assert.equal(snapshotTotalsMatch("round_up_5_legacy", grands, 1480), false);
});

test("a line from the Price Rounding box counts at its rounded net, and the overall discount applies", () => {
  const input = { lines: [line({ qty: 2, net_total: 2798 })], overallDiscountType: "percent", overallDiscountValue: 10, vatPercent: 5 };
  assert.equal(snapshotItemGrands(input).exact, 2644.11);
  assert.equal(snapshotItemGrands({ ...input, roundedNetPrices: { a: 1400 } }).exact, 2646);
  assert.equal(snapshotItemGrands({ ...input, overallDiscountType: "amount", overallDiscountValue: 5000 }).exact, 0);
});

// ---- The action ----

const rpcClient = (result: () => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>) => ({ rpc: () => result() });

test("the save tells created from existing, and tolerates a missing function, an error and a throw", async (t) => {
  t.mock.method(console, "warn", () => {}); t.mock.method(console, "error", () => {});
  assert.equal(await saveProjectSnapshot(rpcClient(async () => ({ data: { id: "s", created: true }, error: null })), "q"), "created");
  assert.equal(await saveProjectSnapshot(rpcClient(async () => ({ data: { id: "s", created: false }, error: null })), "q"), "existed");
  assert.equal(await saveProjectSnapshot(rpcClient(async () => ({ data: null, error: { code: "PGRST202" } })), "q"), "function_missing");
  assert.equal(await saveProjectSnapshot(rpcClient(async () => ({ data: null, error: { code: "42883" } })), "q"), "function_missing");
  assert.equal(await saveProjectSnapshot(rpcClient(async () => ({ data: null, error: { code: "P0001", message: "no" } })), "q"), "failed");
  assert.equal(await saveProjectSnapshot(rpcClient(async () => { throw new Error("network"); }), "q"), "failed");
  assert.equal(isMissingFunctionError(null), false);
});

test("only a real failure adds a note to the success message", () => {
  for (const attempt of ["created", "existed", "function_missing"] as const) assert.equal(projectSnapshotNotice(attempt), "");
  assert.equal(projectSnapshotNotice("failed"), " The Project copy will be made later.");
});

test("Create Project File saves the copy only after the Project File is written, and keeps the same success path", () => {
  const actions = readFileSync("app/quotations/actions.ts", "utf8").replace(/\r\n/g, "\n");
  const body = actions.slice(actions.indexOf("export async function createProjectFileFromQuotation"), actions.indexOf("export async function updateQuotation(formData"));
  const write = body.indexOf("layout_settings: mergeProjectFileIntoLayoutSettings(quotation.layout_settings, projectFile)");
  const failure = body.indexOf('"Project File could not be created"');
  const save = body.indexOf("await saveProjectSnapshot(supabase, quotation.id)");
  const done = body.indexOf("Project File ${orderNo} created.${projectSnapshotNotice(snapshotAttempt)}");
  assert.ok(write > 0 && write < failure && failure < save && save < done);
  assert.equal(actions.split("saveProjectSnapshot(").length - 1, 1); // the one call
});

// ---- Migration text ----

test("the migration: closed tables, immutable rows, one per Project, nothing else changed", () => {
  for (const table of ["project_snapshots", "project_snapshot_sections", "project_snapshot_items"]) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`), table);
    assert.ok(migration.includes(`create trigger ${table}_no_change before update or delete on public.${table}`), table);
    assert.ok(migration.includes(`create trigger ${table}_no_truncate before truncate on public.${table}`), table);
  }
  assert.ok(migration.includes("revoke all on public.project_snapshots, public.project_snapshot_sections, public.project_snapshot_items from public, anon, authenticated, service_role;"));
  assert.ok(migration.includes("grant select on public.project_snapshots, public.project_snapshot_sections, public.project_snapshot_items to authenticated;"));
  assert.doesNotMatch(migration, /grant (all|insert|update|delete)[^;]*project_snapshot/);
  assert.match(migration, /quotation_id uuid not null unique references public\.quotations\(id\) on delete restrict/);
  assert.match(migration, /order_no text not null unique/);
  assert.doesNotMatch(migration, /alter table public\.(projects|quotations|quotation_items|quotation_sections|clients)\b/);
  assert.doesNotMatch(migration, /(update|delete from|insert into) public\.(projects|quotations|quotation_items|quotation_sections|clients)\b/);
});

test("the migration: fixed search path, and grants to authenticated only for the three app functions", () => {
  const functions = [...migration.matchAll(/create function public\.(\w+)\([^)]*\) returns [^$]*?\$\$/g)];
  assert.equal(functions.length, 8);
  for (const [text, name] of functions) assert.ok(text.includes("set search_path=''"), name);
  for (const name of ["project_snapshot_copy", "create_project_snapshot", "backfill_project_snapshots"]) {
    assert.ok(functions.find(([, found]) => found === name)?.[0].includes("security definer"), name);
  }
  assert.deepEqual([...migration.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to authenticated;/g)].map((match) => match[1]).sort(), ["backfill_project_snapshots", "create_project_snapshot", "project_snapshot_state"]);
  for (const name of ["project_snapshot_copy", "project_snapshot_valid_file", "project_snapshot_item_grands", "project_snapshot_total_matches"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
  }
  assert.match(migration, /public\.current_user_role\(\)::text <> 'system_owner' then raise insufficient_privilege/);
  assert.ok(migration.includes("for update;"), "the quotation row is locked");
  assert.ok(migration.includes("batch_limit constant integer := 50"));
});

// ---- The migration run in an in-memory test database (never the live one) ----

const db = new PGlite();
const ids = { owner: "00000000-0000-4000-8000-000000000001", designer: "00000000-0000-4000-8000-000000000002", viewer: "00000000-0000-4000-8000-000000000003", procurement: "00000000-0000-4000-8000-000000000004", client: "00000000-0000-4000-8000-0000000000c1", project: "00000000-0000-4000-8000-0000000000f1" };
const quote = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const projectFile = (id: string, orderNo: string, total: number) => ({ orderNo, quotationId: id, quotationNo: `Q-${orderNo}`, clientId: ids.client, clientName: "Client", reference: "Office", total, currency: "AED", createdAt: "2026-11-04", createdBy: ids.owner, status: "Confirmed" });

async function addQuotation(n: number, options: { file?: unknown; rule?: string; grand?: number; vat?: number; net?: number; layout?: object; isActive?: boolean } = {}) {
  const id = quote(n), net = options.net ?? 1399, grand = options.grand ?? 1468.95, vat = options.vat ?? 69.95;
  const layout = { ...(options.file === undefined ? {} : { projectFile: options.file }), ...(options.rule ? { pricing_rule: options.rule } : {}), ...options.layout };
  await db.query("insert into public.quotations(id,client_id,project_id,quotation_no,title,subtotal,discount_total,vat_amount,grand_total,layout_settings,is_active) values($1,$2,$3,$4,'T',1554,155,$5,$6,$7,$8)",
    [id, ids.client, ids.project, `Q-${n}`, vat, grand, JSON.stringify(layout), options.isActive ?? true]);
  await db.query("insert into public.quotation_sections(id,quotation_id,section_title) values($1,$2,'Main')", [`20000000-0000-4000-8000-${String(n).padStart(12, "0")}`, id]);
  await db.query("insert into public.quotation_items(id,quotation_id,section_id,qty,unit_price,net_price,net_total,internal_cost) values($1,$2,$3,1,1554,$4,$4,700)", [`30000000-0000-4000-8000-${String(n).padStart(12, "0")}`, id, `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`, net]);
  await db.query("insert into public.quotation_items(id,quotation_id,qty,unit_price,net_price,net_total,is_active) values($1,$2,1,9,9,9,false)", [`40000000-0000-4000-8000-${String(n).padStart(12, "0")}`, id]);
  return id;
}
async function asUser<T>(user: string | null, run: () => Promise<T>) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  try { return await run(); } finally { await db.exec("reset role;"); }
}
const rpc = async (user: string, sql: string, params: unknown[] = []) => asUser(user, async () => (await db.query<{ r: Record<string, unknown> }>(`select ${sql} as r`, params)).rows[0].r);
const create = (user: string, id: string) => rpc(user, "public.create_project_snapshot($1)", [id]);
const backfill = (user = ids.owner) => rpc(user, "public.backfill_project_snapshots()") as Promise<Record<string, unknown> & { created: number; remaining: number; failed: unknown[]; differences: Array<{ order_no: string }>; skipped_other_quotations_project_file: unknown[]; skipped_confirmed_order_only: unknown[] }>;

const schema = `
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create type public.user_role as enum ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer');
    create table public.profiles(id uuid primary key, role public.user_role, account_status text);
    create function public.current_user_role() returns public.user_role language sql stable security definer set search_path=public as $$ select role from public.profiles where id = auth.uid() $$;
    create function public.current_user_is_active() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select account_status='active' from public.profiles where id = auth.uid()), false) $$;
    create table public.clients(id uuid primary key, company_name text, client_number text, contact_person text, email text, phone text, address text, city text, country text, trn text);
    create table public.projects(id uuid primary key, project_name text, location text, attention_to text, attention_mobile text, attention_landline text, attention_email text, po_box text, project_address text);
    create table public.quotations(id uuid primary key, client_id uuid not null, project_id uuid, quotation_no text, revision_no int not null default 0, option_no int default 1, title text, quotation_date date default current_date, status text default 'client_confirmed',
      currency text not null default 'AED', vat_percent numeric(5,2) not null default 5, subtotal numeric(14,2) not null default 0, discount_total numeric(14,2) not null default 0, vat_amount numeric(14,2) not null default 0, grand_total numeric(14,2) not null default 0,
      overall_discount_type text not null default 'amount', overall_discount_value numeric(14,2) not null default 0, payment_terms text, validity text, delivery_terms text, warranty_terms text, notes text, legacy_reference text, layout_mode text default 'standard_proposal',
      layout_settings jsonb not null default '{}', is_active boolean not null default true, created_at timestamptz not null default now());
    create table public.quotation_sections(id uuid primary key, quotation_id uuid not null references public.quotations(id) on delete cascade, section_title text, section_notes text, parent_section_id uuid, section_kind text default 'sub', section_type text default 'section', sort_order int default 0, is_active boolean not null default true);
    create table public.quotation_items(id uuid primary key, quotation_id uuid not null references public.quotations(id) on delete cascade, section_id uuid, parent_item_id uuid, source_template_id uuid, sort_order int default 0, item_type text not null default 'product', line_style text not null default 'normal',
      is_rate_only boolean not null default false, is_optional boolean not null default false, include_in_total boolean not null default true, manual_serial text, item_code_snapshot text, item_name_snapshot text, brand_name_snapshot text, category_name_snapshot text, supplier_name_snapshot text, supplier_notes_snapshot text,
      model_snapshot text, finish_snapshot text, size_snapshot text, origin_snapshot text, specification_snapshot text, specified_image_url_snapshot text, proposed_image_url_snapshot text, qty numeric(12,2) not null default 1, unit_label text default 'Pc', unit_price numeric(14,2) not null default 0, discount_type text default 'amount', discount_value numeric(14,2) not null default 0,
      net_price numeric(14,2) not null default 0, net_total numeric(14,2) not null default 0, currency text default 'AED', source_component_data jsonb, cell_layout jsonb default '{}', internal_cost numeric(14,2) default 0, is_active boolean not null default true);
    create table public.audit_activity_log(id uuid primary key default gen_random_uuid(), entity_type text, entity_id uuid, action text, title text, description text, metadata jsonb, created_by uuid);
    grant select on public.quotations to authenticated;
    alter table public.quotations enable row level security;
    create policy visible on public.quotations for select to authenticated using (public.current_user_is_active() and (is_active or public.current_user_role() = 'system_owner'));
`;
before(async () => {
  await db.exec(schema);
  await db.query("insert into public.profiles values($1,'system_owner','active'),($2,'designer','active'),($3,'viewer','active'),($4,'procurement_manager','active')", [ids.owner, ids.designer, ids.viewer, ids.procurement]);
  await db.query("insert into public.clients(id,company_name,contact_person,address) values($1,'Client','Sara','Dubai')", [ids.client]);
  await db.query("insert into public.projects(id,project_name,attention_to) values($1,'Office','Ali')", [ids.project]);
  await db.exec(migration);
});
after(async () => { await db.close(); });

test("the parser and the database agree on what a valid Project File is", async () => {
  const file = projectFile(quote(1), "OR-1", 10);
  for (const value of [file, null, "x", [], {}, { orderNo: "OR" }, { ...file, total: "10" }, { ...file, reference: "   " }, { ...file, clientName: null }, { ...file, createdBy: 5 }]) {
    const { rows } = await db.query<{ r: unknown }>("select public.project_snapshot_valid_file($1) as r", [JSON.stringify({ projectFile: value })]);
    assert.equal(rows[0].r !== null, projectFileRecordValue(value) !== null, JSON.stringify(value));
  }
});

test("create: copies header, active rows and the full original row; a second call returns the same id", async () => {
  const id = await addQuotation(1, { rule: "whole_aed_v1" });
  await db.query("update public.quotations set layout_settings = layout_settings || $2 where id = $1", [id, JSON.stringify({ projectFile: projectFile(id, "OR-1", 1468.95) })]);
  const first = await create(ids.designer, id);
  assert.equal(first.created, true);
  assert.deepEqual(await create(ids.designer, id), { id: first.id, created: false });
  const { rows } = await db.query<Record<string, unknown>>("select * from public.project_snapshots where quotation_id = $1", [id]);
  const header = rows[0];
  assert.equal(header.order_no, "OR-1"); assert.equal(header.pricing_rule, "whole_aed_v1"); assert.equal(header.source_method, "created_with_project_file");
  assert.equal(Number(header.contract_total), 1468.95); assert.equal(Number(header.net_total), 1399); assert.equal(header.client_contact_person, "Sara"); assert.equal(header.attention_to, "Ali"); assert.equal(header.created_by, ids.designer);
  const items = await db.query<{ net_total: string; data: { internal_cost: number; id: string }; original_section_id: string }>("select * from public.project_snapshot_items where snapshot_id = $1", [first.id]);
  assert.equal(items.rows.length, 1, "the inactive item is not copied");
  assert.equal(items.rows[0].data.id, `30000000-0000-4000-8000-${String(1).padStart(12, "0")}`);
  assert.equal(items.rows[0].data.internal_cost, 700, "columns without a typed copy are kept in data");
  assert.equal((await db.query("select 1 from public.project_snapshot_sections where snapshot_id = $1", [first.id])).rows.length, 1);
  assert.equal((await db.query("select 1 from public.audit_activity_log where entity_id = $1 and action = 'project_snapshot_created'", [id])).rows.length, 1);
});

test("rows are immutable, even for the database owner; the source quotation cannot be deleted", async () => {
  const id = quote(1);
  await assert.rejects(db.query("update public.project_snapshots set order_no = 'X' where quotation_id = $1", [id]), /history/);
  await assert.rejects(db.query("delete from public.project_snapshot_items"), /history/);
  await assert.rejects(db.query("delete from public.project_snapshot_sections"), /history/);
  await assert.rejects(db.exec("truncate public.project_snapshot_items"), /history/);
  await assert.rejects(db.query("delete from public.quotations where id = $1", [id]), /foreign key/);
});

test("users cannot write directly, and read follows the source quotation", async () => {
  await asUser(ids.owner, async () => {
    await assert.rejects(db.query("update public.project_snapshots set order_no = 'X'"), /permission denied/);
    await assert.rejects(db.query("insert into public.project_snapshot_items(snapshot_id) values(gen_random_uuid())"), /permission denied/);
    await assert.rejects(db.query("select public.project_snapshot_copy($1, 'created_with_project_file')", [quote(1)]), /permission denied/);
  });
  const hidden = await addQuotation(2, { file: projectFile(quote(2), "OR-2", 1468.95), rule: "whole_aed_v1", isActive: false });
  await create(ids.owner, hidden);
  const count = async (user: string) => asUser(user, async () => (await db.query("select 1 from public.project_snapshots")).rows.length);
  assert.equal(await count(ids.viewer), 1, "only the active quotation");
  assert.equal(await count(ids.owner), 2);
  assert.equal(await asUser(ids.viewer, async () => (await db.query("select 1 from public.project_snapshot_items")).rows.length), 1);
  const state = await rpc(ids.viewer, "public.project_snapshot_state($1)", [[quote(1), hidden, quote(99)]]) as unknown as Array<{ quotation_id: string; has_snapshot: boolean }>;
  assert.deepEqual(state.map((row) => row.has_snapshot), [true, false, false], "a quotation the user cannot read shows no snapshot");
  await assert.rejects(rpc(ids.viewer, "public.project_snapshot_state($1)", [[]]), /between 1 and 50/);
  await assert.rejects(rpc(ids.viewer, "public.project_snapshot_state($1)", [Array.from({ length: 51 }, (_, i) => quote(i))]), /between 1 and 50/);
});

test("create is refused for the wrong role, no valid Project File, another quotation's Project File, and totals that do not add up", async () => {
  const good = await addQuotation(3, { file: projectFile(quote(3), "OR-3", 1468.95), rule: "whole_aed_v1" });
  await assert.rejects(create(ids.viewer, good), /insufficient_privilege/);
  await assert.rejects(create(ids.procurement, good), /insufficient_privilege/);
  await assert.rejects(asUser(null, async () => db.query("select public.create_project_snapshot($1)", [good])), /insufficient_privilege/);
  await assert.rejects(create(ids.designer, await addQuotation(4, { file: { orderNo: "half" } })), /no valid Project File/);
  await assert.rejects(create(ids.designer, await addQuotation(5, { file: projectFile(quote(3), "OR-3", 1468.95) })), /belongs to another quotation/);
  const stale = await addQuotation(6, { file: projectFile(quote(6), "OR-6", 1468.95), rule: "whole_aed_v1", net: 1500 });
  await assert.rejects(create(ids.designer, stale), /do not add up/);
  assert.equal((await db.query("select 1 from public.project_snapshots where quotation_id = $1", [stale])).rows.length, 0, "nothing is left behind");
  assert.equal((await db.query("select 1 from public.audit_activity_log where entity_id = $1", [stale])).rows.length, 0);
});

test("legacy: both ways of calculating a stored total are accepted at creation", async () => {
  assert.equal((await create(ids.designer, await addQuotation(7, { file: projectFile(quote(7), "OR-7", 1470), rule: undefined, net: 1399.5, grand: 1470, vat: 70 }))).created, true); // shared builder
  assert.equal((await create(ids.designer, await addQuotation(8, { file: projectFile(quote(8), "OR-8", 1470), net: 1399.5, grand: 1469.47, vat: 69.97 }))).created, true); // local builder
});

test("backfill: System Owner only, reports and skips, keeps going past a failure, 50 at a time, safe to run twice", async () => {
  await assert.rejects(backfill(ids.designer), /insufficient_privilege/);
  const first = await backfill();
  assert.equal(first.created, 2, "quotation 3 and stale quotation 6");
  assert.deepEqual(first.differences.map((row) => row.order_no), ["OR-6"]);
  assert.equal(first.skipped_other_quotations_project_file.length, 1);
  assert.equal(first.remaining, 0);
  const again = await backfill();
  assert.equal(again.created, 0);
  assert.equal(again.total_snapshots, first.total_snapshots);
  assert.deepEqual(again.differences.map((row) => row.order_no), ["OR-6"], "the list stays complete");
  assert.equal((await db.query<{ source_method: string }>("select source_method from public.project_snapshots where quotation_id = $1", [quote(6)])).rows[0].source_method, "backfilled_from_live_quotation");

  await addQuotation(9, { layout: { clientApprovalDraft: { confirmedOrder: { orderNo: "OR-OLD" } } } });
  assert.equal((await backfill()).skipped_confirmed_order_only.length, 1);

  await addQuotation(10, { file: projectFile(quote(10), "OR-1", 1468.95), rule: "whole_aed_v1" }); // the same order number as quotation 1
  for (let n = 100; n < 155; n++) await addQuotation(n, { file: projectFile(quote(n), `OR-${n}`, 1468.95), rule: "whole_aed_v1" });
  const batch = await backfill();
  assert.equal(batch.created, 50);
  assert.equal(batch.failed.length, 1);
  assert.match(JSON.stringify(batch.failed), /OR-1/);
  assert.equal(batch.remaining, 6);
  const last = await backfill();
  assert.equal(last.created, 5);
  assert.equal(last.remaining, 1, "only the duplicate is left, and it stays listed as failed");
});

test("the TEST file runs, saves nothing and creates no snapshot; the APPLY file is the migration", async () => {
  const fresh = new PGlite();
  await fresh.exec(schema);
  const results = await fresh.exec(readFileSync("supabase/tests/project_snapshots_TEST.sql", "utf8"));
  assert.ok(results.some((result) => result.fields.some((field) => field.name === "projects_to_copy")));
  assert.equal((await fresh.query("select to_regclass('public.project_snapshots') as t")).rows[0] && (await fresh.query<{ t: string | null }>("select to_regclass('public.project_snapshots') as t")).rows[0].t, null);
  await fresh.close();
  assert.ok(readFileSync("supabase/tests/project_snapshots.sql", "utf8").replace(/\r\n/g, "\n").endsWith(migration));
});
