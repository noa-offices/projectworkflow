import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const migrations = await Promise.all([
  "20261002060146_pricing_identity_version_foundation",
  "20261002065310_pricing_writer_concurrency",
  "20261003141259_supplier_default_price_writer",
  "20261003154849_detail_history_dynamic_price_fields",
  "20261003170000_supplier_shared_price_writer",
].map(migration));
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const c = "00000000-0000-0000-0000-000000000003";
const k = "00000000-0000-0000-0000-00000000000c";
const conflict = /This Product Template changed\. Reload before saving\./;
const invalid = /Invalid shared price operation/;
const variantRows = (first = 92, second = 50) => [{ id: "v1", price: first, currency: "EUR" }, { id: "v2", price: second, currency: "EUR" }];
const matrixRows = (melamine = 92, veneer = 120) => [{ id: "g1", items: [{ id: "r1", prices: { melamine, veneer } }] }];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as 'select ''${a}''::uuid';
    create table active_user(active boolean); insert into active_user values(true);
    create function public.current_user_is_active() returns boolean language sql as 'select active from public.active_user';
    create table brands(id uuid primary key,last_price_list_checked_at timestamptz);
    create table brand_price_list_updates(id uuid primary key,brand_id uuid,status text);
    create table product_templates(id uuid primary key,brand_id uuid,template_name text,description text,default_image_url text,price_notes text,
      last_price_checked_at timestamptz,last_price_checked_by uuid,price_check_note text,created_at timestamptz default now(),is_active boolean default true,
      default_unit_price numeric default 10,currency text default 'EUR',variant_pricing jsonb default '[]',category_pricing jsonb default '[]',
      desking_size_pricing jsonb default '[]',accessory_pricing jsonb default '[]');
    create table product_components(id uuid primary key default gen_random_uuid(),template_id uuid not null references product_templates(id),
      option_type text not null,component_group text not null,component_code text,component_name text not null,description text,
      qty numeric not null,unit_label text not null,unit_price numeric not null,currency text not null,is_optional boolean not null,
      is_default_selected boolean not null,sort_order int not null,is_active boolean not null,price_notes text,calculation_data jsonb,created_by uuid);
    create table product_template_price_history(id uuid default gen_random_uuid(),product_template_id uuid,brand_id uuid,brand_price_list_update_id uuid,
      old_default_unit_price numeric,new_default_unit_price numeric,currency text,effective_from date,note text check(note <> 'block'),changed_by uuid);
    create table product_template_detail_price_history(id uuid default gen_random_uuid(),product_template_id uuid,brand_id uuid,brand_price_list_update_id uuid,
      source_table text,source_record_id text,price_field text,old_price numeric,new_price numeric,currency text,effective_from date,note text check(note <> 'block'),changed_by uuid,
      constraint product_template_detail_price_history_price_field_check check (price_field in ('unit_price','default_price','additional_price','price')));
    insert into brands values('${a}',null);
    insert into brand_price_list_updates values('${c}','${a}','active');
    insert into product_templates(id,brand_id) values('${a}','${a}'),('${b}','${a}'),('${c}','${a}');
  `);
  for (const sql of migrations) await db.exec(sql);
  await db.query("update product_templates set variant_pricing=$1,category_pricing=$2,last_price_checked_at='2026-01-02T03:04:05Z',last_price_checked_by=$3,price_check_note='Previously checked'",
    [JSON.stringify(variantRows()), JSON.stringify(matrixRows()), b]);
  await db.query("update brands set last_price_list_checked_at='2026-01-01T00:00:00Z'");
  await db.query(`insert into product_components(id,template_id,option_type,component_group,component_code,component_name,qty,unit_label,unit_price,currency,is_optional,is_default_selected,sort_order,is_active)
    values($1,$2,'other','Options','001-A','Option',1,'Pc',20,'EUR',true,false,0,true)`, [k, a]);
  return db;
}
async function version(db: PGlite, id = a) {
  return Number((await db.query<{ pricing_version: number }>("select pricing_version from product_templates where id=$1", [id])).rows[0].pricing_version);
}
async function snapshot(db: PGlite) {
  const rows = async (sql: string) => (await db.query(sql)).rows;
  return {
    templates: await rows("select row_to_json(t) as data from product_templates t order by id"),
    components: await rows("select row_to_json(c) as data from product_components c order by id"),
    brands: await rows("select row_to_json(b) as data from brands b union all select row_to_json(u) from brand_price_list_updates u"),
    history: await rows("select count(*)::int as count from product_template_price_history"),
    detail: await rows("select count(*)::int as count from product_template_detail_price_history"),
  };
}
async function apply(db: PGlite, operations: unknown) {
  return (await db.query<{ result: { applied_count: number; template_versions: Record<string, string> } }>(
    "select apply_supplier_shared_price_at_versions($1) as result", [JSON.stringify(operations)])).rows[0].result;
}
const note = "Supplier source: LAS; batch: batch; match: match; shared apply";
const history = { brand_price_list_update_id: c, effective_from: "2026-10-03", note };
const simple = (template: string, expected: number, price = 81, extra = {}) =>
  ({ template_id: template, expected_version: String(expected), mode: "supplier_default", payload: { default_unit_price: price, currency: "EUR" }, history: { ...history, ...extra } });
const variant = (template: string, expected: number, rows: unknown, row: string, old: number, price = 81, extra = {}) =>
  ({ template_id: template, expected_version: String(expected), mode: "detail", payload: { variant_pricing: rows },
    history: { ...history, source_table: "product_templates.variant_pricing", source_record_id: row, price_field: "price", old_price: old, new_price: price, currency: "EUR", ...extra } });
const matrix = (template: string, expected: number, rows: unknown, column: string, old: number, price = 81) =>
  ({ template_id: template, expected_version: String(expected), mode: "detail", payload: { category_pricing: rows },
    history: { ...history, source_table: "product_templates.category_pricing", source_record_id: "r1", price_field: `prices.${column}`, old_price: old, new_price: price, currency: "EUR" } });
const component = (expected: number, price = 81, extra = {}) =>
  ({ template_id: a, expected_version: String(expected), mode: "detail", payload: { unit_price: price, currency: "EUR" },
    history: { ...history, source_table: "product_components", source_record_id: k, price_field: "unit_price", old_price: 20, new_price: price, currency: "EUR", ...extra } });

test("rejects empty, malformed, oversized, and unsupported-mode operation sets without writing", async () => {
  const db = await fixture();
  try {
    const before = await snapshot(db), v = await version(db);
    await assert.rejects(apply(db, []), /operation count/);
    await assert.rejects(apply(db, { operations: [] }), /Invalid shared price operations/);
    await assert.rejects(apply(db, Array.from({ length: 51 }, () => simple(a, v))), /operation count/);
    const valid = simple(a, v);
    for (const bad of [
      "op", null, { ...valid, extra: true }, { ...valid, template_id: "not-a-uuid" }, { ...valid, template_id: 7 },
      { ...valid, expected_version: "1.5" }, { ...valid, expected_version: -1 }, { ...valid, expected_version: null },
      { ...valid, payload: [] }, { ...valid, history: "note" }, { template_id: a, expected_version: "0", mode: "detail", payload: {} },
    ]) await assert.rejects(apply(db, [simple(b, await version(db, b)), bad]), invalid);
    for (const mode of ["default", "bogus", null]) await assert.rejects(apply(db, [{ ...valid, mode }]), invalid);
    await assert.rejects(apply(db, [simple(a, v, -1)]), /Invalid Product pricing/);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test("different Templates apply together with both histories and no check metadata or Brand changes", async () => {
  const db = await fixture();
  try {
    const before = await snapshot(db), va = await version(db, a), vb = await version(db, b);
    const result = await apply(db, [simple(a, va), simple(b, vb)]);
    assert.deepEqual(result, { applied_count: 2, template_versions: { [a]: String(va + 1), [b]: String(vb + 1) } });
    assert.deepEqual((await db.query("select id,default_unit_price::int as price,last_price_checked_at,last_price_checked_by,price_check_note from product_templates where id in ($1,$2) order by id", [a, b])).rows,
      [a, b].map((id) => ({ id, price: 81, last_price_checked_at: new Date("2026-01-02T03:04:05Z"), last_price_checked_by: b, price_check_note: "Previously checked" })));
    assert.deepEqual((await db.query("select product_template_id,old_default_unit_price::int as old,new_default_unit_price::int as new,brand_price_list_update_id,note from product_template_price_history order by product_template_id")).rows,
      [a, b].map((id) => ({ product_template_id: id, old: 10, new: 81, brand_price_list_update_id: c, note })));
    assert.deepEqual((await snapshot(db)).brands, before.brands);
  } finally { await db.close(); }
});

test("failure on a later Template rolls back the earlier Template, versions, and history", async () => {
  const db = await fixture();
  try {
    const before = await snapshot(db);
    await assert.rejects(apply(db, [simple(a, await version(db, a)), simple(b, await version(db, b), 81, { note: "block" })]), /check constraint/);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test("same-Template operations share one reviewed baseline and chain the internal version", async () => {
  const db = await fixture();
  try {
    const v = await version(db);
    const first = variantRows(81, 50), second = variantRows(81, 81);
    const result = await apply(db, [variant(a, v, first, "v1", 92), variant(a, v, second, "v2", 50)]);
    assert.deepEqual(result, { applied_count: 2, template_versions: { [a]: String(v + 2) } });
    assert.equal(await version(db), v + 2);
    assert.deepEqual((await db.query("select variant_pricing from product_templates where id=$1", [a])).rows[0], { variant_pricing: second });
    assert.deepEqual((await db.query("select source_record_id,old_price::int as old,new_price::int as new from product_template_detail_price_history order by source_record_id")).rows,
      [{ source_record_id: "v1", old: 92, new: 81 }, { source_record_id: "v2", old: 50, new: 81 }]);
    // Repeat from the same reviewed baseline is stale and writes nothing.
    const after = await snapshot(db);
    await assert.rejects(apply(db, [variant(a, v, first, "v1", 92), variant(a, v, second, "v2", 50)]), conflict);
    assert.deepEqual(await snapshot(db), after);
  } finally { await db.close(); }
});

test("same-Template operations with different submitted baselines reject before mutation", async () => {
  const db = await fixture();
  try {
    const before = await snapshot(db), v = await version(db);
    await assert.rejects(apply(db, [simple(a, v), variant(a, v + 1, variantRows(81), "v1", 92)]), conflict);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});

test("three same-Template operations (scalar + matrix columns) chain versions and keep persisted matrix history", async () => {
  const db = await fixture();
  try {
    const v = await version(db);
    const result = await apply(db, [simple(a, v), matrix(a, v, matrixRows(81, 120), "melamine", 92), matrix(a, v, matrixRows(81, 81), "veneer", 120)]);
    assert.deepEqual(result.template_versions, { [a]: String(v + 3) });
    assert.deepEqual((await db.query("select default_unit_price::int as price,category_pricing,variant_pricing from product_templates where id=$1", [a])).rows[0],
      { price: 81, category_pricing: matrixRows(81, 81), variant_pricing: variantRows() });
    assert.deepEqual((await db.query("select price_field from product_template_detail_price_history order by price_field")).rows,
      [{ price_field: "prices.melamine" }, { price_field: "prices.veneer" }]);
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from product_template_price_history")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("JSON detail + component apply atomically; a final history failure rolls everything back", async () => {
  const db = await fixture();
  try {
    const before = await snapshot(db), v = await version(db);
    await assert.rejects(apply(db, [variant(a, v, variantRows(81), "v1", 92), simple(b, await version(db, b)), component(v, 81, { note: "block" })]), /check constraint/);
    assert.deepEqual(await snapshot(db), before);
    const result = await apply(db, [variant(a, v, variantRows(81), "v1", 92), component(v)]);
    assert.deepEqual(result.template_versions, { [a]: String(v + 2) });
    assert.equal(await version(db), v + 2);
    assert.deepEqual((await db.query("select unit_price::int as price,qty::int,component_name,is_active from product_components where id=$1", [k])).rows[0],
      { price: 81, qty: 1, component_name: "Option", is_active: true });
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from product_template_detail_price_history")).rows[0].count, 2);
  } finally { await db.close(); }
});

test("one stale Template among several rejects every operation before writing", async () => {
  const db = await fixture();
  try {
    const va = await version(db, a), vb = await version(db, b);
    await db.query("update product_templates set default_unit_price=11 where id=$1", [c]);
    const before = await snapshot(db);
    await assert.rejects(apply(db, [simple(a, va), simple(b, vb), simple(c, 0)]), conflict);
    assert.deepEqual(await snapshot(db), before);
    await db.query("update product_templates set is_active=false where id=$1", [c]);
    const inactive = await snapshot(db);
    await assert.rejects(apply(db, [simple(a, va), simple(c, await version(db, c))]), conflict);
    assert.deepEqual(await snapshot(db), inactive);
    assert.deepEqual(before.history, inactive.history);
  } finally { await db.close(); }
});

test("invoker security, active-user guard, grants, and the single-target writer are preserved", async () => {
  const db = await fixture();
  try {
    assert.deepEqual((await db.query("select prosecdef from pg_proc where proname in ('apply_supplier_shared_price_at_versions','write_product_price_with_history_at_version') order by proname")).rows,
      [{ prosecdef: false }, { prosecdef: false }]);
    assert.deepEqual((await db.query("select has_function_privilege('authenticated','apply_supplier_shared_price_at_versions(jsonb)','execute') as granted")).rows[0], { granted: true });
    const v = await version(db);
    assert.equal(Number((await db.query<{ v: number }>("select write_product_price_with_history_at_version($1,$2,'supplier_default',$3,$4) as v",
      [a, v, JSON.stringify({ default_unit_price: 70, currency: "EUR" }), JSON.stringify(history)])).rows[0].v), v + 1);
    await db.query("update active_user set active=false");
    const before = await snapshot(db);
    await assert.rejects(apply(db, [simple(a, v + 1)]), /permission denied|insufficient/);
    assert.deepEqual(await snapshot(db), before);
  } finally { await db.close(); }
});
