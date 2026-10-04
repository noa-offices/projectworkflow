import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SUPPLIER_BULK_LIMIT, supplierConfirmUnchangedPrice, supplierBrandTargets, supplierBulkApplyChanged, supplierBulkConfirmUnchanged, supplierBulkExcludeMissing, supplierCompleteReview, supplierFamilyOverview, supplierFamilyRows,
} from "./supplier-price-repository.js";
import type { PriceMatch, PriceTarget, SourceIdentity } from "./supplier-price-contracts.js";

const read = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const migrations = await Promise.all(["20261002060146_pricing_identity_version_foundation", "20261002065310_pricing_writer_concurrency", "20261003141259_supplier_default_price_writer", "20261002082357_supplier_price_source_review",
  "20261002124625_supplier_source_finish_evidence", "038_product_template_detail_price_history", "20261003154849_detail_history_dynamic_price_fields", "20261003170000_supplier_shared_price_writer",
  "20261004090000_supplier_confirmed_unchanged_decision", "20261004120000_supplier_review_completion"].map(read));
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = id(1), brand = id(2), source = id(3), batch = id(4);
const alpha = id(11), beta = id(12), gamma = id(13), delta1 = id(14), delta2 = id(15), epsilon = id(16);
const ALPHA_CHANGED = 22, ALPHA_SAME = 3;

