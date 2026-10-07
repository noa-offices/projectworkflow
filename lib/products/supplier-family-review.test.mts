import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
  SUPPLIER_BULK_LIMIT, supplierConfirmUnchangedPrice, supplierBrandTargets, supplierBulkApplyChanged, supplierBulkConfirmUnchanged, supplierBulkExcludeMissing, supplierCompleteReview, supplierCompletionReadiness, supplierReviewRowState, supplierFamilyOverview, supplierFamilyRows, familyTierPanel, supplierWrite, supplierFamilyUnchangedMatchKeys,
} from "./supplier-price-repository.js";
import type { PriceMatch, PriceTarget, SourceIdentity, SourceVersion } from "./supplier-price-contracts.js";

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
      return { select(columns?: string) { embed = Boolean(columns?.includes("supplier_price_decisions(")); return this; }, eq(key: string, value: unknown) { filters.push([key, value]); return this; }, in(key: string, values: unknown[]) { assert.ok(key !== "key" || !values.some((value) => typeof value === "string" && value.includes('"')), "JSON-like identity/match keys must not use unescaped PostgREST in()"); inFilters.push([key, values]); return this; },
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

test("atomic dimension replacement retains ID/scope, rolls back invalid changes, and leaves pricing and batches untouched", async () => {
  const f = await fixture();
  try {
    await f.db.exec(await read("20261006054910_supplier_dimension_atomic_replace"));
    await f.db.query("update product_templates set category_pricing=$1 where id=$2", [JSON.stringify([{ id: "tier-group", price_columns: [{ id: "b", label: "Cat B", dimension_code: "cat_b" }, { id: "h", label: "Cat H", dimension_code: "cat_h" }], items: [{ id: "tier-row", supplier_price_list_code: "LEAD", prices: { b: 100, h: 110 } }] }]), alpha]);
    const targets = (await supplierBrandTargets(f.client, brand)).targets;
    const target = targets.find((item) => item.dimension === "cat_h")!;
    const base = { brand_id: brand, template_id: alpha, group_id: "tier-group", raw_labels: ["H"], finish_codes: [], dimension_code: "cat_b" };
    const created = await supplierWrite(f.client, "dimension", base);
    const before = await f.snapshot();
    const batchesBefore = (await f.db.query("select * from supplier_price_batches")).rows;
    const matchesBefore = (await f.db.query("select * from supplier_price_matches order by key")).rows;
    const ruleBefore = (await f.db.query("select * from supplier_dimension_vocabulary where id=$1", [created.id])).rows[0];
    const replace = { ...base, id: created.id, dimension_code: "cat_h", target };
    for (const invalid of [{ ...replace, brand_id: id(999) }, { ...replace, dimension_code: "cat_invalid" }, { ...replace, group_id: "wrong" }, { ...replace, raw_labels: [] }, { ...replace, target: { ...target, dimension: "cat_invalid" }, dimension_code: "cat_invalid" }]) {
      await assert.rejects(supplierWrite(f.client, "dimension_replace", invalid));
      assert.deepEqual((await f.db.query("select * from supplier_dimension_vocabulary where id=$1", [created.id])).rows[0], ruleBefore);
    }
    await f.db.exec("update permissions set can_approve=false");
    await assert.rejects(supplierWrite(f.client, "dimension_replace", replace), /insufficient_privilege/);
    await f.db.exec("update permissions set can_approve=true");
    await f.db.exec("create function fail_mapping_update() returns trigger language plpgsql as $$ begin raise exception 'mapping update failed'; end $$; create trigger fail_mapping before update on supplier_dimension_vocabulary for each row execute function fail_mapping_update();");
    await assert.rejects(supplierWrite(f.client, "dimension_replace", replace), /mapping update failed/);
    assert.deepEqual((await f.db.query("select * from supplier_dimension_vocabulary where id=$1", [created.id])).rows[0], ruleBefore);
    await f.db.exec("drop trigger fail_mapping on supplier_dimension_vocabulary");
    assert.equal((await supplierWrite(f.client, "dimension_replace", replace)).id, created.id);
    const rules = (await f.db.query<{ id: string; dimension_code: string; template_id: string; group_id: string; confirmed_by: string; is_active: boolean }>("select * from supplier_dimension_vocabulary")).rows;
    assert.equal(rules.length, 1); assert.deepEqual([rules[0].id, rules[0].dimension_code, rules[0].template_id, rules[0].group_id, rules[0].confirmed_by, rules[0].is_active], [created.id, "cat_h", alpha, "tier-group", user, true]);
    // Both optional scopes are also valid at Brand level.
    const global = await supplierWrite(f.client, "dimension", { ...base, template_id: undefined, group_id: undefined, raw_labels: ["GLOBAL"] });
    await supplierWrite(f.client, "dimension_replace", { ...base, id: global.id, template_id: undefined, group_id: undefined, raw_labels: ["GLOBAL"], dimension_code: "cat_h", target });
    await supplierWrite(f.client, "archive_dimension", { id: global.id });
    assert.equal((await f.db.query<{ is_active: boolean }>("select is_active from supplier_dimension_vocabulary where id=$1", [global.id])).rows[0].is_active, false);
    await assert.rejects(supplierWrite(f.client, "dimension_replace", { ...replace, id: global.id }));
    assert.deepEqual(await f.snapshot(), before);
    assert.deepEqual((await f.db.query("select * from supplier_price_batches")).rows, batchesBefore);
    assert.deepEqual((await f.db.query("select * from supplier_price_matches order by key")).rows, matchesBefore);
  } finally { await f.db.close(); }
});

test("eight LAS-style H rows become one tier task; mapped scopes, suggestions and readonly panel remain accurate", async () => {
  const f = await fixture();
  try {
    const target = { ...(await supplierBrandTargets(f.client, brand)).targets[0], dimension: "cat_h", group_id: "tiers" };
    const labels = ["B", "C", "D", "E", "F", "G", "I"];
    const targets = [...labels, "H"].map((label) => ({ ...target, key: label, dimension: `cat_${label.toLowerCase()}` }));
    const rules = labels.map((label, index) => ({ id: id(70 + index), brand_id: brand, raw_labels: [label], finish_codes: [], dimension_code: `cat_${label.toLowerCase()}`, ...(index === 1 ? { template_id: alpha } : index === 2 ? { template_id: alpha, group_id: "tiers" } : {}) }));
    const matches: PriceMatch[] = Array.from({ length: 8 }, (_, index) => ({ key: `h-${index}`, source: { key: `h-${index}`, code: `1410${index}`, dimension: "H", raw_dimension: "H", finishes: [], price_field: "unit_price", currency: "EUR", price: 110, issues: [], row_keys: [] }, targets: [target], classification: "needs_dimension_mapping", candidate_shared: false }));
    const before = structuredClone(matches);
    const panel = familyTierPanel(matches, targets, rules, alpha);
    assert.equal(panel.unresolved.length, 1); assert.equal(panel.unresolved[0].label, "H"); assert.equal(panel.unresolved[0].affected, 8); assert.deepEqual(panel.unresolved[0].dimensions, targets.map((item) => item.dimension).sort());
    assert.equal(panel.mapped.length, 7); assert.deepEqual(panel.mapped.slice(0, 3).map((item) => item.scope), ["Brand", "Template", "Group"]);
    const { createElement } = await import("react"); const { renderToStaticMarkup } = await import("react-dom/server");
    const ui = await loadTestModule<typeof import("../../components/products/supplier-family-review.js")>("../../components/products/supplier-family-review.tsx", { "next/link": { default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }, "next/navigation": { useRouter() { return { refresh() {} }; } }, "@/app/products/price-updates/supplier-sources/actions": {} });
    assert.equal(ui.suggestSupplierTier("H", panel.unresolved[0].dimensions), "cat_h"); assert.equal(ui.suggestSupplierTier("J", ["cat_j", "cat_z"]), "cat_j"); assert.equal(ui.suggestSupplierTier("H", ["cat_b"]), ""); assert.equal(ui.suggestSupplierTier("H", ["cat_h", "tier_h"]), "");
    const forSource = (value: typeof panel) => ({ unmapped: value.unresolved.filter((task) => !task.hasRule).map((task) => ({ ...task, scopeName: "LEAD / Upholstery pricing", finishLabel: "Supplier finishes" })), ambiguous: [], mapped: value.mapped.map((item) => ({ ...item, label: item.rule.raw_labels.join(", "), scopeName: item.scope === "Brand" ? "Brand" : item.scope === "Template" ? "LEAD" : "LEAD / Upholstery pricing" })) });
    const html = (approver: boolean) => renderToStaticMarkup(createElement(ui.SupplierTierMappingPanel, { panel: forSource(panel), brandId: brand, sourceId: source, approver }));
    assert.match(html(true), /1 unmapped/); assert.match(html(true), /Affects 8 Product rows/); assert.match(html(true), /value="cat_h" selected=""/); assert.match(html(true), /Mapped Supplier tiers \(7\)/); assert.doesNotMatch(html(true), /<details[^>]*open/);
    for (const text of [">Save mapping<", ">Edit<", ">Unmap<", "Scope: Brand", "Scope: LEAD", "LEAD / Upholstery pricing", "View affected codes"]) assert.ok(html(true).includes(text), text);
    for (const text of [">Save mapping<", ">Edit<", ">Unmap<"]) assert.ok(!html(false).includes(text), text);
    const mapped = familyTierPanel(matches, targets, [...rules, { id: id(90), brand_id: brand, template_id: alpha, group_id: "tiers", raw_labels: ["H"], finish_codes: [], dimension_code: "cat_h" }], alpha);
    assert.equal(mapped.unresolved[0].mappedDimension, "cat_h");
    const mappedHtml = renderToStaticMarkup(createElement(ui.SupplierTierMappingPanel, { panel: forSource(mapped), brandId: brand, sourceId: source, approver: true }));
    assert.doesNotMatch(mappedHtml, />Save mapping</); assert.deepEqual(matches, before);
    const component = await readFile(new URL("../../components/products/supplier-family-review.tsx", import.meta.url), "utf8");
    assert.match(component, /replaceSupplierDimension\(rule.id, brandId, dimension\)/); assert.match(component, /archiveSupplierDimension\(rule.id\)/); assert.match(component, /window.confirm/); assert.match(component, /refreshSupplierReviewAfterMapping/); assert.doesNotMatch(component, /cat_h|supplier_source_rows|supplier_source_cells/);
    const familyBody = component.slice(component.indexOf("export function SupplierFamilyTable")); assert.doesNotMatch(familyBody, /<SupplierTierMappingPanel|saveSupplierDimension|Save mapping/);
    const page = await readFile(new URL("../../app/products/price-updates/supplier-sources/page.tsx", import.meta.url), "utf8");
    assert.ok(page.indexOf("{sourceSummary}") < page.indexOf("<SupplierTierMappingPanel")); assert.ok(page.indexOf("<SupplierTierMappingPanel") < page.indexOf("{main}"));
  } finally { await f.db.close(); }
});

test("panel saves only on confirmation; Edit calls atomic replacement and Unmap confirms archive", async () => {
  const calls: unknown[][] = [];
  let state: unknown[] = [], cursor = 0;
  const ui = await loadTestModule<typeof import("../../components/products/supplier-family-review.js")>("../../components/products/supplier-family-review.tsx", {
    react: { useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], (value: unknown) => { state[index] = value; }]; } },
    "next/link": {}, "next/navigation": { useRouter() { return { refresh() {} }; } },
    "@/app/products/price-updates/supplier-sources/actions": {
      async saveSupplierDimension(...args: unknown[]) { calls.push(["save", ...args]); },
      async replaceSupplierDimension(...args: unknown[]) { calls.push(["replace", ...args]); },
      async archiveSupplierDimension(...args: unknown[]) { calls.push(["archive", ...args]); },
    },
  });
  type Element = { type: unknown; props: Record<string, unknown> };
  const find = (node: unknown, predicate: (element: Element) => boolean): Element | undefined => {
    if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as Element;
    return predicate(element) ? element : find(element.props.children, predicate);
  };
  const render = (element: Element) => { cursor = 0; return (element.type as (props: unknown) => unknown)(element.props); };
  const click = async (node: unknown, label: string) => { const button = find(node, (element) => element.type === "button" && element.props.children === label); assert.ok(button, label); (button.props.onClick as () => void)(); await new Promise<void>((resolve) => setImmediate(resolve)); };
  const panel = ui.SupplierTierMappingPanel({ panel: { unmapped: [{ key: "h", label: "H", templateId: alpha, groupId: null, rawLabels: ["H"], finishCodes: [], dimensions: ["cat_h"], mode: "raw_label", affected: 8, codes: ["LEAD"], mappedDimension: null, hasRule: false, scopeName: "LEAD", finishLabel: "Supplier finishes" }], ambiguous: [], mapped: [{ rule: { id: "rule", brand_id: brand, raw_labels: ["B"], finish_codes: [], dimension_code: "cat_b" }, dimensions: ["cat_b", "cat_h"], affected: 1, scope: "Brand", scopeName: "Brand", label: "B" }] }, brandId: brand, sourceId: source, approver: true });
  const unresolvedElement = find(panel, (element) => typeof element.type === "function" && "task" in element.props)!;
  const onChangeAction = async (work: () => Promise<unknown>) => { await work(); };
  const unresolved = { ...unresolvedElement, props: { ...unresolvedElement.props, onChangeAction } };
  state = []; let node = render(unresolved);
  assert.deepEqual(calls, [], "suggestion must not save automatically");
  await click(node, "Save mapping");
  assert.deepEqual(calls[0], ["save", { brand_id: brand, template_id: alpha, group_id: undefined, raw_labels: ["H"], finish_codes: [], dimension_code: "cat_h" }]);
  const mappedElement = find(panel, (element) => typeof element.type === "function" && "item" in element.props)!;
  // This hook harness renders each child separately; its parent state has its own store in React.
  const mapped = { ...mappedElement, props: { ...mappedElement.props, onChangeAction } };
  state = []; node = render(mapped); await click(node, "Edit"); node = render(mapped);
  const select = find(node, (element) => element.type === "select")!;
  (select.props.onChange as (event: unknown) => void)({ target: { value: "cat_h" } }); node = render(mapped);
  await click(node, "Save changes"); assert.deepEqual(calls[1], ["replace", "rule", brand, "cat_h"]);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => false } });
    node = render(mapped); await click(node, "Unmap"); assert.equal(calls.length, 2);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } });
    await click(node, "Unmap"); assert.deepEqual(calls[2], ["archive", "rule"]);
  } finally { if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window"); }
});

