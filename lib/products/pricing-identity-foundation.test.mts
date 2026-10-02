import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseSupportedCurrency } from "../currencies.js";
import { normalizeManufacturerCode } from "./manufacturer-code.js";
import { initialPricingDimensionCode, pricingColumns } from "./pricing-category-columns.js";
import { productTemplateFormSmartWorkspace } from "./product-template-form-smart-workspace.js";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter.js";
import { normalizeProductTemplateDraft } from "./product-template-draft.js";
import { categoryPricingValue } from "./category-pricing-value.js";

const migration = await readFile(new URL("../../supabase/migrations/20261002060146_pricing_identity_version_foundation.sql", import.meta.url), "utf8");
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const c = "00000000-0000-0000-0000-000000000003";
const matrix = (modular = false) => ({ id: modular ? "modular" : "category", group_name: "Pricing", ...(modular ? { pricing_type: "modular_group" } : {}), price_categories: ["Cat A", "Cat B"], items: [{ id: "row", variant_name: "Seat", currency: "EUR", prices: { "Cat A": 0, "Cat B": 455.1234 } }] });
async function fixture(pricing: unknown = [matrix(), matrix(true)]) {
  const db = new PGlite();
  await db.exec(`create role authenticated; create function public.current_user_is_active() returns boolean language sql as 'select true';
    create table brands(id uuid primary key,last_price_list_checked_at timestamptz);
    create table brand_price_list_updates(id uuid primary key,brand_id uuid,status text);
    create table product_templates(id uuid primary key,brand_id uuid,template_name text,description text,default_image_url text,price_notes text,last_price_checked_at timestamptz,created_at timestamptz default '2020-02-01',is_active boolean default true,default_unit_price numeric default 0,currency text default 'EUR',variant_pricing jsonb default '[]',category_pricing jsonb default '[]',desking_size_pricing jsonb default '[]',accessory_pricing jsonb default '[]');
    create table product_components(id uuid primary key,template_id uuid references product_templates(id) on delete cascade,unit_price numeric,currency text,qty numeric,is_active boolean,component_name text);
    insert into brands values('${a}','2020-01-01'); insert into brand_price_list_updates values('${c}','${a}','archived');
    insert into product_templates(id,brand_id) values('${a}','${a}'),('${b}','${a}');`);
  await db.query("update product_templates set category_pricing=$1,accessory_pricing=$2 where id=$3", [JSON.stringify(pricing), JSON.stringify([{ id: "accessory", price_categories: [{ id: "b", label: "B" }], items: [{ id: "option", prices: { b: 90 } }] }]), a]);
  return db;
}
async function version(db: PGlite, id = a) { return (await db.query<{ pricing_version: number }>("select pricing_version from product_templates where id=$1", [id])).rows[0].pricing_version; }

test("migration preserves exact prices, IDs/order and accessory shape; repeat is safe", async () => {
  const db = await fixture();
  try {
    const before = (await db.query<{ category_pricing: unknown[]; accessory_pricing: unknown }>("select category_pricing,accessory_pricing from product_templates where id=$1", [a])).rows[0];
    await db.exec(migration);
    const after = (await db.query<typeof before>("select category_pricing,accessory_pricing from product_templates where id=$1", [a])).rows[0];
    assert.deepEqual(after.accessory_pricing, before.accessory_pricing);
    after.category_pricing.forEach((raw, index) => { const group = raw as ReturnType<typeof matrix> & { price_columns: unknown }; assert.deepEqual(group.items, (before.category_pricing[index] as ReturnType<typeof matrix>).items); assert.equal(group.id, (before.category_pricing[index] as ReturnType<typeof matrix>).id); assert.deepEqual(group.price_columns, pricingColumns(matrix())); });
    assert.equal(await version(db), 0);
    await db.exec(migration);
    assert.deepEqual((await db.query<{ category_pricing: unknown }>("select category_pricing from product_templates where id=$1", [a])).rows[0].category_pricing, after.category_pricing);
    assert.equal(await version(db), 0);
  } finally { await db.close(); }
});

test("migration rejects dimension collisions and rolls back instead of merging", async () => {
  const bad = { ...matrix(), price_categories: ["Cat B", "Cat-B"], items: [{ id: "row", prices: { "Cat B": 1, "Cat-B": 2 } }] };
  const db = await fixture([bad]);
  try { await assert.rejects(db.exec(migration), /dimension collision/); await db.exec("rollback"); assert.deepEqual((await db.query<{ category_pricing: unknown }>("select category_pricing from product_templates where id=$1", [a])).rows[0].category_pricing, [bad]); } finally { await db.close(); }
});

