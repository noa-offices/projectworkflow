import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supplierApplyReviewedPrice, supplierBrandTargets, supplierCompleteReview, supplierCompletionReadiness, supplierConfirmUnchangedPrice, supplierExcludeTargetFromSource } from "./supplier-price-repository.js";
import type { PriceMatch, PriceTarget, SourceIdentity } from "./supplier-price-contracts.js";
import { latestBrandPriceListUpdate, productTemplatePriceCheckState, type BrandPriceListUpdateForCheck } from "../product-price-check.js";

const migrations = await Promise.all([
  "20261002060146_pricing_identity_version_foundation", "20261002082357_supplier_price_source_review", "20261002124625_supplier_source_finish_evidence",
  "20261004090000_supplier_confirmed_unchanged_decision", "20261004120000_supplier_review_completion",
  "20261005090000_supplier_source_definitions", "20261005120000_supplier_batch_coverage_snapshot", "20261005150000_supplier_coverage_completion_mode",
].map((name) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8")));
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = id(1), brand = id(2), source = id(3), batch = id(4), linked = id(5), component = id(6);
const t1 = id(11), t2 = id(12), t3 = id(13), t4 = id(14);
const changedAfter = /Product prices changed after Supplier review\. Build a fresh comparison before completing this price list\./;

// PostgREST-shaped test transport over real PostgreSQL: every read, decision write and RPC runs in the database.
function pgClient(db: PGlite) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []; let order: string | null = null, start = 0, end = 999;
      const execute = async () => {
        let rows: Record<string, unknown>[];
        if (table === "product_components") {
          const brandFilter = filters.find(([key]) => key === "product_templates.brand_id");
          rows = (await db.query<Record<string, unknown>>("select c.* from product_components c join product_templates t on t.id=c.template_id where t.brand_id=$1 and c.is_active order by c.id", [brandFilter?.[1]])).rows;
        } else {
          const where = filters.map(([key], index) => `"${key}"=$${index + 1}`).join(" and ");
          rows = (await db.query<Record<string, unknown>>(`select * from public.${table}${where ? ` where ${where}` : ""}${order ? ` order by "${order}"` : ""} limit ${end - start + 1} offset ${start}`, filters.map(([, value]) => value))).rows;
        }
        return rows.map((row) => {
          const copy = { ...row };
          for (const field of ["default_unit_price", "unit_price"]) if (typeof copy[field] === "string") copy[field] = Number(copy[field]);
          if (table === "product_templates" && copy.pricing_version !== undefined) copy.pricing_version = String(copy.pricing_version);
          return copy;
        });
      };
      return { select() { return this; }, eq(key: string, value: unknown) { filters.push([key, value]); return this; }, order(column: string) { order = column; return this; }, range(from: number, to: number) { start = from; end = to; return this; },
        async single() { const rows = await execute(); return { data: rows.length === 1 ? rows[0] : null, error: rows.length === 1 ? null : { message: "Record unavailable" } }; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then((data) => resolve({ data, error: null }), reject); } };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      try {
        const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((_, index) => `$${index + 1}`).join(",")}) as result`, keys.map((key) => typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key]));
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
    },
  } as unknown as SupabaseClient;
}

type Options = { scope?: string; link?: boolean; sourceStatus?: string; sourceBasis?: string; coverage?: string[] | null };
async function fixture({ scope = "complete", link = true, sourceStatus = "imported", sourceBasis = "list", coverage = null }: Options = {}) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as 'select ''${user}''::uuid';
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
    create table public.permissions(can_review boolean,can_approve boolean); insert into public.permissions values(true,true);
    create function public.current_user_is_active() returns boolean language sql as 'select true';
    create function public.current_user_can_review_brand_prices() returns boolean language sql as 'select can_review from public.permissions';
    create function public.current_user_can_approve_brand_prices() returns boolean language sql as 'select can_approve from public.permissions';
    create table public.profiles(id uuid primary key); insert into public.profiles values('${user}'),('${id(9)}');
    create table public.brands(id uuid primary key,last_price_list_checked_at timestamptz); insert into public.brands values('${brand}','2025-06-01');
    create table public.brand_price_list_updates(id uuid primary key default gen_random_uuid(),brand_id uuid not null,title text not null,reference_no text,currency text,effective_from date,received_at date,
      status text not null default 'draft' check(status in ('draft','active','archived')),notes text,attachment_url text,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.product_templates(id uuid primary key,brand_id uuid,template_name text,item_code text,description text,default_image_url text,price_notes text,
      last_price_checked_at timestamptz,last_price_checked_by uuid,price_check_note text,created_at timestamptz default '2025-01-01',is_active boolean default true,
      default_unit_price numeric default 100,currency text default 'EUR',variant_pricing jsonb default '[]',category_pricing jsonb default '[]',desking_size_pricing jsonb default '[]',accessory_pricing jsonb default '[]');
    create table public.product_components(id uuid primary key,template_id uuid not null references public.product_templates(id),option_type text,component_group text,component_code text,component_name text,description text,
      qty numeric,unit_label text,unit_price numeric,currency text,is_optional boolean,is_default_selected boolean,sort_order int,is_active boolean,price_notes text,calculation_data jsonb,created_by uuid);
    create table public.product_template_price_history(id uuid default gen_random_uuid());
    create table public.product_template_detail_price_history(id uuid default gen_random_uuid());
    create table public.quotations(id uuid primary key,total numeric); insert into public.quotations values('${user}',500);`);
  for (const sql of migrations) await db.exec(sql);
  await db.exec(`update public.brands set stored_price_basis='list';
    insert into public.brand_price_list_updates(id,brand_id,title,status,coverage_mode,created_at) values('${linked}','${brand}','Linked draft','draft','complete','2026-01-10');
    insert into public.product_templates(id,brand_id,template_name,item_code,default_unit_price,last_price_checked_at,last_price_checked_by) values
      ('${t1}','${brand}','Changed','CHG',100,null,null),('${t2}','${brand}','Unchanged','UNC',50,null,null),
      ('${t3}','${brand}','Missing','MISS',70,'2026-01-02','${id(9)}'),('${t4}','${brand}','Mixed','T4A',30,'2026-01-02','${id(9)}');
    insert into public.product_components values('${component}','${t4}','other','Options','T4C','Component',null,1,'Pc',9,'EUR',true,false,0,true,null,'{}',null);`);
  const client = pgClient(db);
  const { targets } = await supplierBrandTargets(client, brand);
  const target = (code: string) => { const found = targets.find((item) => item.code === code); assert.ok(found, code); return found; };
  const identity = (code: string, price: number): SourceIdentity => ({ key: `id-${code}`, code, price_field: "unit_price", dimension: "", finishes: [], price, currency: "EUR", row_keys: [], issues: [] });
  const identities = [identity("CHG", 110), identity("UNC", 50), identity("T4A", 30), identity("ZZZ", 5)];
  const match = (key: string, classification: PriceMatch["classification"], sourceIdentity: SourceIdentity | null, matchTargets: PriceTarget[]): PriceMatch =>
    ({ key, source: sourceIdentity, targets: matchTargets, classification, comparison: null, candidate_shared: false });
  const matches = [
    match("m-chg", "increased", identities[0], [target("CHG")]), match("m-unc", "unchanged", identities[1], [target("UNC")]),
    match("m-t4a", "unchanged", identities[2], [target("T4A")]), match("m-miss", "target_not_represented", null, [target("MISS")]),
    match("m-t4c", "target_not_represented", null, [target("T4C")]), match("m-zzz", "unmatched", identities[3], []),
    match("m-comp", "referenced_companion", null, []),
  ];
  await db.query(`insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,effective_from,received_at,expected_rows,expected_cells,expected_chunks,created_by)
    values($1,$2,'LAS 2026 list','s.csv',$3,'csv','EUR',$4,'{}',$5,'2026-01-15','2026-01-12',1,1,1,$6)`, [source, brand, "a".repeat(64), sourceBasis, sourceStatus, user]);
  for (const item of identities) await db.query("insert into public.supplier_source_identities values($1,$2,$3,$4)", [source, item.key, item.code, JSON.stringify(item)]);
  await db.query(`insert into public.supplier_price_batches(id,brand_id,source_id,brand_price_list_update_id,title,scope,selected_template_ids,status,expected_matches,expected_chunks,basis_warning,created_by,coverage_template_ids)
    values($1,$2,$3,$4,'Review',$5,$6,'review',$7,1,'',$8,$9)`, [batch, brand, source, link ? linked : null, scope, scope === "selected_templates" ? [t1] : [], matches.length, user, coverage]);
  for (const item of matches) await db.query("insert into public.supplier_price_matches values($1,$2,$3,$4,null,$5,$6)", [batch, item.key, item.source?.code ?? item.targets[0]?.code ?? item.key, item.classification, [...new Set(item.targets.map((entry) => entry.template_id))], JSON.stringify(item)]);
  const decide = (key: string, decision: string, note = "reason") => db.query("insert into public.supplier_price_decisions(batch_id,key,decision,note,reviewed_by) values($1,$2,$3,$4,$5) on conflict(batch_id,key) do update set decision=excluded.decision,note=excluded.note", [batch, key, decision, note, user]);
  // Phase 2A Apply outcome (live now equals Supplier) plus durable decisions for a ready Complete review.
  await decide("m-chg", "reviewed"); await db.query("update public.product_templates set default_unit_price=110 where id=$1", [t1]);
  await decide("m-unc", "confirmed_unchanged"); await decide("m-t4a", "confirmed_unchanged");
  await decide("m-miss", "excluded_from_source", "Not in this supplier edition"); await decide("m-t4c", "excluded_from_source", "Component priced separately");
  const state = async () => ({
    templates: (await db.query<{ id: string; price: string; currency: string; version: string; last_price_checked_at: Date | null; last_price_checked_by: string | null; price_check_note: string | null }>("select id,default_unit_price::text price,currency,pricing_version::text version,last_price_checked_at,last_price_checked_by,price_check_note from public.product_templates order by id")).rows,
    components: (await db.query("select * from public.product_components")).rows,
    updates: (await db.query("select id,status,coverage_mode,effective_from::text,title from public.brand_price_list_updates order by created_at")).rows,
    brands: (await db.query("select * from public.brands")).rows,
    batch: (await db.query<{ status: string; completed_at: Date | null; brand_price_list_update_id: string | null }>("select status,completed_at,brand_price_list_update_id from public.supplier_price_batches")).rows,
    history: (await db.query("select (select count(*) from public.product_template_price_history)::int + (select count(*) from public.product_template_detail_price_history)::int n")).rows,
    quotations: (await db.query("select * from public.quotations")).rows,
    sourceRows: (await db.query("select status from public.supplier_source_versions")).rows,
  });
  const rawComplete = async (versions?: Record<string, string>) => {
    const result = await client.rpc("complete_supplier_price_review", { p_batch_id: batch, p_template_versions: versions ?? (await supplierCompletionReadiness(client, batch)).templateVersions });
    if (result.error) throw Error(result.error.message); return result.data;
  };
  return { db, client, decide, state, rawComplete, complete: () => supplierCompleteReview(client, batch), readiness: () => supplierCompletionReadiness(client, batch) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

test("excluded_from_source is approver-only, needs a reason, and applies only to targets missing from the source", async () => {
  const f = await fixture();
  try {
    const write = (key: string, note: string) => f.client.rpc("supplier_price_review_write", { p_operation: "decision", p_payload: { batch_id: batch, key, decision: "excluded_from_source", note, proposed_target_keys: [] } });
    await f.decide("m-miss", "skip");
    await assert.rejects(supplierExcludeTargetFromSource(f.client, batch, "m-miss", "   "), /reason is required/);
    assert.match((await write("m-miss", " ")).error?.message ?? "", /reason is required/);
    for (const key of ["m-unc", "m-chg", "m-zzz", "m-comp"]) {
      await assert.rejects(supplierExcludeTargetFromSource(f.client, batch, key, "why"), /Only a target missing/);
      assert.match((await write(key, "why")).error?.message ?? "", /Only a target missing/);
    }
    await f.db.exec("update public.permissions set can_approve=false");
    assert.match((await write("m-miss", "why")).error?.message ?? "", /insufficient_privilege|permission denied/);
    await f.db.exec("update public.permissions set can_approve=true");
    const before = await f.state();
    assert.match((await supplierExcludeTargetFromSource(f.client, batch, "m-miss", "  Discontinued by supplier?  ")).message, /remain Needs price check/);
    assert.deepEqual((await f.db.query("select decision,note from public.supplier_price_decisions where key='m-miss'")).rows, [{ decision: "excluded_from_source", note: "Discontinued by supplier?" }]);
    assert.deepEqual(await f.state(), before); // No Product, Brand, history or quotation write.
  } finally { await f.db.close(); }
});

const blockers: Array<[string, (f: Fixture) => Promise<unknown>, string, RegExp]> = [
  ["skip blocks", (f) => f.decide("m-unc", "skip"), "skipped", /is skip/],
  ["reject blocks", (f) => f.decide("m-chg", "reject"), "rejected", /is reject/],
  ["mapping_proposed blocks", (f) => f.decide("m-t4a", "mapping_proposed"), "mapping_proposed", /is mapping_proposed/],
  ["target_not_represented without exclusion blocks", (f) => f.db.query("delete from public.supplier_price_decisions where key='m-miss'"), "target_not_represented", /not represented/],
  ["skip on a missing target blocks", (f) => f.decide("m-miss", "skip"), "skipped", /is skip/],
  ["unchanged only reviewed blocks", (f) => f.decide("m-unc", "reviewed"), "unchanged_not_confirmed", /must be confirmed unchanged/],
  ["changed row not applied blocks", (f) => f.db.query("update public.product_templates set default_unit_price=100 where id=$1", [t1]), "unresolved_changed", changedAfter],
  ["unresolved shared blocks", async (f) => { await f.db.exec("update public.supplier_price_matches set classification='shared', data=jsonb_set(data,'{classification}','\"shared\"') where key='m-chg'"); await f.db.query("update public.product_templates set default_unit_price=100 where id=$1", [t1]); }, "unresolved_shared", changedAfter],
  ["confirmed unchanged drift blocks", (f) => f.db.query("update public.product_templates set default_unit_price=51 where id=$1", [t2]), "changed_after_review", changedAfter],
  ...(["ambiguous", "needs_dimension_mapping", "baseline_drift", "invalid_source"] as const).map((classification): [string, (f: Fixture) => Promise<unknown>, string, RegExp] =>
    [`${classification} blocks`, (f) => f.db.exec(`update public.supplier_price_matches set classification='${classification}', data=jsonb_set(data,'{classification}','"${classification}"') where key='m-chg'`), classification, /unresolved/]),
];
for (const [name, change, count, rpcError] of blockers) test(`Complete review: ${name} (preview, action and RPC all refuse)`, async () => {
  const f = await fixture();
  try {
    const versions = (await f.readiness()).templateVersions;
    await change(f);
    const readiness = await f.readiness();
    assert.equal(readiness.ready, false); assert.ok(readiness.counts[count as keyof typeof readiness.counts] > 0, count);
    const before = await f.state();
    await assert.rejects(f.complete(), /unresolved rows/);
    await assert.rejects(f.rawComplete(versions), rpcError);
    assert.deepEqual(await f.state(), before);
  } finally { await f.db.close(); }
});

test("Complete review refuses scope, status, basis, permission, new targets and stale versions without writing", async () => {
  const cases: Array<[string, Options, ((f: Fixture) => Promise<unknown>) | null, RegExp, RegExp]> = [
    ["partial scope", { scope: "partial" }, null, /coverage is not Complete/, /Only a Complete coverage review/],
    ["selected_templates scope", { scope: "selected_templates" }, null, /coverage is not Complete/, /Only a Complete coverage review/],
    ["source not imported", { sourceStatus: "archived" }, null, /must be imported/, /must be imported/],
    ["source basis unknown", { sourceBasis: "unknown" }, null, /basis must be confirmed/, /basis must be confirmed/],
    ["Brand basis unknown", {}, (f) => f.db.exec("update public.brands set stored_price_basis='unknown'"), /basis must be confirmed/, /basis must be confirmed/],
    ["basis mismatch", { sourceBasis: "net" }, null, /does not match/, /does not match the Brand/],
    ["batch not review", {}, (f) => f.db.exec("update public.supplier_price_batches set status='archived'"), /must be in review/, /must be in review/],
    ["non-approver", {}, (f) => f.db.exec("update public.permissions set can_approve=false"), /insufficient_privilege|permission denied/, /insufficient_privilege|permission denied/],
  ];
  for (const [name, options, change, actionError, rpcError] of cases) {
    const f = await fixture(options);
    try {
      const versions = (await f.readiness()).templateVersions;
      if (change) await change(f);
      const before = await f.state();
      await assert.rejects(f.complete(), actionError, name);
      await assert.rejects(f.rawComplete(versions), rpcError, name);
      assert.deepEqual(await f.state(), before, name);
    } finally { await f.db.close(); }
  }
  const f = await fixture();
  try {
    const versions = (await f.readiness()).templateVersions;
    await f.db.exec(`insert into public.product_templates(id,brand_id,template_name,item_code) values('${id(20)}','${brand}','Added later','NEW')`);
    assert.equal((await f.readiness()).counts.targets_added_after_comparison, 1);
    await assert.rejects(f.complete(), /unresolved rows/);
    await f.db.exec(`delete from public.product_templates where id='${id(20)}'`);
    await f.db.query("update public.product_templates set item_code='CHG' where id=$1", [t1]); // metadata-only noise keeps the version
    await assert.doesNotReject(async () => assert.equal((await f.readiness()).ready, true));
    await f.db.query("update public.product_templates set default_unit_price=111 where id=$1", [t2]);
    await f.db.query("update public.product_templates set default_unit_price=50 where id=$1", [t2]); // same price, newer version
    await assert.rejects(f.rawComplete(versions), changedAfter);
  } finally { await f.db.close(); }
});

test("valid Complete review activates the linked baseline, checks only fully covered Templates, and is terminal", async () => {
  const f = await fixture();
  try {
    const readiness = await f.readiness();
    assert.equal(readiness.ready, true);
    assert.deepEqual({ resolved: readiness.counts.resolved, excluded: readiness.counts.excluded_from_source, unmatched: readiness.counts.unmatched, companion: readiness.counts.referenced_companion, checked: readiness.checkedTemplates, left: readiness.excludedTemplates }, { resolved: 3, excluded: 2, unmatched: 1, companion: 1, checked: 2, left: 2 });
    const before = await f.state();
    const result = await f.complete();
    assert.deepEqual(result, { price_list_update_id: linked, title: "Linked draft", baseline_date: "2026-01-15", checked_templates: 2, excluded_templates: 2, message: "Supplier price-list review completed and Brand baseline activated." });
    const after = await f.state();
    assert.deepEqual(after.updates, [{ id: linked, status: "active", coverage_mode: "complete", effective_from: "2026-01-15", title: "Linked draft" }]);
    const byId = new Map(after.templates.map((row) => [row.id as string, row]));
    for (const template of [t1, t2]) { assert.ok(byId.get(template)!.last_price_checked_at instanceof Date); assert.equal(byId.get(template)!.last_price_checked_by, user); }
    for (const template of [t3, t4]) assert.deepEqual(byId.get(template), before.templates.find((row) => row.id === template));
    assert.deepEqual(after.templates.map(({ id: key, price, currency, version, price_check_note }) => ({ key, price, currency, version, price_check_note })),
      before.templates.map(({ id: key, price, currency, version, price_check_note }) => ({ key, price, currency, version, price_check_note })));
    for (const field of ["components", "brands", "history", "quotations", "sourceRows"] as const) assert.deepEqual(after[field], before[field], field);
    assert.equal(after.batch[0].status, "completed"); assert.ok(after.batch[0].completed_at instanceof Date);
    // Existing helpers: the activated complete update is the baseline; covered Templates are checked, excluded ones need a check.
    const updates = (await f.db.query<BrandPriceListUpdateForCheck>("select coverage_mode,title,effective_from::text,received_at::text,created_at::text,status from public.brand_price_list_updates")).rows;
    const latest = latestBrandPriceListUpdate(updates);
    assert.equal(latest?.title, "Linked draft");
    const checkState = (template: string) => productTemplatePriceCheckState({ latestBrandPriceListUpdate: latest, formatDate: String, brandPriceBaselineAt: "2025-06-01",
      template: { created_at: "2025-01-01", price_check_interval_days: 3650, last_price_checked_at: (byId.get(template)!.last_price_checked_at as Date | null)?.toISOString() ?? null } }).key;
    assert.deepEqual([t1, t2, t3, t4].map(checkState), ["checked", "checked", "needs_check", "needs_check"]);
    // Terminal: no repeat completion, Apply, Confirm or Exclude.
    await assert.rejects(f.complete(), /already completed/); await assert.rejects(f.rawComplete({}), /already completed/);
    await assert.rejects(supplierApplyReviewedPrice(f.client, batch, "m-chg"), /must be in review/);
    await assert.rejects(supplierConfirmUnchangedPrice(f.client, batch, "m-unc"), /must be in review/);
    await assert.rejects(supplierExcludeTargetFromSource(f.client, batch, "m-miss", "why"), /must be in review/);
    assert.match((await f.client.rpc("supplier_price_review_write", { p_operation: "decision", p_payload: { batch_id: batch, key: "m-unc", decision: "reviewed", note: "", proposed_target_keys: [] } })).error?.message ?? "", /not ready for review/);
    assert.deepEqual((await f.state()).templates, after.templates);
  } finally { await f.db.close(); }
});

test("without a linked update one active complete update is created and linked; any failure rolls everything back", async () => {
  const f = await fixture({ link: false });
  try {
    await f.db.exec("create function public.fail_batch() returns trigger language plpgsql as $$ begin raise exception 'batch write failed'; end $$; create trigger fail_batch before update on public.supplier_price_batches for each row execute function public.fail_batch();");
    const before = await f.state();
    await assert.rejects(f.complete(), /batch write failed/);
    assert.deepEqual(await f.state(), before);
    await f.db.exec("drop trigger fail_batch on public.supplier_price_batches");
    const result = await f.complete();
    assert.equal(result.title, "LAS 2026 list"); assert.equal(result.baseline_date, "2026-01-15");
    const created = (await f.db.query<{ id: string; status: string; coverage_mode: string; currency: string; received_at: string }>("select id,status,coverage_mode,currency,received_at::text from public.brand_price_list_updates where id<>$1", [linked])).rows;
    assert.deepEqual(created.map(({ status, coverage_mode, currency, received_at }) => ({ status, coverage_mode, currency, received_at })), [{ status: "active", coverage_mode: "complete", currency: "EUR", received_at: "2026-01-12" }]);
    assert.equal((await f.state()).batch[0].brand_price_list_update_id, created[0].id);
    assert.equal((await f.db.query<{ status: string }>("select status from public.brand_price_list_updates where id=$1", [linked])).rows[0].status, "draft");
  } finally { await f.db.close(); }
});

// ---- Phase 2I-3: completion means "complete for this source's coverage", never an automatic Brand-wide baseline ----
const t5 = id(15), covered = [t1, t2, t3, t4];
const addFamily = (f: Fixture, active = true) => f.db.exec(`insert into public.product_templates(id,brand_id,template_name,item_code,default_unit_price,is_active) values('${t5}','${brand}','LEAD','LD1',60,${active})`);
const modes = async (f: Fixture) => (await f.db.query<{ coverage_mode: string }>("select coverage_mode from public.brand_price_list_updates order by created_at")).rows.map((row) => row.coverage_mode);

for (const link of [true, false]) {
  test(`coverage that includes every active Family claims a complete baseline (${link ? "linked" : "created"} update)`, async () => {
    const f = await fixture({ link, coverage: covered });
    try { await f.complete(); assert.deepEqual((await modes(f)).slice(link ? 0 : -1), ["complete"]); } finally { await f.db.close(); }
  });
  test(`legacy NULL coverage still claims a complete baseline (${link ? "linked" : "created"} update)`, async () => {
    const f = await fixture({ link, coverage: null });
    try { await f.complete(); assert.deepEqual((await modes(f)).slice(link ? 0 : -1), ["complete"]); } finally { await f.db.close(); }
  });
  test(`LAS Furniture example: partial coverage completes as selected_templates and leaves the uncovered Family untouched (${link ? "linked" : "created"} update)`, async () => {
    const f = await fixture({ link, coverage: covered });
    try {
      await addFamily(f); // active, not covered: LEAD
      assert.equal((await f.readiness()).ready, true); assert.equal((await f.readiness()).counts.targets_added_after_comparison, 0);
      const before = await f.state(); const result = await f.complete(); const after = await f.state();
      assert.equal(result.checked_templates, 2);
      assert.deepEqual((await modes(f)).slice(link ? 0 : -1), ["selected_templates"]);
      const byId = new Map(after.templates.map((row) => [row.id as string, row]));
      for (const template of [t1, t2]) { assert.ok(byId.get(template)!.last_price_checked_at instanceof Date); assert.equal(byId.get(template)!.last_price_checked_by, user); }
      for (const template of [t3, t4, t5]) assert.deepEqual(byId.get(template), before.templates.find((row) => row.id === template)); // LEAD (t5) untouched
      assert.deepEqual(after.templates.map(({ id: key, price, currency, version }) => ({ key, price, currency, version })), before.templates.map(({ id: key, price, currency, version }) => ({ key, price, currency, version })));
      for (const field of ["components", "brands", "history", "quotations", "sourceRows"] as const) assert.deepEqual(after[field], before[field], field);
      assert.equal(after.batch[0].status, "completed");
      // The Brand-level baseline helper must not see a source covering only some Families as a Brand-wide baseline.
      const updates = (await f.db.query<BrandPriceListUpdateForCheck>("select coverage_mode,title,effective_from::text,received_at::text,created_at::text,status from public.brand_price_list_updates")).rows;
      assert.equal(latestBrandPriceListUpdate(updates), null);
    } finally { await f.db.close(); }
  });
}

test("a Family created after the batch was snapshotted prevents a Brand-wide claim, yet the covered Families are still checked", async () => {
  const f = await fixture({ coverage: covered });
  try {
    await addFamily(f);
    await f.complete();
    assert.deepEqual(await modes(f), ["selected_templates"]);
    const checked = (await f.db.query<{ id: string }>("select id from public.product_templates where last_price_checked_at > now() - interval '1 minute' and last_price_checked_by=$1 order by id", [user])).rows.map((row) => row.id);
    assert.deepEqual(checked, [t1, t2]);
  } finally { await f.db.close(); }
});

test("an inactive Family outside coverage does not prevent a complete claim", async () => {
  const f = await fixture({ coverage: covered });
  try { await addFamily(f, false); await f.complete(); assert.deepEqual(await modes(f), ["complete"]); } finally { await f.db.close(); }
});

test("coverage-filtered readiness is unchanged by completion semantics; legacy still sees the whole Brand", async () => {
  const scoped = await fixture({ coverage: covered }); const legacy = await fixture({ coverage: null });
  try {
    await addFamily(scoped); await addFamily(legacy);
    assert.deepEqual([(await scoped.readiness()).ready, (await scoped.readiness()).counts.targets_added_after_comparison], [true, 0]);
    assert.deepEqual([(await legacy.readiness()).ready, (await legacy.readiness()).counts.targets_added_after_comparison], [false, 1]);
  } finally { await scoped.db.close(); await legacy.db.close(); }
});

test("a failure during partial-coverage completion rolls everything back, including the update and its coverage_mode", async () => {
  const f = await fixture({ link: false, coverage: covered });
  try {
    await addFamily(f);
    await f.db.exec("create function public.fail_batch() returns trigger language plpgsql as $$ begin raise exception 'batch write failed'; end $$; create trigger fail_batch before update on public.supplier_price_batches for each row execute function public.fail_batch();");
    const before = await f.state();
    await assert.rejects(f.complete(), /batch write failed/);
    assert.deepEqual(await f.state(), before);
    assert.deepEqual(await modes(f), ["complete"]); // only the pre-existing draft; nothing created
  } finally { await f.db.close(); }
});

async function loadTestModule<T>(path: string, dependencies: Record<string, unknown>): Promise<T> {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const output = ts.transpileModule(await readFile(url, "utf8"), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name.startsWith("@/") ? fileURLToPath(new URL(`../../${name.slice(2)}`, import.meta.url)) : name), compiled, compiled.exports);
  return compiled.exports as T;
}