test("source panel selects the rebuilt review; no-batch/historical changes stay on future comparisons", async () => {
  const pushes: string[] = []; const refreshes: unknown[][] = []; let states: unknown[] = [], cursor = 0; let newId: string | null = "new-batch";
  const ui = await loadTestModule<typeof import("../../components/products/supplier-family-review.js")>("../../components/products/supplier-family-review.tsx", {
    react: { useState(initial: unknown) { const index = cursor++; states[index] = initial; return [initial, (value: unknown) => { states[index] = value; }]; } },
    "next/navigation": { useRouter() { return { push(url: string) { pushes.push(url); }, refresh() {} }; } }, "next/link": {},
    "@/app/products/price-updates/supplier-sources/actions": { async refreshSupplierReviewAfterMapping(...args: unknown[]) { refreshes.push(args); return { id: newId }; } },
  });
  const task = { key: "h", label: "H", templateId: alpha, groupId: null, rawLabels: ["H"], finishCodes: [], dimensions: ["cat_h"], mode: "raw_label" as const, affected: 8, codes: [], mappedDimension: null, hasRule: false, scopeName: "LEAD", finishLabel: "Supplier finishes" };
  let writes = 0;
  const run = async (batchId: string | undefined, approver: boolean) => {
    states = []; cursor = 0;
    const panel = ui.SupplierTierMappingPanel({ panel: { unmapped: [task], mapped: [], ambiguous: [] }, brandId: brand, sourceId: source, batchId, approver });
    const children = panel.props.children as Array<unknown>;
    const tasks = children[2] as Array<{ props: { onChangeAction: (work: () => Promise<void>) => Promise<void> } }>;
    await tasks[0].props.onChangeAction(async () => { writes++; });
  };
  await run(batch, true); assert.equal(writes, 1); assert.deepEqual(refreshes[0], [source, batch]);
  assert.equal(new URL(pushes[0], "https://test.local").searchParams.get("batch"), "new-batch");
  newId = null; await run(undefined, true); assert.match(String(states[0]), /future comparisons/); assert.equal(pushes.length, 1);
  await run(batch, false); assert.equal(writes, 2); assert.equal(refreshes.length, 2);
});