for (const [field, value] of Object.entries({ default_unit_price: "1", currency: "'USD'", variant_pricing: "'[1]'::jsonb", category_pricing: "'[]'::jsonb", desking_size_pricing: "'[1]'::jsonb", accessory_pricing: "'[]'::jsonb" })) {
  test(`${field} change increments version; identical rewrite does not`, async () => {
    const db = await fixture(); try { await db.exec(migration); await db.exec(`update product_templates set ${field}=${value} where id='${a}'`); assert.equal(await version(db), 1); await db.exec(`update product_templates set ${field}=${value} where id='${a}'`); assert.equal(await version(db), 1); } finally { await db.close(); }
  });
}

test("non-price edits do not bump; basis/coverage/creation defaults preserve legacy evidence", async () => {
  const db = await fixture(); try {
    await db.exec(migration);
    await db.exec(`update product_templates set template_name='Name',description='Text',default_image_url='image',price_notes='Note',last_price_checked_at=now() where id='${a}'`);
    assert.equal(await version(db), 0);
    await db.exec(`update product_templates set pricing_version=100 where id='${a}'`);
    assert.equal(await version(db), 0);
    assert.equal((await db.query<{ stored_price_basis: string }>("select stored_price_basis from brands")).rows[0].stored_price_basis, "unknown");
    assert.equal((await db.query<{ coverage_mode: string }>("select coverage_mode from brand_price_list_updates")).rows[0].coverage_mode, "legacy");
    assert.equal((await db.query<{ creation_legacy: boolean }>("select creation_legacy,last_price_checked_at from product_templates where id=$1", [b])).rows[0].creation_legacy, true);
    assert.equal((await db.query<{ last_price_checked_at: unknown }>("select last_price_checked_at from product_templates where id=$1", [b])).rows[0].last_price_checked_at, null);
    for (const basis of ["list", "net", "unknown"]) await db.query("update brands set stored_price_basis=$1", [basis]);
    await assert.rejects(db.exec("update brands set stored_price_basis='guessed'"), /check constraint/);
    for (const coverage of ["complete", "selected_templates", "partial", "legacy"]) await db.query("update brand_price_list_updates set coverage_mode=$1", [coverage]);
    await assert.rejects(db.exec("update brand_price_list_updates set coverage_mode='verified'"), /check constraint/);
  } finally { await db.close(); }
});