test("completion and exclusion actions are approver-only and take only batch/match identifiers", async () => {
  let role = "sales_designer"; const calls: unknown[][] = [];
  const actions = await loadTestModule<typeof import("../../app/products/price-updates/supplier-sources/actions.js")>("../../app/products/price-updates/supplier-sources/actions.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { async requireBrandPriceReviewer() { return { profile: { role, account_status: "active" } }; } },
    "@/lib/supabase/server": { async createClient() { return {}; } },
    "@/lib/products/supplier-price-repository": {
      async supplierCompleteReview(...args: unknown[]) { calls.push(args); return {}; }, async supplierCompletionReadiness(...args: unknown[]) { calls.push(args); return {}; },
      async supplierExcludeTargetFromSource(...args: unknown[]) { calls.push(args); return {}; },
      supplierApplyReviewedPrice() {}, supplierConfirmUnchangedPrice() {}, supplierBrandMatches() {}, supplierBrandTargets() {}, supplierMatchChunks() {}, supplierSource() {}, supplierWrite() {},
    },
  });
  for (const run of [() => actions.completeSupplierPriceReview(batch), () => actions.supplierCompletionStatus(batch), () => actions.excludeSupplierTargetFromSource(batch, "m-miss", "why")]) await assert.rejects(run(), /approver permission required/);
  assert.equal(calls.length, 0);
  role = "procurement_manager";
  await (actions.completeSupplierPriceReview as (...args: unknown[]) => Promise<unknown>)(batch, { status: "active", templates: ["forged"] });
  await actions.excludeSupplierTargetFromSource(batch, "m-miss", "why");
  assert.deepEqual(calls.map((args) => args.slice(1)), [[batch], [batch, "m-miss", "why"]]);
});

