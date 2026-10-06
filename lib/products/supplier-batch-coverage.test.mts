import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { PriceMatch, SourceIdentity, SourceVersion } from "./supplier-price-contracts.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supplierRefreshReviewAfterMapping, supplierSourceTierPanel } from "./supplier-price-repository.js";
import { supplierAssignFamiliesToSource, supplierAssignFamilyToSource, supplierFamilyCoverageSetup, supplierBrandMatches, supplierBulkConfirmUnchanged, supplierCompletionReadiness, supplierConfirmCoverage, supplierCoverageOverview, supplierCreateReviewBatch, supplierCreateSourceDefinition, supplierFamilyOverview, supplierLinkSourceDefinition, supplierResolveCoverageConflict, supplierWrite, supplierSourceInspectorDetail, supplierMatchProvenance, supplierProductSourceLookup } from "./supplier-price-repository.js";

const read = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const migrations = await Promise.all(["20261002060146_pricing_identity_version_foundation", "20261002065310_pricing_writer_concurrency", "20261003141259_supplier_default_price_writer", "20261002082357_supplier_price_source_review",
  "20261002124625_supplier_source_finish_evidence", "038_product_template_detail_price_history", "20261003154849_detail_history_dynamic_price_fields", "20261003170000_supplier_shared_price_writer",
  "20261004090000_supplier_confirmed_unchanged_decision", "20261004120000_supplier_review_completion", "20261005090000_supplier_source_definitions", "20261005120000_supplier_batch_coverage_snapshot", "20261005180000_supplier_source_definition_writes"].map(read));
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = id(1), brand = id(2), furn = id(11), oxi = id(12), lead = id(13);
const furniture = id(21), emptyDefinition = id(22), inactiveDefinition = id(23);
const legacySource = id(31), furnitureSource = id(32), emptySource = id(33), inactiveSource = id(34);