test("component insert/update/move/delete bumps correct parents, cascade is safe", async () => {
  const db = await fixture(); try {
    await db.exec(migration);
    await db.exec(`insert into product_components values('${c}','${a}',10,'EUR',1,true,'Option')`); assert.equal(await version(db), 1);
    await db.exec(`update product_components set component_name='New name' where id='${c}'`); assert.equal(await version(db), 1);
    for (const change of ["unit_price=20", "currency='USD'", "qty=2", "is_active=false"]) { const prior = await version(db); await db.exec(`update product_components set ${change} where id='${c}'`); assert.equal(await version(db), prior + 1); }
    const oldVersion = await version(db); await db.exec(`update product_components set template_id='${b}' where id='${c}'`); assert.equal(await version(db), oldVersion + 1); assert.equal(await version(db,b), 1);
    await db.exec(`delete from product_components where id='${c}'`); assert.equal(await version(db,b), 2);
    await db.exec(`insert into product_components values('${c}','${b}',10,'EUR',1,true,'Option'); delete from product_templates where id='${b}'`);
    assert.equal((await db.query<{ count: number }>("select count(*)::int as count from product_components")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("parent-first RPC locks parent before component write, rejects wrong parent and invalid currency", async () => {
  const db = await fixture(); try {
    await db.exec(migration); await db.exec(`insert into product_components values('${c}','${a}',10,'EUR',1,true,'Option')`);
    await db.exec(`select update_component_pricing_parent_first('${a}','${c}',20,'USD',2,false)`); assert.equal(await version(db), 2);
    await assert.rejects(db.exec(`select update_component_pricing_parent_first('${b}','${c}',30,'USD',2,false)`), /parent changed/);
    await assert.rejects(db.exec(`select update_component_pricing_parent_first('${a}','${c}',30,'GBP',2,false)`), /Invalid component/);
    const rpc = migration.slice(migration.indexOf("create or replace function public.update_component"));
    assert.ok(rpc.indexOf("for update") < rpc.indexOf("update public.product_components"));
    assert.match(rpc, /security invoker/);
  } finally { await db.close(); }
});

test("parent-first RPC preserves RLS and trigger operation for authenticated callers", async () => {
  const db = await fixture(); try {
    await db.exec(migration);
    await db.exec(`insert into product_components values('${c}','${a}',10,'EUR',1,true,'Option');
      grant select,update on product_templates,product_components to authenticated;
      alter table product_templates enable row level security; alter table product_components enable row level security;
      create policy template_read on product_templates for select to authenticated using (true);
      create policy template_write on product_templates for update to authenticated using (true) with check (true);
      create policy component_read on product_components for select to authenticated using (true);
      create policy component_write on product_components for update to authenticated using (false) with check (false);
      set role authenticated;`);
    await assert.rejects(db.exec(`select update_component_pricing_parent_first('${a}','${c}',20,'USD',2,false)`), /Component unavailable/);
    await db.exec("reset role; alter policy component_write on product_components using (true) with check (true); set role authenticated;");
    await db.exec(`select update_component_pricing_parent_first('${a}','${c}',20,'USD',2,false)`);
    assert.equal(await version(db), 2);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("creation marker excludes pre-baseline, already checked, and new post-migration records", async () => {
  const db = await fixture(); try {
    await db.exec(`update product_templates set created_at='2019-01-01' where id='${a}'; update product_templates set last_price_checked_at='2020-01-02' where id='${b}';`);
    await db.exec(migration);
    assert.deepEqual((await db.query<{ creation_legacy: boolean }>("select creation_legacy from product_templates order by id")).rows.map((row) => row.creation_legacy), [false,false]);
    await db.exec(`insert into product_templates(id,brand_id) values('${c}','${a}')`);
    assert.equal((await db.query<{ creation_legacy: boolean }>("select creation_legacy from product_templates where id=$1", [c])).rows[0].creation_legacy, false);
  } finally { await db.close(); }
});

test("old/new matrix shape round-trips label rename without re-keying prices", () => {
  for (const modular of [false,true]) {
    const group = matrix(modular); const columns = pricingColumns(group); columns[1].label = "Category B";
    const hardened = { ...group, price_columns: columns };
    const snapshot = { category_pricing: modular ? "[]" : JSON.stringify([hardened]), modular_item_pricing: modular ? JSON.stringify([hardened]) : "[]" };
    const workspace = productTemplateFormSmartWorkspace(snapshot);
    const output = modular ? mapDraftModularPricing(workspace.draft).groups[0] : mapDraftPriceMatricesToCategoryGroups(workspace.draft).groups[0];
    assert.deepEqual(output.items[0].prices, group.items[0].prices);
    assert.ok("price_columns" in output);
    assert.deepEqual(output.price_columns, columns);
    const saved = categoryPricingValue(modular ? "" : JSON.stringify([output]), modular ? JSON.stringify([output]) : "", "")[0];
    assert.ok("items" in saved && "price_columns" in saved);
    assert.deepEqual(saved.items[0].prices, group.items[0].prices);
    assert.deepEqual(saved.price_columns, columns);
    assert.deepEqual(pricingColumns(group), pricingColumns({ ...group, price_columns: pricingColumns(group) }));
  }
  assert.equal(initialPricingDimensionCode("Cat. D - Stretch / Melange"), "cat_d_stretch_melange");
  assert.throws(() => pricingColumns({ price_categories: ["Cat B","Cat-B"] }), /Conflicting/);
});

test("metadata-only column declarations preserve exact frozen keys on save", () => {
  const group = { ...matrix(), price_categories: [], price_columns: [{ id: " Cat A ", label: "Renamed A", dimension_code: "cat_a" }], items: [{ ...matrix().items[0], prices: { " Cat A ": 420 } }] };
  const saved = categoryPricingValue(JSON.stringify([group]), "", "")[0];
  assert.ok("items" in saved);
  assert.deepEqual(saved.items[0].prices, { " Cat A ": 420 });
});

test("strict currency path accepts only AED/EUR/USD and never falls back", () => {
  for (const code of ["AED","EUR","USD"]) assert.equal(parseSupportedCurrency(` ${code.toLowerCase()} `), code);
  for (const code of ["GBP","SAR","QAR","other","",null]) assert.equal(parseSupportedCurrency(code), null);
  const base = productTemplateFormSmartWorkspace({}).draft;
  for (const code of ["GBP","SAR","other"]) { const result = normalizeProductTemplateDraft({ ...base, defaultCurrency: code }); assert.equal(result.valid, false); assert.ok(result.errors.some((error) => error.path === "draft.defaultCurrency")); }
  const imported = productTemplateFormSmartWorkspace({ category_pricing: JSON.stringify([matrix()]) }).draft;
  imported.pricing.priceMatrices[0].rows[0].currency = "GBP" as never;
  assert.equal(normalizeProductTemplateDraft(imported).valid, false);
});

test("manufacturer normalizer preserves commercial separators and leading zeros", () => {
  for (const dash of ["‐","‑","‒","–","—","−"]) assert.equal(normalizeManufacturerCode(` ００１ ${dash} ab / c.d_e `), "001-AB/C.D_E");
  assert.equal(normalizeManufacturerCode(" 001   065 "), "001 065");
  assert.notEqual(normalizeManufacturerCode("001 065"), normalizeManufacturerCode("001065"));
  assert.notEqual(normalizeManufacturerCode("A-B"), normalizeManufacturerCode("AB"));
});