test("source mapping renders friendly scope and collapsed finish lists without UUIDs", async () => {
  const { createElement } = await import("react"); const { renderToStaticMarkup } = await import("react-dom/server");
  const ui = await loadTestModule<typeof import("../../components/products/supplier-family-review.js")>("../../components/products/supplier-family-review.tsx", { "next/link": {}, "next/navigation": { useRouter() { return { refresh() {} }; } }, "@/app/products/price-updates/supplier-sources/actions": {} });
  const finishes = Array.from({ length: 15 }, (_, index) => `FINISH${index}`);
  const html = renderToStaticMarkup(createElement(ui.SupplierTierMappingPanel, { panel: { unmapped: [], ambiguous: [], mapped: [{ rule: { id: id(80), brand_id: brand, template_id: alpha, group_id: id(81), raw_labels: [], finish_codes: finishes, dimension_code: "melamine" }, dimensions: ["melamine"], affected: 15, scope: "Group", scopeName: "LEAD / Upholstery pricing", label: "Melamine finishes (15)" }] }, brandId: brand, sourceId: source, approver: true }));
  assert.match(html, /Melamine finishes \(15\)/); assert.match(html, /Scope: LEAD \/ Upholstery pricing/); assert.doesNotMatch(html, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  assert.match(html, /<details[^>]*><summary[^>]*>View finish codes<\/summary>/); assert.doesNotMatch(html, /<details[^>]*open/);
});

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

test("JSON-like Supplier match keys use exact current-batch membership rather than PostgREST in() serialization", async () => {
  const keys = [JSON.stringify(["1AJM33", "unit_price", ""]), JSON.stringify(["1AJM34", "unit_price", ""]), JSON.stringify(["141085", "unit_price", "B"])];
  let request = "";
  const postgrest = new PostgrestClient("https://example.test/rest/v1", { fetch: async (input) => { request = String(input); return new Response("[]", { headers: { "content-type": "application/json" } }); } });
  await postgrest.from("supplier_price_matches").select("key").eq("batch_id", batch).in("key", keys);
  const serialized = new URL(request).searchParams.get("key")!;
  assert.equal(serialized, `in.("${keys[0]}","${keys[1]}","${keys[2]}")`); // embedded quotes are not escaped by postgrest-js

  const f = await fixture({ withAttention: false });
  try {
    const original = f.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + ALPHA_SAME);
    for (let index = 0; index < keys.length; index++) await f.db.query("update supplier_price_matches set key=$1,data=jsonb_set(data,'{key}',to_jsonb($1::text)) where batch_id=$2 and key=$3", [keys[index], batch, original[index]]);
    await supplierBulkConfirmUnchanged(f.client, batch, keys);
    assert.deepEqual(await f.decisions(), Object.fromEntries(keys.map((key) => [key, "confirmed_unchanged"])));

    const otherBatch = id(999);
    const otherBatchKey = JSON.stringify(["OTHER-BATCH", "unit_price", ""]);
    await f.db.query(
      "insert into supplier_price_batches(id,brand_id,source_id,title,scope,selected_template_ids,status,expected_matches,expected_chunks,basis_warning,created_by) select $1,brand_id,source_id,'Other','complete','{}','review',1,1,'',$2 from supplier_price_batches where id=$3",
      [otherBatch, user, batch]
    );
    await f.db.query(
      "insert into supplier_price_matches(batch_id,key,code,classification,comparison,template_ids,data) select $1,$2,code,classification,comparison,template_ids,jsonb_set(data,'{key}',to_jsonb($2::text)) from supplier_price_matches where batch_id=$3 and key=$4",
      [otherBatch, otherBatchKey, batch, keys[0]]
    );
    await assert.rejects(
      supplierBulkConfirmUnchanged(f.client, batch, [otherBatchKey]),
      /Some selected items are not part of this review\./
    );
    await assert.rejects(supplierBulkConfirmUnchanged(f.client, batch, [...keys.slice(0, 2), JSON.stringify(["OTHER", "unit_price", ""])]), /Some selected items are not part of this review\./);
    const otherFamily = await supplierFamilyUnchangedMatchKeys(f.client, batch, delta1);
    assert.deepEqual(otherFamily, ["m-d1"]); // another Family is neither selected nor returned
  } finally { await f.db.close(); }
});

