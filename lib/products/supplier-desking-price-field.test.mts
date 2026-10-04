import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { brandPriceTargets } from "./supplier-price-targets.js";
import { matchSupplierPrices } from "./supplier-price-matching.js";
import type { ProductPriceInput, SourceIdentity } from "./supplier-price-contracts.js";

// OXI_P-like desking sizes: the base price is stored in default_price, the additional price in additional_price.
const sizes = [["111065", "111069", 400, 421], ["111066", "111070", 410, 439], ["111067", "111071", 420, 490], ["111068", "111072", 430, 500]] as const;
const oxi = (): ProductPriceInput => ({
  id: "oxi", brand_id: "brand", template_name: "OXI_P", pricing_version: 4, currency: "EUR", item_code: "OXI",
  desking_size_pricing: [{ id: "group", items: sizes.map(([base, extra, basePrice, extraPrice], index) => ({ id: `size-${index}`, base_supplier_price_list_code: base, additional_supplier_price_list_code: extra, default_price: basePrice, additional_price: extraPrice, qty: 1 })) }],
});
const supplier = (code: string, price: number): SourceIdentity => ({ key: `k-${code}`, code, price_field: "unit_price", dimension: "", finishes: [], price, currency: "EUR", row_keys: ["r"], issues: [] });

test("desking default and additional prices both compare as the Supplier unit_price, with the stored field untouched", () => {
  const targets = brandPriceTargets([oxi()]);
  assert.equal(targets.length, 8);
  for (const [base, extra] of sizes) {
    const baseTarget = targets.find((target) => target.code === base)!, extraTarget = targets.find((target) => target.code === extra)!;
    assert.deepEqual([baseTarget.physical_field, baseTarget.price_field], ["default_price", "unit_price"]);
    assert.deepEqual([extraTarget.physical_field, extraTarget.price_field], ["additional_price", "unit_price"]); // comparison label changed, storage did not
    assert.ok(extraTarget.key.includes("additional_price")); // identity, apply and history still address the stored field
    assert.notEqual(baseTarget.key, extraTarget.key);
  }
});

test("OXI_P additional-price articles match their Supplier unit prices (111069 / 111070 / 111071 / 111072)", () => {
  const targets = brandPriceTargets([oxi()]);
  const identities = [["111065", 400], ["111066", 410], ["111067", 420], ["111068", 430], ["111069", 421], ["111070", 439], ["111071", 490], ["111072", 500]].map(([code, price]) => supplier(String(code), Number(price)));
  const results = matchSupplierPrices(identities, targets);
  assert.equal(results.filter((item) => item.classification === "target_not_represented").length, 0);
  assert.equal(results.filter((item) => item.classification === "unchanged").length, 8);
  for (const code of ["111069", "111070", "111071", "111072"]) {
    const found = results.find((item) => item.source?.code === code)!;
    assert.equal(found.targets.length, 1, code); assert.equal(found.targets[0].physical_field, "additional_price", code); assert.equal(found.targets[0].raw_code, code);
  }
  const changed = matchSupplierPrices([supplier("111069", 430)], targets).find((item) => item.source)!;
  assert.deepEqual([changed.classification, changed.targets[0].price, changed.source!.price], ["increased", 421, 430]);
});

test("other architectures keep their comparison labels", () => {
  const targets = brandPriceTargets([{ id: "t", brand_id: "brand", template_name: "Variants", pricing_version: 1, currency: "EUR", item_code: null, variant_pricing: [{ id: "g", items: [{ id: "r", supplier_price_list_code: "V1", price: 10 }] }] } as ProductPriceInput]);
  assert.deepEqual(targets.map((target) => [target.physical_field, target.price_field]), [["price", "unit_price"]]);
});

const migrations = await Promise.all(["20261002082357_supplier_price_source_review", "20261004170000_supplier_desking_additional_price_comparison"].map((name) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8")));

test("the database verifier accepts the unit_price comparison for additional_price, keeps older snapshots valid, and still rejects forgeries", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint); create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
      create function public.current_user_can_review_brand_prices() returns boolean language sql as 'select true';
      create function public.current_user_can_approve_brand_prices() returns boolean language sql as 'select true';
      create table public.profiles(id uuid primary key); create table public.brands(id uuid primary key);
      create table public.product_templates(id uuid primary key,brand_id uuid,is_active boolean default true,pricing_version bigint default 0,currency text,item_code text,default_unit_price numeric,desking_size_pricing jsonb default '[]');
      create table public.brand_price_list_updates(id uuid primary key);`);
    await db.exec(migrations[0]);
    const template = { ...oxi(), id: "00000000-0000-0000-0000-0000000000a1", brand_id: "00000000-0000-0000-0000-0000000000b1" };
    await db.query("insert into public.brands values($1)", [template.brand_id]);
    await db.query("insert into public.product_templates(id,brand_id,pricing_version,currency,item_code,desking_size_pricing) values($1,$2,4,'EUR','OXI',$3)", [template.id, template.brand_id, JSON.stringify(oxi().desking_size_pricing)]);
    const targets = brandPriceTargets([template as ProductPriceInput]);
    const additional = targets.find((target) => target.code === "111069")!, base = targets.find((target) => target.code === "111065")!;
    const verify = (target: Record<string, unknown>) => db.query("select supplier_price_private.verify_target($1::jsonb,$2::uuid)", [JSON.stringify(target), template.brand_id]);
    await assert.rejects(verify(additional), /Invalid workstation price field/); // before the migration the new label is refused
    await db.exec(migrations[1]); await db.exec(migrations[1]); // idempotent
    await verify(additional); await verify(base);
    await verify({ ...additional, price_field: "additional_price" }); // snapshots built before this change remain valid
    await assert.rejects(verify({ ...additional, price_field: "default_price" }), /Invalid workstation price field/);
    await assert.rejects(verify({ ...additional, price: 1 }), /changed or forged/);
    await assert.rejects(verify({ ...base, price_field: "additional_price" }), /Invalid workstation price field/);
    assert.equal((await db.query<{ prosecdef: boolean }>("select prosecdef from pg_proc where proname='verify_target'")).rows[0].prosecdef, false); // still invoker
  } finally { await db.close(); }
});