function pgClient(db: PGlite) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []; const inFilters: Array<[string, unknown[]]> = []; let order: string | null = null, start = 0, end = 999, embed = false;
      const execute = async () => {
        let rows: Record<string, unknown>[];
        if (table === "product_components") {
          rows = (await db.query<Record<string, unknown>>("select c.* from product_components c join product_templates t on t.id=c.template_id where t.brand_id=$1 and c.is_active order by c.id", [filters.find(([key]) => key === "product_templates.brand_id")?.[1]])).rows;
        } else {
          const params: unknown[] = []; const where: string[] = [];
          for (const [key, value] of filters) { params.push(value); where.push(`"${key}"=$${params.length}`); }
          for (const [key, values] of inFilters) { params.push(values); where.push(`"${key}"=any($${params.length}::text[])`); }
          rows = (await db.query<Record<string, unknown>>(`select * from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${order ? ` order by "${order}"` : ""} limit ${end - start + 1} offset ${start}`, params)).rows;
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
        order(column: string) { order = column; return this; }, range(from: number, to: number) { start = from; end = to; return this; },
        async single() { const rows = await execute(); return { data: rows.length === 1 ? rows[0] : null, error: rows.length === 1 ? null : { message: "Record unavailable" } }; },
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

async function fixture({ withAttention = true }: { withAttention?: boolean } = {}) {
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
  await db.exec(migrations[3]); // review schema needs only base tables; detail history follows below
  await db.exec(migrations[4]); await db.exec(migrations[5]); await db.exec(migrations[6]); for (const sql of migrations.slice(7)) await db.exec(sql);
  const rows = Array.from({ length: ALPHA_CHANGED + ALPHA_SAME }, (_, index) => ({ id: `a${index}`, supplier_price_list_code: `A${String(index).padStart(2, "0")}`, variant_name: `Size ${index}`, price: 100, currency: "EUR" }));
  const missing = [0, 1].map((index) => ({ id: `g${index}`, supplier_price_list_code: `G${index}`, variant_name: `Gamma ${index}`, price: 70, currency: "EUR" }));
  await db.exec(`update public.brands set stored_price_basis='list';
    insert into public.product_templates(id,brand_id,template_name,item_code,default_unit_price) values
      ('${alpha}','${brand}','ALPHA SCREEN',null,100),('${beta}','${brand}','BETA',  'B1',50),('${gamma}','${brand}','GAMMA',null,10),
      ('${delta1}','${brand}','DELTA ONE','D1',40),('${delta2}','${brand}','DELTA TWO','D1',40),('${epsilon}','${brand}','EPSILON','E1',30);`);
  await db.query("update public.product_templates set variant_pricing=$1 where id=$2", [JSON.stringify([{ id: "ga", items: rows }]), alpha]);
  await db.query("update public.product_templates set variant_pricing=$1 where id=$2", [JSON.stringify([{ id: "gg", items: missing }]), gamma]);
  const { client, calls } = pgClient(db);
  const { targets } = await supplierBrandTargets(client, brand);
  const target = (code: string, template?: string) => { const found = targets.find((item) => item.code === code && (!template || item.template_id === template)); assert.ok(found, code); return found; };
  const identity = (code: string, price: number, issues: string[] = []): SourceIdentity => ({ key: `id-${code}`, code, price_field: "unit_price", dimension: "", finishes: [], price, currency: "EUR", row_keys: [], issues });
  const match = (key: string, classification: PriceMatch["classification"], src: SourceIdentity | null, list: PriceTarget[]): PriceMatch => ({ key, source: src, targets: list, classification, comparison: null, candidate_shared: false });
  const identities: SourceIdentity[] = []; const matches: PriceMatch[] = [];
  const add = (key: string, classification: PriceMatch["classification"], price: number | null, list: PriceTarget[], code?: string, issues: string[] = []) => {
    const src = price === null ? null : identity(code ?? list[0].code, price, issues); if (src) identities.push(src); matches.push(match(key, classification, src, list));
  };
  for (let index = 0; index < ALPHA_CHANGED + ALPHA_SAME; index++) { const code = `A${String(index).padStart(2, "0")}`; add(`m-${code}`, index < ALPHA_CHANGED ? "increased" : "unchanged", index < ALPHA_CHANGED ? 110 : 100, [target(code)]); }
  add("m-b1", "decreased", 45, [target("B1", beta)]);
  add("m-g0", "target_not_represented", null, [target("G0")]); add("m-g1", "target_not_represented", null, [target("G1")]);
  if (withAttention) {
    add("m-d1", "shared", 35, [target("D1", delta1), target("D1", delta2)]);
    add("m-e1", "invalid_source", 30, [target("E1")], "E1", ["bad price"]);
  } else {
    add("m-d1", "unchanged", 40, [target("D1", delta1)]); add("m-d2", "unchanged", 40, [target("D1", delta2)], "D1"); add("m-e1", "unchanged", 30, [target("E1")]);
  }
  for (const code of ["ZZ1", "ZZ2", "ZZ3"]) add(`m-${code}`, "unmatched", 5, [], code);
  add("m-comp", "referenced_companion", null, []);
  await db.query(`insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,effective_from,received_at,expected_rows,expected_cells,expected_chunks,created_by)
    values($1,$2,'LAS Feb 2026','s.csv',$3,'csv','EUR','list','{}','imported','2026-01-15','2026-01-12',1,1,1,$4)`, [source, brand, "a".repeat(64), user]);
  for (const item of new Map(identities.map((entry) => [entry.key, entry])).values()) await db.query("insert into public.supplier_source_identities values($1,$2,$3,$4)", [source, item.key, item.code, JSON.stringify(item)]);
  await db.query(`insert into public.supplier_price_batches(id,brand_id,source_id,title,scope,selected_template_ids,status,expected_matches,expected_chunks,basis_warning,created_by) values($1,$2,$3,'Review','complete','{}','review',$4,1,'',$5)`, [batch, brand, source, matches.length, user]);
  for (const item of matches) await db.query("insert into public.supplier_price_matches values($1,$2,$3,$4,null,$5,$6)", [batch, item.key, item.source?.code ?? item.key, item.classification, [...new Set(item.targets.map((entry) => entry.template_id))], JSON.stringify(item)]);
  const snapshot = async () => ({
    templates: (await db.query<{ id: string; price: string; variant_pricing: unknown; version: string; last_price_checked_at: Date | null; last_price_checked_by: string | null }>("select id,default_unit_price::text price,variant_pricing,pricing_version::text version,last_price_checked_at,last_price_checked_by from public.product_templates order by id")).rows,
    history: (await db.query("select (select count(*) from public.product_template_price_history)::int a,(select count(*) from public.product_template_detail_price_history)::int b")).rows[0] as { a: number; b: number },
    quotations: (await db.query<{ total: string }>("select * from public.quotations")).rows, brands: (await db.query("select * from public.brands")).rows,
    updates: (await db.query("select status,coverage_mode from public.brand_price_list_updates")).rows,
  });
  const decisions = async () => Object.fromEntries((await db.query<{ key: string; decision: string; note: string }>("select key,decision,note from public.supplier_price_decisions order by key")).rows.map((row) => [row.key, row.decision + (row.note ? `:${row.note}` : "")]));
  const alphaKeys = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => `m-A${String(from + index).padStart(2, "0")}`);
  return { db, client, calls, snapshot, decisions, alphaKeys };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const overviewOf = async (f: Fixture) => supplierFamilyOverview(f.client, batch);

test("families group by Product Template with friendly counts; Supplier-only items stay out of Family counts", async () => {
  const f = await fixture();
  try {
    const overview = await overviewOf(f);
    const byName = Object.fromEntries(overview.families.map((family) => [family.template_name, family]));
    assert.deepEqual(overview.families.map((family) => family.template_name), ["ALPHA SCREEN", "BETA", "DELTA ONE", "DELTA TWO", "EPSILON", "GAMMA"]);
    assert.deepEqual({ items: byName["ALPHA SCREEN"].items, changed: byName["ALPHA SCREEN"].changed, same: byName["ALPHA SCREEN"].same, missing: byName["ALPHA SCREEN"].missing, attention: byName["ALPHA SCREEN"].attention, status: byName["ALPHA SCREEN"].status },
      { items: 25, changed: 22, same: 3, missing: 0, attention: 0, status: "needs_review" });
    assert.deepEqual({ changed: byName.BETA.changed, status: byName.BETA.status }, { changed: 1, status: "needs_review" });
    assert.deepEqual({ missing: byName.GAMMA.missing, items: byName.GAMMA.items, status: byName.GAMMA.status }, { missing: 2, items: 2, status: "needs_review" });
    for (const name of ["DELTA ONE", "DELTA TWO", "EPSILON"]) assert.deepEqual({ attention: byName[name].attention, status: byName[name].status }, { attention: 1, status: "needs_attention" }, name); // shared + invalid source
    assert.deepEqual(overview.supplierOnly, { unmatched: 3, companions: 1 });
    assert.deepEqual(overview.totals, { families: 6, ready: 0, changed: 23, same: 3, missing: 2, attention: 3 });
    assert.ok(overview.families.every((family) => family.items === family.changed + family.same + family.missing + family.attention + family.done));
  } finally { await f.db.close(); }
});

test("Family rows show friendly sections; Needs attention uses plain-language issues and never offers selection", async () => {
  const f = await fixture();
  try {
    const rows = async (template: string, section: "changed" | "same" | "missing" | "attention") => (await supplierFamilyRows(f.client, batch, template, section)).rows;
    const changed = await rows(alpha, "changed");
    assert.equal(changed.length, ALPHA_CHANGED); assert.deepEqual({ code: changed[0].code, current: changed[0].current, supplier: changed[0].supplier, change: changed[0].change, selectable: changed[0].selectable }, { code: "A00", current: "EUR 100", supplier: "EUR 110", change: "+10", selectable: true });
    assert.equal((await rows(alpha, "same")).length, ALPHA_SAME); assert.equal((await rows(alpha, "same"))[0].change, "Same");
    assert.deepEqual((await rows(gamma, "missing")).map((row) => [row.supplier, row.change, row.selectable]), [["Not listed", "Missing", true], ["Not listed", "Missing", true]]);
    const attention = await rows(delta1, "attention");
    assert.deepEqual(attention.map((row) => [row.issue, row.selectable, row.classification]), [["One Supplier item linked to multiple Product prices", false, "shared"]]);
    assert.equal((await rows(delta2, "attention")).length, 1); // a shared row is shown under every Family it touches
    assert.deepEqual((await rows(epsilon, "attention")).map((row) => row.issue), ["Source data problem"]);
    assert.equal((await rows(alpha, "attention")).length, 0);
    assert.ok((await rows(alpha, "changed")).every((row) => !/_/.test(row.issue + row.action + row.change)));
    await assert.rejects(supplierFamilyRows(f.client, batch, alpha, "unmatched" as never), /Unknown Family section/);
  } finally { await f.db.close(); }
});

test("bulk Apply changed: 22 rows, one transactional write, correct history and versions, no other side effects", async () => {
  const f = await fixture();
  try {
    const keys = f.alphaKeys(0, ALPHA_CHANGED), before = await f.snapshot();
    f.calls.length = 0;
    const result = await supplierBulkApplyChanged(f.client, batch, [...keys, "m-b1"]);
    assert.equal(result.message, "23 prices applied."); assert.equal(f.calls.filter((name) => name === "apply_supplier_shared_price_at_versions").length, 1);
    assert.ok(!f.calls.includes("write_product_price_with_history_at_version"));
    const after = await f.snapshot();
    assert.equal(after.history.b, ALPHA_CHANGED); assert.equal(after.history.a, 1);
    const alphaRow = (snapshot: typeof after) => snapshot.templates.find((row) => row.id === alpha)!;
    assert.equal(Number(alphaRow(after).version), Number(alphaRow(before).version) + ALPHA_CHANGED);
    const variants = (alphaRow(after).variant_pricing as Array<{ items: Array<{ id: string; price: number; variant_name: string }> }>)[0].items;
    assert.deepEqual([variants[0].price, variants[ALPHA_CHANGED - 1].price, variants[ALPHA_CHANGED].price, variants[0].variant_name], [110, 110, 100, "Size 0"]);
    assert.equal(after.templates.find((row) => row.id === beta)!.price, "45");
    assert.equal(after.quotations[0].total, before.quotations[0].total);
    assert.deepEqual(after.templates.map((row) => [row.last_price_checked_at, row.last_price_checked_by]), before.templates.map((row) => [row.last_price_checked_at, row.last_price_checked_by]));
    assert.deepEqual(after.brands, before.brands); assert.deepEqual(after.updates, before.updates);
    assert.equal((await f.db.query<{ price_field: string }>("select price_field from public.product_template_detail_price_history where source_record_id='a0'")).rows[0].price_field, "price");
    assert.match((await f.db.query<{ note: string }>("select note from public.product_template_detail_price_history limit 1")).rows[0].note, /LAS Feb 2026; batch: .*; match: m-A\d\d; bulk apply/);
    assert.equal((await f.decisions())["m-A00"], "reviewed"); assert.equal((await f.decisions())["m-b1"], "reviewed");
    // Applied rows leave the Changed section; a repeat from the old comparison is stale and writes nothing.
    assert.equal((await overviewOf(f)).families.find((family) => family.template_id === alpha)!.changed, 0);
    f.calls.length = 0; await assert.rejects(supplierBulkApplyChanged(f.client, batch, ["m-A00"]), /changed after this review started\. Nothing was applied\./);
    assert.deepEqual(f.calls, []); assert.deepEqual((await f.snapshot()).history, after.history);
  } finally { await f.db.close(); }
});

test("one stale or ineligible selected row blocks the whole bulk Apply with friendly errors", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot(); f.calls.length = 0;
    const keys = f.alphaKeys(0, 5);
    await f.db.query("update public.product_templates set default_unit_price=51 where id=$1", [beta]);
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, [...keys, "m-b1"]), /^Error: 1 selected item changed after this review started\. Nothing was applied\.$/);
    await f.db.query("update public.product_templates set default_unit_price=50 where id=$1", [beta]); // price restored but the version moved on
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, [...keys, "m-b1"]), /changed after this review started/);
    for (const [selection, message] of [[["m-d1"], /1 selected item needs attention\. Nothing was changed\./], [[...keys, "m-A22"], /1 selected item needs attention/], [["m-g0", "m-e1"], /2 selected items need attention/]] as const)
      await assert.rejects(supplierBulkApplyChanged(f.client, batch, [...selection]), message);
    await f.db.query("insert into public.supplier_price_decisions(batch_id,key,decision,reviewed_by) values($1,'m-A01','skip',$2)", [batch, user]);
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, keys), /needs attention/);
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, []), /Select at least one item/);
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, ["m-A00", "m-A00"]), /Select at least one item/);
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, ["missing"]), /not part of this review/);
    assert.equal(SUPPLIER_BULK_LIMIT, 50);
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, Array.from({ length: 51 }, (_, index) => `k${index}`)), /up to 50 items at a time/);
    assert.deepEqual(f.calls.filter((name) => name === "apply_supplier_shared_price_at_versions"), []);
    const after = await f.snapshot(); assert.deepEqual(after.history, before.history);
    assert.deepEqual(after.templates.map((row) => row.variant_pricing), before.templates.map((row) => row.variant_pricing));
  } finally { await f.db.close(); }
});