test("Family unchanged shortcut derives only current-batch, current-Family, undecided match keys and the backend guard is unchanged", async () => {
  const f = await fixture({ withAttention: false });
  try {
    const before = await f.snapshot();
    const sameKeys = f.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + ALPHA_SAME);
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha), []); // unresolved Changed rows prohibit the Family shortcut
    await f.db.query("delete from supplier_price_matches where batch_id=$1 and key=any($2::text[])", [batch, f.alphaKeys(0, ALPHA_CHANGED)]);
    const derived = await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha);
    assert.deepEqual(derived, sameKeys); // only Alpha's Same rows; its changed rows and every other Family's rows are absent
    const stored = new Set((await f.db.query<{ key: string }>("select key from public.supplier_price_matches where batch_id=$1", [batch])).rows.map((row) => row.key));
    assert.ok(derived.every((key) => stored.has(key))); // every key is a supplier_price_matches.key of this batch
    const targetKeys = new Set((await supplierBrandTargets(f.client, brand)).targets.map((target) => target.key));
    assert.ok(!derived.some((key) => targetKeys.has(key))); // never a target id
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, delta1), ["m-d1"]);
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, delta2), ["m-d2"]);
    await supplierBulkConfirmUnchanged(f.client, batch, derived.slice(0, 1)); // already confirmed rows leave the shortcut
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha), derived.slice(1));
    await assert.rejects(supplierBulkConfirmUnchanged(f.client, batch, [...derived.slice(1), "target:not-a-match"]), /Some selected items are not part of this review\./); // fail-closed guard unchanged
    assert.deepEqual(await f.decisions(), { [derived[0]]: "confirmed_unchanged" }); // the rejected submission wrote nothing
    await supplierBulkConfirmUnchanged(f.client, batch, derived.slice(1));
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha), []);
    await assert.rejects(supplierFamilyUnchangedMatchKeys(f.client, batch, ""), /Product family required/);
    const { rows: [sameRow] } = { rows: await supplierFamilyRows(f.client, batch, alpha, "same").then((result) => result.rows) };
    assert.equal(sameRow.selectable, false);
    const after = await f.snapshot(); // no price, version, history, quotation or Brand change
    assert.deepEqual(after.templates, before.templates); assert.deepEqual(after.history, before.history); assert.deepEqual(after.quotations, before.quotations);
  } finally { await f.db.close(); }
});