function pgClient(db: PGlite) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []; const inFilters: Array<[string, unknown[]]> = []; const orders: string[] = []; let start = 0, end = 999, embed = false;
      const execute = async () => {
        let rows: Record<string, unknown>[];
        if (table === "product_components") {
          rows = (await db.query<Record<string, unknown>>("select c.* from product_components c join product_templates t on t.id=c.template_id where t.brand_id=$1 and c.is_active order by c.id", [filters.find(([key]) => key === "product_templates.brand_id")?.[1]])).rows;
        } else {
          const params: unknown[] = []; const where: string[] = [];
          for (const [key, value] of filters) { params.push(value); where.push(`"${key}"=$${params.length}`); }
          for (const [key, values] of inFilters) { params.push(values); where.push(`"${key}"=any($${params.length}::text[])`); }
          rows = (await db.query<Record<string, unknown>>(`select * from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${orders.length ? ` order by ${orders.join(",")}` : ""} limit ${end - start + 1} offset ${start}`, params)).rows;
        }
        if (embed) for (const row of rows) row.supplier_price_decisions = (await db.query("select decision,note from public.supplier_price_decisions where batch_id=$1 and key=$2", [row.batch_id, row.key])).rows[0] ?? null;
        return rows.map((row) => {
          const copy = { ...row };
          for (const field of ["default_unit_price", "unit_price"]) if (typeof copy[field] === "string") copy[field] = Number(copy[field]);
          if (table === "product_templates" && copy.pricing_version !== undefined) copy.pricing_version = String(copy.pricing_version);
          return copy;
        });
      };
      return { select(columns?: string) { embed = Boolean(columns?.includes("supplier_price_decisions(")); return this; }, eq(key: string, value: unknown) { filters.push([key, value]); return this; }, in(key: string, values: unknown[]) { inFilters.push([key, values]); return this; },
        order(column: string, options?: { ascending?: boolean }) { orders.push(`"${column}" ${options?.ascending === false ? "desc" : "asc"}`); return this; }, returns() { return this; }, range(from: number, to: number) { start = from; end = to; return this; }, limit(count: number) { end = start + count - 1; return this; },
        async single() { const rows = await execute(); return { data: rows.length === 1 ? rows[0] : null, error: rows.length === 1 ? null : { message: "Record unavailable" } }; },
        async maybeSingle() { const rows = await execute(); return { data: rows[0] ?? null, error: null }; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then((data) => resolve({ data, error: null }), reject); } };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push(name); const keys = Object.keys(args);
      try {
        const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((_, index) => `$${index + 1}`).join(",")}) as result`, keys.map((key) => typeof args[key] === "object" ? JSON.stringify(args[key]) : args[key]));
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as 'select ''${user}''::uuid';
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
    create table public.permissions(can_review boolean,can_approve boolean); insert into public.permissions values(true,true);
    create function public.current_user_is_active() returns boolean language sql as 'select true';
    create function public.current_user_can_manage_records() returns boolean language sql as 'select true';
    create function public.current_user_can_review_brand_prices() returns boolean language sql as 'select can_review from public.permissions';
    create function public.current_user_can_approve_brand_prices() returns boolean language sql as 'select can_approve from public.permissions';
    create table public.profiles(id uuid primary key); insert into public.profiles values('${user}');
    create table public.brands(id uuid primary key,last_price_list_checked_at timestamptz); insert into public.brands values('${brand}','2025-06-01');
    create table public.brand_price_list_updates(id uuid primary key default gen_random_uuid(),brand_id uuid not null,title text not null,reference_no text,currency text,effective_from date,received_at date,
      status text not null default 'draft' check(status in ('draft','active','archived')),notes text,attachment_url text,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.product_templates(id uuid primary key,brand_id uuid,template_name text,item_code text,description text,default_image_url text,price_notes text,
      last_price_checked_at timestamptz,last_price_checked_by uuid,price_check_note text,created_at timestamptz default '2025-01-01',is_active boolean default true,
      default_unit_price numeric default 100,currency text default 'EUR',variant_pricing jsonb default '[]',category_pricing jsonb default '[]',desking_size_pricing jsonb default '[]',accessory_pricing jsonb default '[]');
    create table public.product_components(id uuid primary key,template_id uuid not null references public.product_templates(id),option_type text,component_group text,component_code text,component_name text,description text,
      qty numeric,unit_label text,unit_price numeric,currency text,is_optional boolean,is_default_selected boolean,sort_order int,is_active boolean,price_notes text,calculation_data jsonb,created_by uuid);
    create table public.product_template_price_history(id uuid default gen_random_uuid(),product_template_id uuid,brand_id uuid,brand_price_list_update_id uuid,old_default_unit_price numeric,new_default_unit_price numeric,currency text,effective_from date,note text,changed_by uuid);
    create table public.quotations(id uuid primary key,total numeric); insert into public.quotations values('${user}',500);`);
  for (const sql of migrations.slice(0, 3)) await db.exec(sql);
  await db.exec(migrations[3]); await db.exec(migrations[4]); await db.exec(migrations[5]); await db.exec(migrations[6]);
  for (const sql of migrations.slice(7)) await db.exec(sql);
  const lines = (prefix: string, count: number, price: number) => [{ id: `${prefix}g`, items: Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, supplier_price_list_code: `${prefix}${index + 1}`, variant_name: `${prefix} ${index + 1}`, price, currency: "EUR" })) }];
  await db.exec(`update public.brands set stored_price_basis='list';
    insert into public.product_templates(id,brand_id,template_name,item_code,default_unit_price) values ('${furn}','${brand}','FURN',null,10),('${oxi}','${brand}','OXI','O1',120),('${lead}','${brand}','LEAD',null,10);
    insert into public.supplier_source_definitions(id,brand_id,name,is_active) values('${furniture}','${brand}','LAS Furniture',true),('${emptyDefinition}','${brand}','Empty',true),('${inactiveDefinition}','${brand}','Retired',false);
    insert into public.supplier_source_definition_families(definition_id,template_id) values('${furniture}','${furn}'),('${furniture}','${oxi}'),('${inactiveDefinition}','${furn}');`);
  await db.query("update public.product_templates set variant_pricing=$1 where id=$2", [JSON.stringify(lines("F", 2, 100)), furn]);
  await db.query("update public.product_templates set variant_pricing=$1 where id=$2", [JSON.stringify(lines("L", 6, 50)), lead]);
  const identities = [["F1", 100], ["F2", 100], ["O1", 120], ["L1", 50], ["L2", 50], ["L3", 50]] as const;
  for (const [source, definition, title] of [[legacySource, null, "Legacy"], [furnitureSource, furniture, "Furniture"], [emptySource, emptyDefinition, "Empty"], [inactiveSource, inactiveDefinition, "Retired"]] as const) {
    await db.query(`insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by,definition_id)
      values($1,$2,$3,'s.csv',$4,'csv','EUR','list','{}','imported',1,1,1,$5,$6)`, [source, brand, title, "a".repeat(64), user, definition]);
    for (const [code, price] of identities) await db.query("insert into public.supplier_source_identities values($1,$2,$3,$4)", [source, `id-${code}`, code, JSON.stringify({ key: `id-${code}`, code, price_field: "unit_price", dimension: "", finishes: [], price, currency: "EUR", row_keys: [], issues: [] })]);
  }
  return { db, ...pgClient(db) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const withDb = async (run: (f: Fixture) => Promise<void>) => { const f = await fixture(); try { await run(f); } finally { await f.db.close(); } };
const coverageOf = async (f: Fixture, batchId: string) => (await f.db.query<{ c: string[] | null }>("select coverage_template_ids c from public.supplier_price_batches where id=$1", [batchId])).rows[0].c;
const templateNames = (matches: Array<{ targets: Array<{ template_name: string }> }>) => [...new Set(matches.flatMap((match) => match.targets.map((target) => target.template_name)))].sort();
const noBatch = { expected_matches: 0, expected_chunks: 0, title: "x" };

test("mapping refresh creates a new review with identical scope/selection/link/coverage and protects historical/no-batch views", async () => {
  await withDb(async (f) => {
    await f.db.query("insert into brand_price_list_updates(id,brand_id,title,currency,status) values($1,$2,'Linked','EUR','draft')", [id(90), brand]);
    const old = await supplierCreateReviewBatch(f.client, furnitureSource, "selected_templates", [oxi], id(90));
    const oldBefore = (await f.db.query("select * from supplier_price_batches where id=$1", [old.id])).rows;
    const matchesBefore = (await f.db.query("select * from supplier_price_matches where batch_id=$1 order by key", [old.id])).rows;
    const productsBefore = (await f.db.query("select * from product_templates order by id")).rows;
    const next = await supplierRefreshReviewAfterMapping(f.client, furnitureSource, old.id);
    assert.ok(next.id); assert.notEqual(next.id, old.id);
    const row = (await f.db.query<{ scope: string; selected_template_ids: string[]; brand_price_list_update_id: string }>("select * from supplier_price_batches where id=$1", [next.id])).rows[0];
    assert.deepEqual([row.scope, row.selected_template_ids, row.brand_price_list_update_id], ["selected_templates", [oxi], id(90)]);
    assert.deepEqual(await coverageOf(f, next.id), await coverageOf(f, old.id));
    assert.deepEqual((await f.db.query("select * from supplier_price_batches where id=$1", [old.id])).rows, oldBefore);
    assert.deepEqual((await f.db.query("select * from supplier_price_matches where batch_id=$1 order by key", [old.id])).rows, matchesBefore);
    assert.deepEqual((await f.db.query("select * from product_templates order by id")).rows, productsBefore);
    assert.deepEqual(await supplierRefreshReviewAfterMapping(f.client, furnitureSource), { id: null });
    assert.deepEqual(await supplierRefreshReviewAfterMapping(f.client, furnitureSource, old.id), { id: null });
    await f.db.query("update supplier_price_batches set status='completed' where id=$1", [next.id]);
    assert.deepEqual(await supplierRefreshReviewAfterMapping(f.client, furnitureSource, next.id), { id: null });
    assert.equal((await f.db.query<{ count: number }>("select count(*)::int count from supplier_price_batches")).rows[0].count, 2);
  });
});

test("current source panel sees H mapped and F archived independently of the immutable old review", async () => {
  await withDb(async (f) => {
    const columns = ["f", "h"].map((label) => ({ id: label, label: `Cat ${label.toUpperCase()}`, dimension_code: `cat_${label}` }));
    await f.db.query("update product_templates set variant_pricing='[]',category_pricing=$1 where id=$2", [JSON.stringify([{ id: id(80), group_name: "Upholstery pricing", price_columns: columns, items: ["L1", "L2", "L3"].map((code) => ({ id: code, supplier_price_list_code: code, prices: { f: 50, h: 50 } })) }]), lead]);
    for (const code of ["L1", "L2", "L3"]) await f.db.query("update supplier_source_identities set data=data||$1::jsonb where source_id=$2 and code=$3", [JSON.stringify({ dimension: code === "L1" ? "F" : "H", raw_dimension: code === "L1" ? "F" : "H" }), legacySource, code]);
    const fRule = await supplierWrite(f.client, "dimension", { brand_id: brand, template_id: lead, group_id: id(80), raw_labels: ["F"], finish_codes: [], dimension_code: "cat_f" });
    const old = await supplierCreateReviewBatch(f.client, legacySource, "complete", []);
    const oldMatches = (await f.db.query("select * from supplier_price_matches where batch_id=$1 order by key", [old.id])).rows;
    const first = await supplierSourceTierPanel(f.client, legacySource); assert.equal(first.unmapped[0].label, "H"); assert.equal(first.unmapped[0].affected, 2);
    await supplierWrite(f.client, "dimension", { brand_id: brand, raw_labels: ["H"], finish_codes: [], dimension_code: "cat_h" });
    await supplierWrite(f.client, "archive_dimension", { id: fRule.id });
    const panel = await supplierSourceTierPanel(f.client, legacySource);
    assert.deepEqual(panel.unmapped.map((task) => task.label), ["F"]); assert.equal(panel.mapped[0].label, "H"); assert.equal(panel.mapped[0].rule.dimension_code, "cat_h");
    assert.equal(panel.unmapped[0].scopeName, "LEAD / Upholstery pricing"); assert.equal(panel.unmapped[0].affected, 1);
    assert.deepEqual((await f.db.query("select * from supplier_price_matches where batch_id=$1 order by key", [old.id])).rows, oldMatches);
    const next = await supplierRefreshReviewAfterMapping(f.client, legacySource, old.id); assert.ok(next.id);
    const classifications = (await f.db.query<{ code: string; classification: string }>("select code,classification from supplier_price_matches where batch_id=$1 and code like 'L%' order by code", [next.id])).rows;
    assert.deepEqual(classifications.map((row) => [row.code, row.classification]), [["L1", "needs_dimension_mapping"], ["L2", "unchanged"], ["L3", "unchanged"]]);
  });
});

test("auto rebuild refuses changed coverage instead of silently widening the review", async () => {
  await withDb(async (f) => {
    const old = await supplierCreateReviewBatch(f.client, furnitureSource, "complete", []);
    await f.db.query("delete from supplier_source_definition_families where definition_id=$1 and template_id=$2", [furniture, oxi]);
    await assert.rejects(supplierRefreshReviewAfterMapping(f.client, furnitureSource, old.id), /coverage changed/);
    assert.equal((await f.db.query<{ count: number }>("select count(*)::int count from supplier_price_batches")).rows[0].count, 1);
    assert.deepEqual([...(await coverageOf(f, old.id))!].sort(), [furn, oxi].sort());
  });
});

test("a batch from a definition snapshots its confirmed Families inside the database", async () => {
  await withDb(async (f) => {
    const created = await supplierCreateReviewBatch(f.client, furnitureSource, "complete", []);
    assert.deepEqual([...(await coverageOf(f, created.id))!].sort(), [furn, oxi].sort());
    await assert.rejects(f.db.exec(`update public.supplier_price_batches set coverage_template_ids=null where id='${created.id}'`), /immutable/);
    await assert.rejects(f.db.exec(`update public.supplier_price_batches set coverage_template_ids='{}' where id='${created.id}'`), /immutable/);
  });
});

test("a definition with no confirmed Families, or an inactive one, cannot create a batch (app and database)", async () => {
  await withDb(async (f) => {
    await assert.rejects(supplierCreateReviewBatch(f.client, emptySource, "complete", []), /no confirmed Family coverage/);
    await assert.rejects(supplierWrite(f.client, "batch", { source_id: emptySource, scope: "complete", selected_template_ids: [], ...noBatch }), /no confirmed Family coverage/);
    await assert.rejects(supplierWrite(f.client, "batch", { source_id: inactiveSource, scope: "complete", selected_template_ids: [], ...noBatch }), /inactive or unavailable/);
    await assert.rejects(supplierCreateReviewBatch(f.client, inactiveSource, "complete", []), /inactive or unavailable/);
    assert.equal((await f.db.query<{ c: number }>("select count(*)::int c from public.supplier_price_batches")).rows[0].c, 0);
  });
});

test("a browser-supplied coverage list is ignored: the stored snapshot comes from the definition", async () => {
  await withDb(async (f) => {
    const result = await supplierWrite(f.client, "batch", { source_id: furnitureSource, scope: "complete", selected_template_ids: [], coverage_template_ids: [lead], ...noBatch });
    assert.deepEqual([...(await coverageOf(f, result.id))!].sort(), [furn, oxi].sort());
  });
});

test("LEAD regression: covered matching has no LEAD targets or Missing rows, and its source-only identities stay harmless", async () => {
  await withDb(async (f) => {
    const { matches } = await supplierBrandMatches(f.client, furnitureSource);
    assert.deepEqual(templateNames(matches), ["FURN", "OXI"]);
    assert.equal(matches.filter((match) => match.classification === "target_not_represented").length, 0);
    assert.deepEqual(matches.filter((match) => match.source && ["L1", "L2", "L3"].includes(match.source.code)).map((match) => [match.classification, match.targets.length]), [["unmatched", 0], ["unmatched", 0], ["unmatched", 0]]);
    const legacy = await supplierBrandMatches(f.client, legacySource); // same data, no definition: LEAD's 3 absent codes are Missing exactly as before
    assert.deepEqual(templateNames(legacy.matches), ["FURN", "LEAD", "OXI"]);
    assert.equal(legacy.matches.filter((match) => match.classification === "target_not_represented").length, 3);
  });
});

test("legacy: a source without a definition creates a batch with NULL coverage and the whole Brand", async () => {
  await withDb(async (f) => {
    const created = await supplierCreateReviewBatch(f.client, legacySource, "complete", []);
    assert.equal(await coverageOf(f, created.id), null);
    const overview = await supplierFamilyOverview(f.client, created.id);
    assert.deepEqual(overview.families.map((family) => family.template_name).sort(), ["FURN", "LEAD", "OXI"]);
    assert.equal((await supplierCompletionReadiness(f.client, created.id)).counts.target_not_represented, 3);
  });
});

test("Family overview lists only covered Families", async () => {
  await withDb(async (f) => {
    const created = await supplierCreateReviewBatch(f.client, furnitureSource, "complete", []);
    const overview = await supplierFamilyOverview(f.client, created.id);
    assert.deepEqual(overview.families.map((family) => family.template_name).sort(), ["FURN", "OXI"]);
    assert.equal(overview.families.reduce((total, family) => total + family.missing, 0), 0);
  });
});

test("selected_templates works inside coverage and a Family outside coverage cannot be selected", async () => {
  await withDb(async (f) => {
    const inside = await supplierCreateReviewBatch(f.client, furnitureSource, "selected_templates", [oxi]);
    assert.deepEqual((await f.db.query<{ template_name: string }>("select template_name from public.supplier_template_review_units where batch_id=$1", [inside.id])).rows.map((row) => row.template_name), ["OXI"]);
    await assert.rejects(supplierCreateReviewBatch(f.client, furnitureSource, "selected_templates", [lead]), /outside this source coverage/);
    await assert.rejects(supplierWrite(f.client, "batch", { source_id: furnitureSource, scope: "selected_templates", selected_template_ids: [lead], ...noBatch }), /outside this source coverage/);
    await assert.rejects(supplierWrite(f.client, "batch", { source_id: furnitureSource, scope: "partial", selected_template_ids: [lead], ...noBatch }), /outside this source coverage/);
  });
});

test("readiness uses the covered universe: a new uncovered Family is ignored, a covered target addition still stales", async () => {
  await withDb(async (f) => {
    const created = await supplierCreateReviewBatch(f.client, furnitureSource, "complete", []);
    const legacyBatch = await supplierCreateReviewBatch(f.client, legacySource, "complete", []);
    await f.db.exec(`insert into public.product_templates(id,brand_id,template_name,item_code,default_unit_price) values('${id(14)}','${brand}','NEW UNCOVERED','N1',5)`);
    assert.equal((await supplierCompletionReadiness(f.client, created.id)).counts.targets_added_after_comparison, 0);
    assert.equal((await supplierCompletionReadiness(f.client, legacyBatch.id)).counts.targets_added_after_comparison, 1); // legacy: the whole Brand, as before
    const rows = [["F0", "F1"], ["F1", "F2"], ["F9", "F9"]].map(([rowId, code]) => ({ id: rowId, supplier_price_list_code: code, variant_name: code, price: 100, currency: "EUR" }));
    await f.db.query("update public.product_templates set variant_pricing=$1 where id=$2", [JSON.stringify([{ id: "Fg", items: rows }]), furn]);
    assert.equal((await supplierCompletionReadiness(f.client, created.id)).counts.targets_added_after_comparison, 1);
  });
});

test("the database refuses matches and decisions outside the batch coverage", async () => {
  await withDb(async (f) => {
    const created = await supplierCreateReviewBatch(f.client, furnitureSource, "complete", []);
    const { targets } = await supplierBrandMatches(f.client, legacySource);
    const outside = targets.find((target) => target.template_id === lead)!;
    const match = { key: "m-outside", source: null, targets: [outside], classification: "target_not_represented", comparison: null, candidate_shared: false };
    const fresh = await supplierWrite(f.client, "batch", { source_id: furnitureSource, scope: "complete", selected_template_ids: [], title: "x", expected_matches: 1, expected_chunks: 1 });
    await assert.rejects(supplierWrite(f.client, "match_chunk", { batch_id: fresh.id, chunk_index: 0, matches: [match] }), /outside batch coverage/);
    await f.db.query("insert into public.supplier_price_matches values($1,$2,$3,$4,null,$5,$6)", [created.id, match.key, "L1", match.classification, [lead], JSON.stringify(match)]);
    await assert.rejects(supplierWrite(f.client, "decision", { batch_id: created.id, key: match.key, decision: "skip", note: "" }), /outside batch coverage/);
  });
});

test("Apply/Confirm cannot act on a match whose target lies outside coverage", async () => {
  await withDb(async (f) => {
    const created = await supplierCreateReviewBatch(f.client, furnitureSource, "complete", []);
    const { targets } = await supplierBrandMatches(f.client, legacySource);
    const outside = targets.find((target) => target.template_id === lead && target.code === "L1")!;
    const source = { key: "id-L1", code: "L1", price_field: "unit_price", dimension: "", finishes: [], price: 50, currency: "EUR", row_keys: [], issues: [] };
    const match = { key: "m-outside-l1", source, targets: [outside], classification: "unchanged", comparison: "unchanged", candidate_shared: false };
    await f.db.query("insert into public.supplier_price_matches values($1,$2,$3,$4,$5,$6,$7)", [created.id, match.key, "L1", "unchanged", "unchanged", [lead], JSON.stringify(match)]);
    await assert.rejects(supplierBulkConfirmUnchanged(f.client, created.id, [match.key]));
    assert.equal((await f.db.query<{ c: number }>("select count(*)::int c from public.supplier_price_decisions where key=$1", [match.key])).rows[0].c, 0);
  });
});

// ---- Phase 2I-4: write path behind the coverage UI ----
const setApprover = (f: Fixture, allowed: boolean) => f.db.exec(`update public.permissions set can_approve=${allowed}`);
const familyIds = async (f: Fixture, definition: string) => (await f.db.query<{ template_id: string }>("select template_id from public.supplier_source_definition_families where definition_id=$1 order by template_id", [definition])).rows.map((row) => row.template_id);

test("create a source definition: named, same-Brand profile only, duplicate names get a friendly message", async () => {
  await withDb(async (f) => {
    const created = await supplierCreateSourceDefinition(f.client, brand, "  LAS Chairs  ");
    assert.equal((await f.db.query<{ name: string }>("select name from public.supplier_source_definitions where id=$1", [created.id])).rows[0].name, "LAS Chairs");
    await assert.rejects(supplierCreateSourceDefinition(f.client, brand, "LAS Chairs"), /A Supplier source with this name already exists for this Brand\./);
    await assert.rejects(supplierCreateSourceDefinition(f.client, brand, "   "), /Enter a Supplier source name/);
    await f.db.exec(`insert into public.brands(id) values('${id(90)}'); insert into public.supplier_price_profiles(id,brand_id,title,config) values('${id(91)}','${id(90)}','Other','{}')`);
    await assert.rejects(supplierCreateSourceDefinition(f.client, brand, "Bad profile", id(91)), /another Brand/);
  });
});

test("confirming coverage replaces the set from the database side; only active Families of the Brand; approver only", async () => {
  await withDb(async (f) => {
    await supplierConfirmCoverage(f.client, furniture, [furn, lead, lead]);
    assert.deepEqual(await familyIds(f, furniture), [furn, lead].sort());
    await f.db.exec(`insert into public.product_templates(id,brand_id,template_name,item_code,is_active) values('${id(95)}','${brand}','OLD','X',false)`);
    await assert.rejects(supplierConfirmCoverage(f.client, furniture, [id(95)]), /active Families of this Brand/);
    await assert.rejects(supplierConfirmCoverage(f.client, inactiveDefinition, [furn]), /unavailable/);
    await setApprover(f, false);
    await assert.rejects(supplierConfirmCoverage(f.client, furniture, [oxi]), /permission|privilege|insufficient/i);
    assert.deepEqual(await familyIds(f, furniture), [furn, lead].sort()); // unchanged
    await setApprover(f, true);
    await supplierConfirmCoverage(f.client, furniture, []); assert.deepEqual(await familyIds(f, furniture), []);
  });
});

test("linking a price list to a Supplier source works until it has a review, and never across Brands", async () => {
  await withDb(async (f) => {
    await supplierLinkSourceDefinition(f.client, legacySource, furniture);
    assert.equal((await f.db.query<{ d: string }>("select definition_id d from public.supplier_source_versions where id=$1", [legacySource])).rows[0].d, furniture);
    await supplierCreateReviewBatch(f.client, legacySource, "complete", []);
    await assert.rejects(supplierLinkSourceDefinition(f.client, legacySource, null), /already has a review/);
    await f.db.exec(`insert into public.brands(id) values('${id(90)}'); insert into public.supplier_source_definitions(id,brand_id,name) values('${id(92)}','${id(90)}','Other')`);
    await assert.rejects(supplierLinkSourceDefinition(f.client, emptySource, id(92)), /unavailable for this Brand/);
    await assert.rejects(supplierLinkSourceDefinition(f.client, emptySource, inactiveDefinition), /unavailable for this Brand/);
  });
});

test("overview, assign source and conflict resolution; a review cannot start while a conflict exists", async () => {
  await withDb(async (f) => {
    const before = await supplierCoverageOverview(f.client, brand);
    assert.deepEqual(before.uncovered.map((item) => item.templateName), ["LEAD"]); // active Family no active source covers
    assert.deepEqual(before.definitions.find((item) => item.id === furniture)!.families.map((item) => item.name), ["FURN", "OXI"]);
    const chairs = (await supplierCreateSourceDefinition(f.client, brand, "LAS Chairs")).id;
    await supplierAssignFamilyToSource(f.client, chairs, lead);
    assert.deepEqual((await supplierCoverageOverview(f.client, brand)).uncovered, []);
    await supplierAssignFamilyToSource(f.client, chairs, furn); // now FURN is claimed twice
    const conflicts = (await supplierCoverageOverview(f.client, brand)).conflicts;
    assert.deepEqual(conflicts.map((item) => [item.templateName, item.definitions.map((entry) => entry.definitionName).sort()]), [["FURN", ["LAS Chairs", "LAS Furniture"]]]);
    await assert.rejects(supplierCreateReviewBatch(f.client, furnitureSource, "complete", []), /Resolve Family coverage conflicts before starting this review\./);
    assert.equal((await f.db.query<{ c: number }>("select count(*)::int c from public.supplier_price_batches")).rows[0].c, 0);
    await supplierResolveCoverageConflict(f.client, brand, furn, furniture); // LAS Furniture keeps it
    assert.deepEqual((await supplierCoverageOverview(f.client, brand)).conflicts, []);
    assert.deepEqual(await familyIds(f, chairs), [lead]);
    await supplierCreateReviewBatch(f.client, furnitureSource, "complete", []);
    await assert.rejects(supplierResolveCoverageConflict(f.client, brand, furn, furniture), /no longer in conflict/);
  });
});

// ---- Phase 2I-4.1: bulk coverage setup ----
test("bulk assignment: several Families in one action, composed from the existing coverage write", async () => {
  await withDb(async (f) => {
    const result = await supplierAssignFamiliesToSource(f.client, brand, { definitionId: furniture }, [lead, furn, lead]);
    assert.deepEqual([result.name, result.count], ["LAS Furniture", 2]);
    assert.deepEqual(await familyIds(f, furniture), [furn, oxi, lead].sort()); // existing coverage kept, selection added once
    await assert.rejects(supplierAssignFamiliesToSource(f.client, brand, { definitionId: furniture }, []), /Select at least one Family/);
    await setApprover(f, false);
    await assert.rejects(supplierAssignFamiliesToSource(f.client, brand, { definitionId: furniture }, [lead]), /permission|privilege|insufficient/i);
  });
});

test("create-and-assign: one new source with the selected Families; duplicate names are refused", async () => {
  await withDb(async (f) => {
    await f.db.exec(`insert into public.supplier_price_profiles(id,brand_id,title,config) values('${id(60)}','${brand}','LAS MOBILI — Standard XLSX','{}')`);
    const created = await supplierAssignFamiliesToSource(f.client, brand, { newName: "LAS Chairs", profileId: id(60) }, [lead]);
    assert.equal(created.name, "LAS Chairs"); assert.deepEqual(await familyIds(f, created.definitionId), [lead]);
    assert.equal((await f.db.query<{ p: string }>("select profile_id p from public.supplier_source_definitions where id=$1", [created.definitionId])).rows[0].p, id(60));
    await assert.rejects(supplierAssignFamiliesToSource(f.client, brand, { newName: "LAS Chairs" }, [lead]), /already exists/);
  });
});

test("coverage rows: category from the Product Library, found/total from the reference source, current source, no reference source means no counts", async () => {
  await withDb(async (f) => {
    await f.db.exec(`alter table public.product_templates add column main_category_id uuid, add column sub_category_id uuid; create table public.product_categories(id uuid primary key,brand_id uuid,name text);
      insert into public.product_categories values('${id(70)}','${brand}','Chair'),('${id(71)}','${brand}','Executive Chair'); update public.product_templates set main_category_id='${id(70)}',sub_category_id='${id(71)}' where id='${lead}';`);
    const rows = await supplierFamilyCoverageSetup(f.client, brand, furnitureSource);
    const by = new Map(rows.map((row) => [row.templateName, row]));
    assert.deepEqual([by.get("LEAD")!.mainCategory, by.get("LEAD")!.subCategory, by.get("FURN")!.mainCategory], ["Chair", "Executive Chair", null]); // never inferred
    assert.deepEqual([by.get("FURN")!.foundTargetCodes, by.get("FURN")!.totalTargetCodes, by.get("LEAD")!.foundTargetCodes, by.get("LEAD")!.totalTargetCodes], [2, 2, 3, 6]); // distinct codes, not price rows
    assert.deepEqual([by.get("FURN")!.currentSources.map((s) => s.definitionName), by.get("LEAD")!.currentSources], [["LAS Furniture"], []]);
    const bare = await supplierFamilyCoverageSetup(f.client, brand, null);
    assert.deepEqual([bare[0].foundTargetCodes, bare[0].foundRatio], [null, null]);
  });
});

// ---- Phase F1: Inspector, technical review provenance and Supplier source lookup read identity evidence ----
const evidenceOf = (code: string, count: number) => Array.from({ length: count }, (_, index) => ({ row_number: 10 + index, sheet: "Arredi", full_supplier_code: `${code}14${index}`, article_code: code, finish_code: `14${index}`, raw_price: 100 }));
async function withEvidence(f: Fixture, sourceId: string, code: string, rowCount: number) {
  await f.db.query("update public.supplier_source_identities set data=data || jsonb_build_object('source_row_count',$3::int,'evidence',$4::jsonb) where source_id=$1 and code=$2", [sourceId, code, rowCount, JSON.stringify(evidenceOf(code, Math.min(rowCount, 5)))]);
}
async function legacyRow(f: Fixture, sourceId: string, code: string, unitKey: string, rowNumber: number) {
  await f.db.query("insert into public.supplier_source_rows(source_id,unit_key,row_number,sheet,raw_extras) values($1,$2,$3,'Legacy',$4)", [sourceId, unitKey, rowNumber, JSON.stringify({ CODE: `${code}999`, NOTES: "x" })]);
  await f.db.query("update public.supplier_source_identities set data=jsonb_set(data,'{row_keys}',$3::jsonb) where source_id=$1 and code=$2", [sourceId, code, JSON.stringify([unitKey])]);
}

test("Inspector reads embedded identity evidence and falls back to source rows only for older identities", async () => {
  await withDb(async (f) => {
    await f.db.exec(`update public.supplier_source_versions set profile='{"full_code_column":"CODE"}' where id='${furnitureSource}'`);
    await withEvidence(f, furnitureSource, "F1", 7);
    const embedded = await supplierSourceInspectorDetail(f.client, furnitureSource, "id-F1");
    assert.equal(embedded.sourceRowCount, 7); assert.equal(embedded.evidence.length, 5); assert.equal(embedded.moreEvidence, 2);
    assert.deepEqual(embedded.evidence[0], { articleCode: "F1", fullCode: "F1140", description: "", finishCode: "140", categoryLabel: "", dimensionLabel: "", rawPrice: "100", price: 100, currency: "EUR", priceField: "unit_price", dimension: "", sourceRowNumber: 10, sheet: "Arredi", validationWarnings: [] });
    assert.deepEqual(embedded.fullCodes, ["F1140", "F1141", "F1142", "F1143", "F1144"]);
    await legacyRow(f, furnitureSource, "O1", "legacy-1", 42);
    const legacy = await supplierSourceInspectorDetail(f.client, furnitureSource, "id-O1");
    assert.deepEqual([legacy.sourceRowCount, legacy.evidence.length, legacy.evidence[0].sourceRowNumber, legacy.evidence[0].fullCode], [1, 1, 42, "O1999"]);
  });
});

test("technical review provenance uses identity evidence, with the source-row fallback for legacy identities", async () => {
  await withDb(async (f) => {
    await f.db.exec(`update public.supplier_source_versions set profile='{"full_code_column":"CODE"}' where id='${furnitureSource}'`);
    await withEvidence(f, furnitureSource, "F1", 2);
    await legacyRow(f, furnitureSource, "O1", "legacy-1", 42);
    const source = (await f.db.query<SourceVersion>("select * from public.supplier_source_versions where id=$1", [furnitureSource])).rows[0];
    const identities = (await f.db.query<{ data: SourceIdentity }>("select data from public.supplier_source_identities where source_id=$1 and code in ('F1','O1') order by code", [furnitureSource])).rows.map((row) => row.data);
    const matches = identities.map((identity) => ({ key: `m-${identity.code}`, source: { ...identity, evidence: undefined }, targets: [], classification: "unmatched", candidate_shared: false })) as unknown as PriceMatch[];
    const provenance = await supplierMatchProvenance(f.client, source, matches);
    assert.deepEqual(provenance.get("m-F1"), [{ row_number: 10, sheet: "Arredi", raw_extras: { CODE: "F1140" } }, { row_number: 11, sheet: "Arredi", raw_extras: { CODE: "F1141" } }]);
    assert.deepEqual(provenance.get("m-O1")?.map((row) => [row.row_number, row.raw_extras.CODE]), [[42, "O1999"]]);
  });
});

test("Supplier source lookup: current price list of one definition, every exact match, shared codes kept, other sources never mixed", async () => {
  await withDb(async (f) => {
    await withEvidence(f, furnitureSource, "F1", 3);
    // A second identity with the same code (another price field) must not be collapsed.
    await f.db.query("insert into public.supplier_source_identities values($1,'id-F1-extra','F1',$2)", [furnitureSource, JSON.stringify({ key: "id-F1-extra", code: "F1", price_field: "additional_price", dimension: "", finishes: [], price: 40, currency: "EUR", row_keys: ["r9"], issues: [] })]);
    // LAS Chairs has its own current source with the same code at another price.
    const chairs = id(24), chairsSource = id(35);
    await f.db.exec(`insert into public.supplier_source_definitions(id,brand_id,name) values('${chairs}','${brand}','LAS Chairs');
      insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by,definition_id)
        values('${chairsSource}','${brand}','Chairs','c.csv','${"c".repeat(64)}','csv','EUR','list','{}','imported',1,1,1,'${user}','${chairs}');`);
    await f.db.query("insert into public.supplier_source_identities values($1,'id-F1','F1',$2)", [chairsSource, JSON.stringify({ key: "id-F1", code: "F1", price_field: "unit_price", dimension: "", finishes: [], price: 999, currency: "EUR", row_keys: [], issues: [] })]);
    const furnitureLookup = await supplierProductSourceLookup(f.client, { brandId: brand, definitionId: furniture, code: " f1 " });
    assert.equal(furnitureLookup.source?.id, furnitureSource); assert.equal(furnitureLookup.definition.name, "LAS Furniture");
    assert.deepEqual([furnitureLookup.multiplicity, furnitureLookup.ambiguous], [2, true]);
    assert.deepEqual(furnitureLookup.identities.map((item) => [item.price_field, item.price, item.source_row_count, item.evidence?.length]), [["unit_price", 100, 3, 3], ["additional_price", 40, 1, 0]]);
    const chairsLookup = await supplierProductSourceLookup(f.client, { brandId: brand, definitionId: chairs, code: "F1" });
    assert.deepEqual(chairsLookup.identities.map((item) => item.price), [999]); // never mixed with LAS Furniture
    assert.equal((await supplierProductSourceLookup(f.client, { brandId: brand, definitionId: furniture, code: "ZZZ" })).multiplicity, 0);
    await assert.rejects(supplierProductSourceLookup(f.client, { brandId: id(99), definitionId: furniture, code: "F1" }), /unavailable for this Brand/);
    // A newer imported version of the same definition becomes the current price list.
    await f.db.exec(`update public.supplier_source_versions set created_at=now() - interval '1 day' where id='${furnitureSource}';
      insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by,definition_id)
        values('${id(36)}','${brand}','Furniture Oct','f.xlsx','${"d".repeat(64)}','xlsx','EUR','list','{}','imported',1,1,1,'${user}','${furniture}');`);
    const newer = await supplierProductSourceLookup(f.client, { brandId: brand, definitionId: furniture, code: "F1" });
    assert.deepEqual([newer.source?.id, newer.multiplicity], [id(36), 0]);
  });
});