test("a database failure during bulk Apply rolls back every price and hides raw errors", async () => {
  const f = await fixture();
  try {
    await f.db.exec("create function fail_last() returns trigger language plpgsql as $$ begin if new.source_record_id='a21' then raise exception 'secret internal failure'; end if; return new; end $$; create trigger fail_last before insert on public.product_template_detail_price_history for each row execute function fail_last();");
    const before = await f.snapshot();
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, f.alphaKeys(0, ALPHA_CHANGED)), (error: Error) => error.message === "Prices could not be applied. Nothing was changed.");
    assert.deepEqual(await f.snapshot(), before); assert.deepEqual(await f.decisions(), {});
  } finally { await f.db.close(); }
});

test("bulk Confirm unchanged confirms many rows without any Product write and refuses stale or wrong rows", async () => {
  const f = await fixture();
  try {
    const keys = f.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + ALPHA_SAME);
    await assert.rejects(supplierBulkConfirmUnchanged(f.client, batch, [...keys, "m-A00"]), /1 selected item needs attention\. Nothing was changed\./);
    await f.db.query("update public.product_templates set variant_pricing=jsonb_set(variant_pricing,'{0,items,22,price}','101') where id=$1", [alpha]);
    await assert.rejects(supplierBulkConfirmUnchanged(f.client, batch, keys), /changed after this review started\. Nothing was confirmed\./);
    await f.db.query("update public.product_templates set variant_pricing=jsonb_set(variant_pricing,'{0,items,22,price}','100') where id=$1", [alpha]);
    // The price came back; pricing_version advanced meanwhile, but the exact target is intact, so confirmation is allowed.
    await supplierBulkConfirmUnchanged(f.client, batch, keys);
    assert.deepEqual(await f.decisions(), Object.fromEntries(keys.map((key) => [key, "confirmed_unchanged"])));
  } finally { await f.db.close(); }
  const g = await fixture();
  try {
    const keys = g.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + ALPHA_SAME), before = await g.snapshot();
    const result = await supplierBulkConfirmUnchanged(g.client, batch, keys);
    assert.equal(result.message, "3 unchanged prices confirmed.");
    assert.deepEqual(await g.decisions(), Object.fromEntries(keys.map((key) => [key, "confirmed_unchanged"])));
    assert.deepEqual(await g.snapshot(), before); // no price, version, history, check, Brand or quotation change
    assert.equal((await supplierFamilyOverview(g.client, batch)).families.find((family) => family.template_id === alpha)!.same, 0);
    await supplierBulkConfirmUnchanged(g.client, batch, keys); // idempotent
    assert.equal((await g.db.query("select * from public.supplier_price_decisions")).rows.length, 3);
    assert.deepEqual(await g.snapshot(), before);
  } finally { await g.db.close(); }
});