test("Family shortcut chunks by the bulk limit, stops on any change since render, and maps only the membership error to a friendly message", async () => {
  const ui = await loadTestModule<typeof import("../../components/products/supplier-family-review.js")>("../../components/products/supplier-family-review.tsx", { "next/link": {}, "next/navigation": { useRouter() { return { refresh() {} }; } }, "@/app/products/price-updates/supplier-sources/actions": {} });
  const keys = (count: number) => Array.from({ length: count }, (_, index) => `m-${index}`);
  assert.deepEqual(ui.supplierKeyChunks(keys(81), SUPPLIER_BULK_LIMIT).map((chunk: string[]) => chunk.length), [50, 31]);
  assert.deepEqual(ui.supplierKeyChunks(keys(81).slice(30), SUPPLIER_BULK_LIMIT).map((chunk: string[]) => chunk.length), [50, 1]); // 30 already confirmed: 51 remain
  assert.equal(ui.sameKeySet(keys(3), [...keys(3)].reverse()), true);
  assert.equal(ui.sameKeySet(keys(3), keys(4)), false); // a Family that changed since render
  assert.equal(ui.sameKeySet(keys(3), ["m-0", "m-1", "m-9"]), false);
  assert.equal(ui.familyShortcutError(Error("Some selected items are not part of this review.")), ui.FAMILY_REVIEW_CHANGED);
  assert.equal(ui.familyShortcutError(Error("1 selected item needs attention. Nothing was changed.")), "1 selected item needs attention. Nothing was changed.");
  const component = await readFile(new URL("../../components/products/supplier-family-review.tsx", import.meta.url), "utf8");
  assert.match(component, /supplierFamilyUnchangedKeys\(batchId, templateId\)/); assert.match(component, /runSupplierKeyChunks\(keys, limit/);
  assert.match(component, /same: \{ label: `Confirm \$\{selected\.length\} unchanged`, go: \(\) => run\(\(\) => bulkConfirmSupplierUnchanged\(batchId, selected\)\) \}/); // manual selection path untouched
  const repository = await readFile(new URL("./supplier-price-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /if \(keys\.some\(\(key\) => !byKey\.has\(key\)\)\) throw Error\("Some selected items are not part of this review\."\);/);
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
    assert.deepEqual((await supplierFamilyOverview(f.client, batch)).families.find((family) => family.template_id === gamma), { template_id: gamma, template_name: "GAMMA", items: 2, changed: 0, same: 0, missing: 0, attention: 0, done: 2, doneChanged: 0, excluded: 2, status: "ready" });
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
    const list = renderToStaticMarkup(createElement(ui.SupplierFamilyList, { overview, links: overview.families.map((family) => ({ template_id: family.template_id, href: `/x?family=${family.template_id}` })), advancedHref: "/x?view=advanced", supplierOnlyHref: "/x?status=unmatched", successMessage: "OXI_P confirmed successfully." }));
    assert.match(list, /6 Families/); assert.match(list, /ALPHA SCREEN/); assert.match(list, /Needs attention/); assert.match(list, /Advanced \/ Technical Review/);
    assert.match(list, /OXI_P confirmed successfully/); assert.match(list, /Family review confirmed/);
    assert.match(list, /Supplier-only items: 3/); assert.match(list, /View in Advanced Review/); assert.doesNotMatch(list, /target_not_represented|baseline_drift|pricing_version|unmatched</);
    assert.match(renderToStaticMarkup(createElement(ui.SupplierBrandProgress, { overview })), /Families ready<\/dt><dd[^>]*>0 \/ 6/);
    const rows = (await supplierFamilyRows(f.client, batch, alpha, "changed")).rows.slice(0, 3);
    const tabs = (["changed", "same", "missing", "attention"] as const).map((section) => ({ section, label: section, count: 1, href: `/x?section=${section}` }));
    const table = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ui.SupplierFamilyTable, { batchId: batch, brandId: brand, familyName: "ALPHA SCREEN", section: "changed", tabs, rows, truncated: false, approver: true, batchOpen: true, limit: 50, backHref: "/x", summaryHref: "/x?view=family&confirmedFamily=ALPHA+SCREEN", detailsHref: "/x?view=advanced", sourceId: "source", sourceTitle: "February price list", sourceDefinitionName: "LAS Chairs", ...props } as never));
    assert.equal((table().match(/type="checkbox"/g) ?? []).length, 3); assert.match(table(), />Select all</); assert.match(table(), />Clear selection</); assert.match(table(), /0 selected/); assert.match(table(), /Back to Family Review/); assert.match(table(), /View extracted data/); assert.equal((table().match(/View source/g) ?? []).length, 3); assert.match(table(), /Review details/);
    const unchangedFamily = table({ familyUnchangedKeys: ["m-a1", "m-a2"] });
    assert.match(unchangedFamily, /This Family has no price changes or blockers/); assert.match(unchangedFamily, />Confirm family unchanged</);
    assert.equal(ui.familyReviewSuccessMessage("OXI_P", 10), "OXI_P review confirmed. 10 unchanged prices were confirmed successfully.");
    assert.equal(ui.familyReviewSuccessMessage("OXI_P", 1), "OXI_P review confirmed. 1 unchanged price was confirmed successfully.");
    assert.match(table({ basisBlocked: true }), /Price basis must be confirmed for LAS Chairs before prices can be applied/); assert.match(table({ basisBlocked: true }), /href="#supplier-price-basis"/);
    assert.match(table({ familyUnchangedKeys: ["m-a1"], familyUnchangedAction: "finish" }), />Finish family review</);
    assert.match(table({ familyUnchangedKeys: ["m-a1"], approver: false }), /An approver can confirm this Family unchanged/);
    assert.doesNotMatch(table({ approver: false }), /type="checkbox"/); assert.match(table({ approver: false }), /An approver applies, confirms or excludes items\./);
    assert.doesNotMatch(table({ batchOpen: false }), /type="checkbox"/);
    const attention = (await supplierFamilyRows(f.client, batch, delta1, "attention")).rows;
    const attentionHtml = table({ section: "attention", rows: attention });
    assert.doesNotMatch(attentionHtml, /type="checkbox"/); assert.match(attentionHtml, /Review details/); assert.match(attentionHtml, /One Supplier item linked to multiple Product prices/); assert.match(attentionHtml, /View extracted data/); assert.match(attentionHtml, /View source/);
    const same = (await supplierFamilyRows(f.client, batch, alpha, "same")).rows; const missing = (await supplierFamilyRows(f.client, batch, gamma, "missing")).rows;
    assert.match(table({ section: "same", rows: same }), /Review details/); assert.match(table({ section: "same", rows: same }), /View source/); assert.match(table({ section: "missing", rows: missing }), /Review details/); assert.match(table({ section: "missing", rows: missing }), /View source/); assert.match(table({ section: "missing", rows: missing }), /Not listed/);
    assert.match(table({ section: "same", rows: [] }), /No unchanged prices waiting for confirmation\./);
    // Selection state lives inside the keyed table, so navigating batch, Family or section remounts it with nothing selected.
    const page = await readFile(new URL("../../app/products/price-updates/supplier-sources/page.tsx", import.meta.url), "utf8");
    assert.match(page, /<SupplierFamilyTable key=\{`\$\{batch\.id\}:\$\{family\.template_id\}:\$\{section\}`\}/);
    assert.match(page, /brandId=\{brand\.id\}/); assert.match(page, /sourceId=\{source\.id\}/); assert.match(page, /view === "family"/); assert.match(page, /View in Advanced|Advanced \/ Technical Review|view: "advanced"/); assert.match(page, /Back to Family Review/);
    assert.match(page, /SupplierPriceBasisPanel/); assert.match(page, /familyUnchangedKeys/); assert.match(page, /confirmedFamily/); assert.match(page, /summaryHref=/);
    const component = await readFile(new URL("../../components/products/supplier-family-review.tsx", import.meta.url), "utf8");
    assert.match(component, /useState<string\[\]>\(\[\]\)/); assert.match(component, /Supplier review details/); assert.match(component, /sourceDetail\.evidence/); assert.match(component, /sourceDetail\.sourceRowCount/); assert.match(component, /View source/); assert.match(component, /Manage Supplier tier mapping above/); assert.match(component, /supplierSourceInspectorDetails/);
    assert.match(component, /optionalSupplierRuleId\(task\.templateId\)/); assert.match(component, /optionalSupplierRuleId\(task\.groupId\)/); assert.match(component, /router\.push\(summaryHref\)/); assert.match(component, /runFamilyShortcut/);
    const familyKeys = Array.from({ length: 81 }, (_, index) => `m-${index}`);
    assert.deepEqual(ui.supplierKeyChunks(familyKeys, 50).map((chunk: string[]) => chunk.length), [50, 31]);
    const chunks: string[][] = [];
    await ui.runSupplierKeyChunks(familyKeys, 50, async (chunk: string[]) => { chunks.push(chunk); return chunk.length; });
    assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 31]);
    const completed: string[][] = []; let attempted = 0;
    await assert.rejects(ui.runSupplierKeyChunks(familyKeys, 50, async (chunk: string[]) => { attempted++; if (attempted === 2) throw Error("second chunk failed"); completed.push(chunk); return chunk.length; }), /second chunk failed/);
    assert.deepEqual(completed.map((chunk) => chunk.length), [50]); assert.equal(attempted, 2);
    assert.match(component, /runSupplierKeyChunks\(keys, limit, \(chunk\) => bulkConfirmSupplierUnchanged\(batchId, chunk\)\)/); // the shortcut submits freshly derived match keys, not render-time props
  } finally { await f.db.close(); }
});