test("UI shows completion only for Complete approver reviews and exclusion only on missing targets", async () => {
  const f = await fixture();
  try {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const ui = await loadTestModule<typeof import("../../components/products/supplier-price-workspace-controls.js")>("../../components/products/supplier-price-workspace-controls.tsx", {
      "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } },
      "@/lib/supabase/client": { createClient() { assert.fail("Rendering must not create a database client."); } },
      "@/app/products/price-updates/supplier-sources/actions": {},
    });
    const completion = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ui.SupplierCompletionControls, { batchId: batch, scope: "complete", status: "review", approver: true, ...props } as never));
    assert.match(completion({}), /Complete Review<\/h3>/); assert.match(completion({}), /Excluded targets will remain Needs price check after this Brand baseline is activated\./);
    assert.match(completion({}), /<button[^>]*disabled=""[^>]*>Complete Brand Review<\/button>/);
    for (const scope of ["partial", "selected_templates"]) { const html = completion({ scope }); assert.match(html, /cannot activate a Brand-wide baseline because coverage is not Complete/); assert.doesNotMatch(html, /<button/); }
    assert.equal(completion({ approver: false }), "");
    assert.match(completion({ status: "completed" }), /review is completed/); assert.doesNotMatch(completion({ status: "completed" }), /<button/);
    const rows = (await f.db.query<{ data: PriceMatch }>("select data from public.supplier_price_matches order by key")).rows.map((row) => row.data);
    const missing = rows.find((row) => row.key === "m-miss")!, unchanged = rows.find((row) => row.key === "m-unc")!;
    const review = (matches: PriceMatch[], extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ui.SupplierReviewControls, { batchId: batch, brandId: brand, matches, approver: true, sourceBasis: "list", brandBasis: "list", sourceStatus: "imported", batchStatus: "review", ...extra }));
    assert.match(review([missing]), />Exclude from this source<\/button>/); assert.match(review([missing]), /<input required=""[^>]*name="reason"/);
    assert.doesNotMatch(review([missing], { approver: false }), /Exclude from this source/);
    assert.doesNotMatch(review([missing], { batchStatus: "completed" }), /Exclude from this source/);
    assert.doesNotMatch(review([unchanged]), /Exclude from this source/);
    const excluded = review([{ ...missing, decision: "excluded_from_source" }]);
    assert.match(excluded, /Decision: Excluded from source/); assert.doesNotMatch(excluded, /Exclude from this source/);
  } finally { await f.db.close(); }
});