test("bulk Exclude missing needs one reason, applies it to every row, and never touches the Product", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    for (const reason of ["", "   "]) await assert.rejects(supplierBulkExcludeMissing(f.client, batch, ["m-g0", "m-g1"], reason), /reason is required/);
    await assert.rejects(supplierBulkExcludeMissing(f.client, batch, ["m-g0", "m-b1"], "why"), /1 selected item needs attention\. Nothing was changed\./);
    assert.deepEqual(await f.decisions(), {});
    const result = await supplierBulkExcludeMissing(f.client, batch, ["m-g0", "m-g1"], "  Not in this edition  ");
    assert.equal(result.message, "2 items excluded from this Supplier source.");
    assert.deepEqual(await f.decisions(), { "m-g0": "excluded_from_source:Not in this edition", "m-g1": "excluded_from_source:Not in this edition" });
    assert.deepEqual(await f.snapshot(), before);
    assert.deepEqual((await supplierFamilyOverview(f.client, batch)).families.find((family) => family.template_id === gamma), { template_id: gamma, template_name: "GAMMA", items: 2, changed: 0, same: 0, missing: 0, attention: 0, done: 2, excluded: 2, status: "ready" });
  } finally { await f.db.close(); }
});

test("with every row resolved through Family actions, Family progress reads ready and Phase 2D completion stays authoritative", async () => {
  const f = await fixture({ withAttention: false });
  try {
    // Natural order: apply Changed first, then confirm Same rows in the same Templates.
    await supplierBulkApplyChanged(f.client, batch, [...f.alphaKeys(0, ALPHA_CHANGED), "m-b1"]);
    await assert.rejects(supplierCompleteReview(f.client, batch), /unresolved rows/);
    await supplierBulkConfirmUnchanged(f.client, batch, [...f.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + ALPHA_SAME), "m-d1", "m-d2", "m-e1"]);
    await assert.rejects(supplierCompleteReview(f.client, batch), /unresolved rows/); // Missing rows still block
    await supplierBulkExcludeMissing(f.client, batch, ["m-g0", "m-g1"], "Not in this edition");
    const overview = await overviewOf(f);
    assert.deepEqual(overview.totals, { families: 6, ready: 6, changed: 0, same: 0, missing: 0, attention: 0 });
    const result = await supplierCompleteReview(f.client, batch);
    assert.equal(result.checked_templates, 5); assert.equal(result.excluded_templates, 1); // GAMMA stays unchecked
    const checked = (await f.db.query<{ template_name: string; last_price_checked_at: Date | null }>("select template_name,last_price_checked_at from public.product_templates order by template_name")).rows;
    assert.deepEqual(checked.map((row) => [row.template_name, row.last_price_checked_at !== null]), [["ALPHA SCREEN", true], ["BETA", true], ["DELTA ONE", true], ["DELTA TWO", true], ["EPSILON", true], ["GAMMA", false]]);
    assert.equal((await overviewOf(f)).families.every((family) => family.status === "completed"), true);
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

test("bulk actions are approver-only and the browser sends only batch id, match keys and a reason", async () => {
  let role = "sales_designer"; const calls: unknown[][] = [];
  const spy = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args.slice(1)]); return { message: "ok" }; };
  const actions = await loadTestModule<typeof import("../../app/products/price-updates/supplier-sources/actions.js")>("../../app/products/price-updates/supplier-sources/actions.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { async requireBrandPriceReviewer() { return { profile: { role, account_status: "active" } }; } },
    "@/lib/supabase/server": { async createClient() { return {}; } },
    "@/lib/products/supplier-price-repository": { supplierBulkApplyChanged: spy("apply"), supplierBulkConfirmUnchanged: spy("confirm"), supplierBulkExcludeMissing: spy("exclude"),
      supplierApplyReviewedPrice() {}, supplierConfirmUnchangedPrice() {}, supplierCompleteReview() {}, supplierCompletionReadiness() {}, supplierExcludeTargetFromSource() {}, supplierBrandMatches() {}, supplierBrandTargets() {}, supplierMatchChunks() {}, supplierSource() {}, supplierWrite() {} },
  });
  const run = [() => actions.bulkApplySupplierChangedPrices(batch, ["a"]), () => actions.bulkConfirmSupplierUnchanged(batch, ["a"]), () => actions.bulkExcludeSupplierMissing(batch, ["a"], "why")];
  for (const call of run) await assert.rejects(call(), /approver permission required/);
  assert.equal(calls.length, 0); role = "procurement_manager";
  await (actions.bulkApplySupplierChangedPrices as (...args: unknown[]) => Promise<unknown>)(batch, ["a", "b"], { price: 1, target: "forged", pricing_version: 9 });
  await actions.bulkConfirmSupplierUnchanged(batch, ["a"]); await actions.bulkExcludeSupplierMissing(batch, ["a"], "why");
  assert.deepEqual(calls, [["apply", batch, ["a", "b"]], ["confirm", batch, ["a"]], ["exclude", batch, ["a"], "why"]]);
});