async function cleanUnchangedFamily(count: number, name: string) {
  const f = await fixture({ withAttention: false });
  const oxiCodes = ["111058", "111065", "111066", "111067", "111068", "111069", "111070", "111071", "111072", "1AG301"];
  const prices = [69, 425, 443, 494, 512, 421, 439, 490, 508, 221];
  const codes = Array.from({ length: count }, (_, index) => name === "OXI_P" ? oxiCodes[index] : `SIG${index}`);
  const rows = codes.map((code, index) => ({ id: `clean-${index}`, supplier_price_list_code: code, variant_name: `Size ${index}`, price: name === "OXI_P" ? prices[index] : 100, currency: "EUR" }));
  await f.db.query("delete from supplier_price_matches where batch_id=$1", [batch]);
  await f.db.query("delete from product_templates where id<>$1", [alpha]);
  await f.db.query("update product_templates set template_name=$1,variant_pricing=$2 where id=$3", [name, JSON.stringify([{ id: "ga", items: rows }]), alpha]);
  const { targets } = await supplierBrandTargets(f.client, brand);
  const keys: string[] = [];
  for (const target of targets) {
    const key = JSON.stringify([target.code, "unit_price", ""]).replaceAll(",", ", "); // exact live JSON-like text, including spaces
    const identity: SourceIdentity = { key, code: target.code, price_field: "unit_price", dimension: "", raw_dimension: "", finishes: ["144", "163"], row_keys: [], issues: [], price: target.price, currency: "EUR" };
    const match: PriceMatch = { key, source: identity, targets: [target], classification: "unchanged", comparison: "unchanged", candidate_shared: false };
    await f.db.query("insert into supplier_source_identities values($1,$2,$3,$4)", [source, key, target.code, JSON.stringify(identity)]);
    await f.db.query("insert into supplier_price_matches values($1,$2,$3,'unchanged','unchanged',$4,$5)", [batch, key, target.code, [alpha], JSON.stringify(match)]);
    keys.push(key);
  }
  return { ...f, keys };
}

for (const [name, count] of [["OXI_P", 10], ["Sigma", 81]] as const) test(`${name}: real JSON-like source keys agree across Same, bulk chunks, readiness and SQL completion`, async () => {
  const f = await cleanUnchangedFamily(count, name);
  try {
    const before = await f.snapshot();
    const family = (await supplierFamilyOverview(f.client, batch)).families[0];
    assert.deepEqual([family.same, family.attention, family.changed, family.missing], [count, 0, 0, 0]);
    const keys = await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha);
    assert.deepEqual(new Set(keys), new Set(f.keys));
    const readyBefore = await supplierCompletionReadiness(f.client, batch);
    assert.deepEqual([readyBefore.blocking, readyBefore.counts.unchanged_not_confirmed], [count, count]);
    await assert.rejects(supplierCompleteReview(f.client, batch), /unresolved rows/);
    const ui = await loadTestModule<typeof import("../../components/products/supplier-family-review.js")>("../../components/products/supplier-family-review.tsx", { "next/link": {}, "next/navigation": { useRouter() { return { refresh() {} }; } }, "@/app/products/price-updates/supplier-sources/actions": {} });
    const chunks: number[] = [];
    await ui.runSupplierKeyChunks(keys, SUPPLIER_BULK_LIMIT, async (chunk: string[]) => { chunks.push(chunk.length); return (await supplierBulkConfirmUnchanged(f.client, batch, chunk)).count; });
    assert.deepEqual(chunks, count === 81 ? [50, 31] : [10]);
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha), []);
    const after = await f.snapshot();
    assert.deepEqual(after, before); // confirmation never changes Product prices, versions, history, Brand checks or quotations
    assert.equal((await supplierFamilyOverview(f.client, batch)).families[0].status, "ready");
    const ready = await supplierCompletionReadiness(f.client, batch);
    assert.deepEqual([ready.ready, ready.blocking, ready.counts.resolved], [true, 0, count]);
    await supplierCompleteReview(f.client, batch); // unchanged SQL completion accepts the same resolution
  } finally { await f.db.close(); }
});

test("OXI_P with one unavailable source identity: 9 Same + 1 attention, no shortcut, specific rejection and readiness blocker", async () => {
  const f = await cleanUnchangedFamily(10, "OXI_P");
  try {
    await f.db.query("delete from supplier_source_identities where source_id=$1 and key=$2", [source, f.keys[0]]);
    const family = (await supplierFamilyOverview(f.client, batch)).families[0];
    assert.deepEqual([family.same, family.attention], [9, 1]);
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha), []);
    const attention = (await supplierFamilyRows(f.client, batch, alpha, "attention")).rows;
    assert.deepEqual(attention.map((row) => [row.issue, row.selectable]), [["Supplier price unavailable in this source", false]]);
    await assert.rejects(supplierBulkConfirmUnchanged(f.client, batch, f.keys), /Supplier price unavailable in this source/);
    assert.deepEqual(await f.decisions(), {});
    const ready = await supplierCompletionReadiness(f.client, batch);
    assert.deepEqual([ready.ready, ready.blocking, ready.counts.invalid_source, ready.counts.unchanged_not_confirmed], [false, 10, 1, 9]);
    await assert.rejects(supplierCompleteReview(f.client, batch), /unresolved rows/);
  } finally { await f.db.close(); }
});