test("selection helpers are bounded; Family UI is simple, gated, and resets selection per batch, family and section", async () => {
  const f = await fixture();
  try {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const ui = await loadTestModule<typeof import("../../components/products/supplier-family-review.js")>("../../components/products/supplier-family-review.tsx", {
      "next/link": { default: (props: { href: string; children: unknown }) => createElement("a", { href: props.href }, props.children as never) },
      "next/navigation": { useRouter() { return { refresh() {} }; } },
      "@/app/products/price-updates/supplier-sources/actions": {},
    });
    const keys = Array.from({ length: 80 }, (_, index) => `k${index}`);
    assert.deepEqual(ui.selectAllKeys(keys, 50).keys.length, 50); assert.equal(ui.selectAllKeys(keys, 50).truncated, true); assert.equal(ui.selectAllKeys(keys.slice(0, 10), 50).truncated, false);
    let selection: string[] = []; for (const key of keys) selection = ui.toggleKey(selection, key, true, 50);
    assert.equal(selection.length, 50); assert.deepEqual(ui.toggleKey(selection, "k0", false, 50).length, 49); assert.equal(ui.toggleKey(["k1"], "k1", true, 50).length, 1);
    const overview = await overviewOf(f);
    const list = renderToStaticMarkup(createElement(ui.SupplierFamilyList, { overview, links: overview.families.map((family) => ({ template_id: family.template_id, href: `/x?family=${family.template_id}` })), advancedHref: "/x?view=advanced", supplierOnlyHref: "/x?status=unmatched" }));
    assert.match(list, /6 Families/); assert.match(list, /ALPHA SCREEN/); assert.match(list, /Needs attention/); assert.match(list, /Advanced \/ Technical Review/);
    assert.match(list, /Supplier-only items: 3/); assert.match(list, /View in Advanced Review/); assert.doesNotMatch(list, /target_not_represented|baseline_drift|pricing_version|unmatched</);
    assert.match(renderToStaticMarkup(createElement(ui.SupplierBrandProgress, { overview })), /Families ready<\/dt><dd[^>]*>0 \/ 6/);
    const rows = (await supplierFamilyRows(f.client, batch, alpha, "changed")).rows.slice(0, 3);
    const tabs = (["changed", "same", "missing", "attention"] as const).map((section) => ({ section, label: section, count: 1, href: `/x?section=${section}` }));
    const table = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ui.SupplierFamilyTable, { batchId: batch, familyName: "ALPHA SCREEN", section: "changed", tabs, rows, truncated: false, approver: true, batchOpen: true, limit: 50, backHref: "/x", detailsHref: "/x?view=advanced", ...props } as never));
    assert.equal((table().match(/type="checkbox"/g) ?? []).length, 3); assert.match(table(), />Select all</); assert.match(table(), />Clear selection</); assert.match(table(), /0 selected/); assert.match(table(), /Back to Family Review/);
    assert.doesNotMatch(table({ approver: false }), /type="checkbox"/); assert.match(table({ approver: false }), /An approver applies, confirms or excludes items\./);
    assert.doesNotMatch(table({ batchOpen: false }), /type="checkbox"/);
    const attention = (await supplierFamilyRows(f.client, batch, delta1, "attention")).rows;
    const attentionHtml = table({ section: "attention", rows: attention });
    assert.doesNotMatch(attentionHtml, /type="checkbox"/); assert.match(attentionHtml, /Review details/); assert.match(attentionHtml, /One Supplier item linked to multiple Product prices/); assert.match(attentionHtml, /status=shared/);
    assert.match(table({ section: "same", rows: [] }), /No unchanged prices waiting for confirmation\./);
    // Selection state lives inside the keyed table, so navigating batch, Family or section remounts it with nothing selected.
    const page = await readFile(new URL("../../app/products/price-updates/supplier-sources/page.tsx", import.meta.url), "utf8");
    assert.match(page, /<SupplierFamilyTable key=\{`\$\{batch\.id\}:\$\{family\.template_id\}:\$\{section\}`\}/);
    assert.match(page, /view === "family"/); assert.match(page, /View in Advanced|Advanced \/ Technical Review|view: "advanced"/); assert.match(page, /Back to Family Review/);
    const component = await readFile(new URL("../../components/products/supplier-family-review.tsx", import.meta.url), "utf8");
    assert.match(component, /useState<string\[\]>\(\[\]\)/);
  } finally { await f.db.close(); }
});