test("LEAD-style tier mapping and ambiguous rows stay attention; clean rows retain manual confirmation", async () => {
  const f = await cleanUnchangedFamily(10, "OXI_P");
  try {
    await f.db.query("update product_templates set template_name='LEAD' where id=$1", [alpha]);
    for (const [index, classification] of [[0, "needs_dimension_mapping"], [1, "ambiguous"]] as const) {
      await f.db.query("update supplier_price_matches set classification=$1,data=jsonb_set(data,'{classification}',to_jsonb($1::text)) where batch_id=$2 and key=$3", [classification, batch, f.keys[index]]);
    }
    const family = (await supplierFamilyOverview(f.client, batch)).families[0];
    assert.deepEqual([family.same, family.attention, family.status], [8, 2, "needs_attention"]);
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha), []);
    const attention = (await supplierFamilyRows(f.client, batch, alpha, "attention")).rows;
    assert.deepEqual(new Set(attention.map((row) => row.issue)), new Set(["Category mapping needed", "More than one possible match"]));
    const before = await f.snapshot();
    await assert.rejects(supplierBulkConfirmUnchanged(f.client, batch, f.keys), /Category mapping needed/);
    const manual = (await supplierFamilyRows(f.client, batch, alpha, "same")).rows.filter((row) => row.selectable).map((row) => row.key);
    assert.equal((await supplierBulkConfirmUnchanged(f.client, batch, manual)).count, 8);
    assert.deepEqual(await f.snapshot(), before);
    const readiness = await supplierCompletionReadiness(f.client, batch);
    assert.deepEqual([readiness.blocking, readiness.counts.needs_dimension_mapping, readiness.counts.ambiguous, readiness.counts.resolved], [2, 1, 1, 8]);
    assert.equal((await supplierFamilyOverview(f.client, batch)).families[0].attention, readiness.blocking);
    await assert.rejects(supplierCompleteReview(f.client, batch), /2 unresolved rows/);
  } finally { await f.db.close(); }
});

test("authoritative row state keeps mapping, shared/ambiguous, decisions, missing and stale targets honest", async () => {
  const f = await cleanUnchangedFamily(10, "OXI_P");
  try {
    const match = (await f.db.query<{ data: PriceMatch }>("select data from supplier_price_matches where batch_id=$1 and key=$2", [batch, f.keys[0]])).rows[0].data;
    const sourceVersion = (await f.db.query<SourceVersion>("select * from supplier_source_versions where id=$1", [source])).rows[0];
    const live = new Map(match.targets.map((target) => [target.key, target]));
    const state = (value = match, decision?: string, current = live) => supplierReviewRowState(value, decision, current, { key: value.key, source: sourceVersion, identity: value.source ?? undefined, brandId: brand });
    assert.deepEqual([state().section, state().unchangedEligible, state().blocking], ["same", true, true]);
    for (const classification of ["needs_dimension_mapping", "ambiguous", "shared"] as const) {
      const row = state({ ...match, classification }, undefined, new Map());
      assert.deepEqual([row.section, row.unchangedEligible, row.blocking], ["attention", false, true]);
    }
    assert.deepEqual([state(match, "confirmed_unchanged").done, state(match, "confirmed_unchanged").blocking], [true, false]);
    for (const decision of ["skip", "reject", "mapping_proposed"]) assert.equal(state(match, decision).section, "attention");
    const changed = { ...match, classification: "increased" as const, source: { ...match.source!, price: match.source!.price! + 1 } };
    assert.deepEqual([state(changed).section, state(changed).changedEligible, state(changed).blocking], ["changed", true, true]);
    const applied = new Map([[match.targets[0].key, { ...match.targets[0], price: changed.source.price, pricing_version: "1" }]]);
    assert.deepEqual([state(changed, "reviewed", applied).done, state(changed, "reviewed", applied).blocking], [true, false]);
    const multi = { ...changed, targets: [match.targets[0], { ...match.targets[0], key: "second-target" }] };
    const multiLive = new Map([...applied, ["second-target", { ...match.targets[0], key: "second-target", price: changed.source.price }]]);
    assert.deepEqual([state(multi, "reviewed", multiLive).done, state(multi, "reviewed", multiLive).blocking], [true, false]);
    assert.equal(state({ ...multi, classification: "shared" }, "reviewed", multiLive).done, true);
    assert.equal(state({ ...multi, classification: "shared" }, "reviewed", new Map()).blocking, true);
    const missing = { ...match, classification: "target_not_represented" as const, source: null };
    assert.equal(state(missing).section, "missing"); assert.equal(state(missing, "excluded_from_source").done, true);
    const drift = new Map([[match.targets[0].key, { ...match.targets[0], raw_code: "OTHER" }]]);
    assert.deepEqual([state(match, "confirmed_unchanged", drift).section, state(match, "confirmed_unchanged", drift).blocking], ["attention", true]);
    assert.equal(state({ ...match, source: { ...match.source!, issues: ["Needs tier mapping"] } }).section, "attention");
  } finally { await f.db.close(); }
});

test("mixed Family only offers its remaining Same keys after every Changed row is applied", async () => {
  const f = await fixture({ withAttention: false });
  try {
    assert.deepEqual(await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha), []);
    await supplierBulkApplyChanged(f.client, batch, f.alphaKeys(0, ALPHA_CHANGED));
    const family = (await supplierFamilyOverview(f.client, batch)).families.find((item) => item.template_id === alpha)!;
    assert.deepEqual([family.changed, family.doneChanged, family.same, family.attention, family.missing], [0, ALPHA_CHANGED, ALPHA_SAME, 0, 0]);
    const keys = await supplierFamilyUnchangedMatchKeys(f.client, batch, alpha);
    assert.deepEqual(keys, f.alphaKeys(ALPHA_CHANGED, ALPHA_CHANGED + ALPHA_SAME));
    await supplierBulkConfirmUnchanged(f.client, batch, keys);
    assert.equal((await supplierFamilyOverview(f.client, batch)).families.find((item) => item.template_id === alpha)!.status, "ready");
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