test("Same rows stay confirmable after Changed rows in the same Template are applied; only a drifted target blocks", async () => {
  const f = await fixture();
  try {
    const same = f.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + ALPHA_SAME);
    const priceOf = async (rowId: string) => (await f.db.query<{ variant_pricing: Array<{ items: Array<{ id: string; price: number }> }> }>("select variant_pricing from public.product_templates where id=$1", [alpha])).rows[0].variant_pricing[0].items.find((item) => item.id === rowId)!.price;
    const version = async () => Number((await f.db.query<{ v: string }>("select pricing_version::text v from public.product_templates where id=$1", [alpha])).rows[0].v);
    const v0 = await version();
    await supplierBulkApplyChanged(f.client, batch, f.alphaKeys(0, 2)); // Apply first: the Template's pricing_version advances.
    assert.equal(await version(), v0 + 2);
    // The Same rows are still Same, not Needs attention, and the bulk Apply guard for other changed rows is unchanged.
    const family = (await overviewOf(f)).families.find((item) => item.template_id === alpha)!;
    assert.deepEqual({ same: family.same, attention: family.attention }, { same: ALPHA_SAME, attention: ALPHA_CHANGED - 2 });
    assert.equal((await supplierFamilyRows(f.client, batch, alpha, "same")).rows.length, ALPHA_SAME);
    await assert.rejects(supplierBulkApplyChanged(f.client, batch, ["m-A05"]), /changed after this review started\. Nothing was applied\./);
    const before = await f.snapshot();
    // Single confirmation after the version moved on.
    await supplierConfirmUnchangedPrice(f.client, batch, same[0]);
    assert.equal((await f.decisions())[same[0]], "confirmed_unchanged");
    // Bulk confirmation of the rest.
    assert.equal((await supplierBulkConfirmUnchanged(f.client, batch, same.slice(1))).message, "2 unchanged prices confirmed.");
    const after = await f.snapshot();
    assert.deepEqual(after.history, before.history); assert.deepEqual(after.templates, before.templates); assert.deepEqual(after.brands, before.brands); assert.equal(await version(), v0 + 2);
    assert.equal(await priceOf("a22"), 100);
    assert.equal((await overviewOf(f)).families.find((item) => item.template_id === alpha)!.same, 0);
    assert.equal((await f.db.query("select * from public.product_template_detail_price_history where source_record_id=any($1::text[])", [["a22", "a23", "a24"]])).rows.length, 0);
  } finally { await f.db.close(); }
  // Target-specific drift still rejects, single and bulk, with the fresh-comparison error.
  const drifts: Array<[string, string]> = [
    ["price", "jsonb_set(variant_pricing,'{0,items,22,price}','101')"],
    ["currency", "jsonb_set(variant_pricing,'{0,items,22,currency}','\"USD\"')"],
    ["code", "jsonb_set(variant_pricing,'{0,items,22,supplier_price_list_code}','\"OTHER\"')"],
    ["row id", "jsonb_set(variant_pricing,'{0,items,22,id}','\"moved\"')"],
    ["removed row", "jsonb_set(variant_pricing,'{0,items}',(variant_pricing->0->'items')-22)"],
  ];
  for (const [name, change] of drifts) {
    const g = await fixture();
    try {
      const key = g.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + 1)[0];
      await g.db.query(`update public.product_templates set variant_pricing=${change} where id=$1`, [alpha]);
      const before = await g.snapshot();
      await assert.rejects(supplierConfirmUnchangedPrice(g.client, batch, key), /Build a fresh Supplier comparison before confirming\./, name);
      await assert.rejects(supplierBulkConfirmUnchanged(g.client, batch, [key]), /(changed after this review started|needs attention)/, name);
      assert.deepEqual(await g.decisions(), {}); assert.deepEqual(await g.snapshot(), before);
      const family = (await supplierFamilyOverview(g.client, batch)).families.find((item) => item.template_id === alpha)!;
      assert.equal(family.status, "needs_attention", name); assert.equal(family.same, ALPHA_SAME - 1, name);
    } finally { await g.db.close(); }
  }
});
