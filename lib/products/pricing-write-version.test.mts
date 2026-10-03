import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { assertProductPricingCurrencies, expectedPricingVersion, pricingConflictMessage, requireProductPricingCurrency } from "./pricing-write-version.js";

const foundation = await readFile(new URL("../../supabase/migrations/20261002060146_pricing_identity_version_foundation.sql", import.meta.url), "utf8");
const corrective = await readFile(new URL("../../supabase/migrations/20261002065310_pricing_writer_concurrency.sql", import.meta.url), "utf8");
const supplierDefault = await readFile(new URL("../../supabase/migrations/20261003141259_supplier_default_price_writer.sql", import.meta.url), "utf8");
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const c = "00000000-0000-0000-0000-000000000003";
const conflict = /This Product Template changed\. Reload before saving\./;

async function fixture(includeSupplierDefault = true) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as 'select ''${a}''::uuid';
    create function public.current_user_is_active() returns boolean language sql as 'select true';
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
      source_table text,source_record_id text,price_field text,old_price numeric,new_price numeric,currency text,effective_from date,note text check(note <> 'block'),changed_by uuid);
    insert into brands values('${a}',null),('${b}',null);
    insert into brand_price_list_updates values('${c}','${a}','active');
    insert into product_templates(id,brand_id) values('${a}','${a}'),('${b}','${b}');
  `);
  await db.exec(foundation);
  await db.exec(corrective);
  if (includeSupplierDefault) await db.exec(supplierDefault);
  return db;
}
async function version(db: PGlite, id = a) {
  return (await db.query<{ pricing_version: number }>("select pricing_version from product_templates where id=$1", [id])).rows[0].pricing_version;
}
async function historyCount(db: PGlite, detail = false) {
  return (await db.query<{ count: number }>(`select count(*)::int as count from ${detail ? "product_template_detail_price_history" : "product_template_price_history"}`)).rows[0].count;
}
async function manual(db: PGlite, expected: number | null, mode = "default", payload: unknown = { default_unit_price: 20, currency: "USD" }, history: unknown = {}) {
  return (await db.query<{ version: number }>("select write_product_price_with_history_at_version($1,$2,$3,$4,$5) as version", [a, expected, mode, JSON.stringify(payload), JSON.stringify(history)])).rows[0].version;
}
const componentPayload = (price = 20) => ({ template_id: a, option_type: "other", component_group: "Options", component_code: "001-A", component_name: "Option",
  description: null, qty: 1, unit_label: "Pc", unit_price: price, currency: "EUR", is_optional: true, is_default_selected: false, sort_order: 0, is_active: true, price_notes: null, calculation_data: {} });
async function component(db: PGlite, expected: number | null, operation: string, id: string | null = null, payload: unknown = {}, template = a) {
  return (await db.query<{ version: number }>("select write_product_component_at_version($1,$2,$3,$4,$5) as version", [template, expected, operation, id, JSON.stringify(payload)])).rows[0].version;
}
async function createComponent(db: PGlite) {
  await component(db, await version(db), "create", null, componentPayload());
  return (await db.query<{ id: string }>("select id from product_components order by id limit 1")).rows[0].id;
}

test("tokens reject missing/unsafe versions; strict currencies never default unsupported input", () => {
  for (const invalid of [null, undefined, "", "-1", "1.2", "Infinity", 1.5, Number.MAX_SAFE_INTEGER + 1, "9223372036854775808"]) assert.equal(expectedPricingVersion(invalid), null);
  for (const [input, output] of [[0,"0"],[4,"4"],[" 005 ","5"],["9223372036854775807","9223372036854775807"]]) assert.equal(expectedPricingVersion(input), output);
  for (const code of ["AED","EUR","USD"]) assert.equal(requireProductPricingCurrency(` ${code.toLowerCase()} `), code);
  for (const code of ["GBP","SAR","garbage",""]) assert.throws(() => requireProductPricingCurrency(code), /Unsupported/);
  assertProductPricingCurrencies({ currency: "EUR", items: [{ currency: null }, { currency: "USD" }] });
  assert.throws(() => assertProductPricingCurrencies({ items: [{ currency: "GBP" }] }), /Unsupported/);
});

test("conditional whole-form and quotation-library writes reject stale JSON; metadata-only writes keep version", async () => {
  const db = await fixture();
  try {
    const old = await version(db);
    await db.query("update product_templates set template_name='Name' where id=$1 and pricing_version=$2", [a, old]);
    assert.equal(await version(db), old);
    await db.query("update product_templates set variant_pricing=$1,category_pricing=$2 where id=$3 and pricing_version=$4", [JSON.stringify([{ id:"new-variant",price:30 }]), JSON.stringify([{ id:"new-category",prices:{"Cat A":40} }]), a, old]);
    assert.equal(await version(db), old + 1);
    const stale = await db.query("update product_templates set variant_pricing='[]',category_pricing='[]' where id=$1 and pricing_version=$2 returning id", [a, old]);
    assert.equal(stale.rows.length, 0);
    const append = await db.query("update product_templates set variant_pricing='[]' where id=$1 and pricing_version=$2 returning id", [a, old]);
    assert.equal(append.rows.length, 0);
    assert.deepEqual((await db.query<{ variant_pricing: unknown; category_pricing: unknown }>("select variant_pricing,category_pricing from product_templates where id=$1", [a])).rows[0], { variant_pricing:[{id:"new-variant",price:30}],category_pricing:[{id:"new-category",prices:{"Cat A":40}}] });
    await db.query("insert into product_templates(id,brand_id) values($1,$2)", [c,a]);
    assert.equal(await version(db,c), 0);
  } finally { await db.close(); }
});

test("default history is atomic, rejects stale/missing versions, and returns the next sequential token", async () => {
  const db = await fixture();
  try {
    await assert.rejects(manual(db, null), conflict);
    await assert.rejects(manual(db, 99), conflict);
    assert.equal(await historyCount(db), 0);
    const first = await manual(db, 0);
    assert.equal(first, 1);
    assert.equal(await manual(db, first, "default", { default_unit_price: 30, currency: "EUR" }), 2);
    assert.deepEqual((await db.query<{ old_default_unit_price: number; new_default_unit_price: number }>("select old_default_unit_price::int,new_default_unit_price::int from product_template_price_history order by new_default_unit_price")).rows, [{old_default_unit_price:10,new_default_unit_price:20},{old_default_unit_price:20,new_default_unit_price:30}]);
    await assert.rejects(manual(db, 2, "default", {default_unit_price:40,currency:"AED"}, {note:"block"}), /check constraint/);
    assert.equal(await version(db), 2);
    assert.equal(await historyCount(db), 2);
    assert.equal((await db.query<{ default_unit_price: number }>("select default_unit_price::int from product_templates where id=$1", [a])).rows[0].default_unit_price, 30);
    await assert.rejects(manual(db, 2, "default", {default_unit_price:40,currency:"GBP"}), /Invalid Product/);
    await assert.rejects(manual(db, 2, "default", {default_unit_price:40,currency:"AED"}, {brand_price_list_update_id:b}), /could not be loaded/);
    assert.equal(await historyCount(db), 2);
    assert.equal(await manual(db,2,"default",{default_unit_price:40,currency:"AED"}),3);
  } finally { await db.close(); }
});

test("a failed default mutation cannot produce history", async () => {
  const db = await fixture();
  try {
    await db.exec("create function fail_price() returns trigger language plpgsql as $$ begin raise exception 'mutation failed'; end $$; create trigger fail_price before update on product_templates for each row execute function fail_price();");
    await assert.rejects(manual(db, 0), /mutation failed/);
    assert.equal(await historyCount(db), 0);
    assert.equal(await version(db), 0);
  } finally { await db.close(); }
});

async function seedPriceCheckMetadata(db: PGlite) {
  await db.query("update product_templates set last_price_checked_at='2026-01-02T03:04:05Z',last_price_checked_by=$1,price_check_note='Previously checked' where id=$2", [b,a]);
  await db.query("update brands set last_price_list_checked_at='2026-01-01T00:00:00Z' where id=$1", [a]);
}
async function priceCheckMetadata(db: PGlite) {
  return (await db.query<{ last_price_checked_at: Date | null; last_price_checked_by: string | null; price_check_note: string | null }>("select last_price_checked_at,last_price_checked_by,price_check_note from product_templates where id=$1", [a])).rows[0];
}
async function brandReviewState(db: PGlite) {
  return (await db.query("select row_to_json(b) as data from brands b union all select row_to_json(u) from brand_price_list_updates u")).rows;
}

test("supplier_default writes one atomic history row and preserves Product and Brand review metadata", async () => {
  const db = await fixture();
  try {
    await seedPriceCheckMetadata(db);
    const checked = await priceCheckMetadata(db), brandState = await brandReviewState(db);
    const history = { brand_price_list_update_id:c, effective_from:"2026-10-03", note:"Supplier source: verified list; batch: batch; match: match" };
    assert.equal(await manual(db,0,"supplier_default",{default_unit_price:20,currency:"USD"},history),1);
    assert.equal(await version(db),1);
    assert.deepEqual((await db.query("select default_unit_price::int,currency from product_templates where id=$1",[a])).rows[0],{default_unit_price:20,currency:"USD"});
    assert.deepEqual(await priceCheckMetadata(db),checked);
    assert.deepEqual(await brandReviewState(db),brandState);
    assert.equal(await historyCount(db),1);
    assert.deepEqual((await db.query("select product_template_id,brand_id,brand_price_list_update_id,old_default_unit_price::int,new_default_unit_price::int,currency,effective_from::text,note,changed_by from product_template_price_history")).rows[0],{
      product_template_id:a,brand_id:a,brand_price_list_update_id:c,old_default_unit_price:10,new_default_unit_price:20,currency:"USD",effective_from:"2026-10-03",note:history.note,changed_by:a,
    });
    assert.equal(await historyCount(db,true),0);
  } finally { await db.close(); }
});

test("manual default still updates check metadata and preserves its empty-note behavior", async () => {
  const db = await fixture();
  try {
    await seedPriceCheckMetadata(db);
    const before = await priceCheckMetadata(db);
    assert.equal(await manual(db,0,"default",{default_unit_price:20,currency:"EUR"},{note:"Manual review"}),1);
    const after = await priceCheckMetadata(db);
    assert.notDeepEqual(after.last_price_checked_at,before.last_price_checked_at);
    assert.equal(after.last_price_checked_by,a);
    assert.equal(after.price_check_note,"Manual review");
    await manual(db,1,"default",{default_unit_price:30,currency:"EUR"},{note:""});
    assert.equal((await priceCheckMetadata(db)).price_check_note,"Manual review");
    await manual(db,2,"default",{default_unit_price:40,currency:"EUR"});
    assert.equal((await priceCheckMetadata(db)).price_check_note,"Manual review");
    assert.equal(await historyCount(db),3);
  } finally { await db.close(); }
});

test("supplier_default rejects missing/stale versions including repeat application without another history row", async () => {
  const db = await fixture();
  try {
    await seedPriceCheckMetadata(db);
    const before = await priceCheckMetadata(db);
    for (const expected of [null,99]) await assert.rejects(manual(db,expected,"supplier_default"),conflict);
    assert.equal(await version(db),0);
    assert.equal(await historyCount(db),0);
    assert.equal((await db.query<{price:number}>("select default_unit_price::int as price from product_templates where id=$1",[a])).rows[0].price,10);
    assert.equal(await manual(db,0,"supplier_default"),1);
    await assert.rejects(manual(db,0,"supplier_default",{default_unit_price:30,currency:"EUR"}),conflict);
    assert.equal(await version(db),1);
    assert.equal(await historyCount(db),1);
    assert.equal((await db.query<{price:number}>("select default_unit_price::int as price from product_templates where id=$1",[a])).rows[0].price,20);
    assert.deepEqual(await priceCheckMetadata(db),before);
  } finally { await db.close(); }
});

test("supplier_default validates currency, amount, object shape, extra fields and Brand-list ownership", async () => {
  const db = await fixture();
  try {
    const invalid = [null,[],{}, {default_unit_price:20}, {currency:"EUR"}, {default_unit_price:null,currency:"EUR"}, {default_unit_price:-1,currency:"EUR"}, {default_unit_price:"NaN",currency:"EUR"}, {default_unit_price:"Infinity",currency:"EUR"}, {default_unit_price:"20",currency:"EUR"}, {default_unit_price:20,currency:null}, {default_unit_price:20,currency:"GBP"}, {default_unit_price:20,currency:"eur"}, {default_unit_price:20,currency:"EUR",last_price_checked_at:"2026-10-03"}];
    for (const payload of invalid) await assert.rejects(manual(db,0,"supplier_default",payload),/Invalid/);
    await db.query("insert into brand_price_list_updates values($1,$2,'active')",[b,b]);
    await assert.rejects(manual(db,0,"supplier_default",{default_unit_price:20,currency:"EUR"},{brand_price_list_update_id:b}),/could not be loaded/);
    assert.equal(await version(db),0);
    assert.equal(await historyCount(db),0);
    for (const currency of ["AED","EUR","USD"]) {
      const current = await version(db);
      assert.equal(await manual(db,current,"supplier_default",{default_unit_price:20+current,currency}),current+1);
    }
    const history = (await db.query<{ brand_price_list_update_id: string | null; effective_from: string | null }>("select brand_price_list_update_id,effective_from from product_template_price_history")).rows;
    assert.ok(history.every((row: { brand_price_list_update_id: string | null; effective_from: string | null }) => row.brand_price_list_update_id === null && row.effective_from === null));
  } finally { await db.close(); }
});

test("supplier_default history failure rolls back price, version and metadata", async () => {
  const db = await fixture();
  try {
    await seedPriceCheckMetadata(db);
    const before = (await db.query("select row_to_json(t) as data from product_templates t where id=$1",[a])).rows;
    await assert.rejects(manual(db,0,"supplier_default",{default_unit_price:20,currency:"EUR"},{note:"block"}),/check constraint/);
    assert.deepEqual((await db.query("select row_to_json(t) as data from product_templates t where id=$1",[a])).rows,before);
    assert.equal(await historyCount(db),0);
  } finally { await db.close(); }
});

test("supplier_default keeps active-user and invoker/RLS enforcement", async () => {
  const db = await fixture();
  try {
    await db.exec("create or replace function public.current_user_is_active() returns boolean language sql as 'select false';");
    await assert.rejects(manual(db,0,"supplier_default"),/insufficient_privilege/);
    await db.exec(`create or replace function public.current_user_is_active() returns boolean language sql as 'select true';
      grant usage on schema auth to authenticated;
      grant select,update on product_templates to authenticated;
      grant select,insert on product_template_price_history to authenticated;
      alter table product_templates enable row level security;
      alter table product_template_price_history enable row level security;
      create policy template_read on product_templates for select to authenticated using(true);
      create policy template_write on product_templates for update to authenticated using(true) with check(true);
      create policy history_read on product_template_price_history for select to authenticated using(true);
      create policy history_write on product_template_price_history for insert to authenticated with check(false);
      set role authenticated;`);
    await assert.rejects(manual(db,0,"supplier_default"),/row-level security/);
    assert.equal(await version(db),0);
    assert.equal(await historyCount(db),0);
    await db.exec("reset role; alter policy history_write on product_template_price_history with check(true); set role authenticated;");
    assert.equal(await manual(db,0,"supplier_default"),1);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("forward writer migration preserves function identity, permissions and data and can be reapplied", async () => {
  const db = await fixture(false);
  try {
    await seedPriceCheckMetadata(db);
    const state = async () => (await db.query("select row_to_json(t) as data from product_templates t union all select row_to_json(c) from product_components c union all select row_to_json(b) from brands b union all select row_to_json(u) from brand_price_list_updates u union all select row_to_json(h) from product_template_price_history h union all select row_to_json(h) from product_template_detail_price_history h")).rows;
    const contract = async () => (await db.query("select oid,proowner,proacl,prosecdef,proconfig,pg_get_function_identity_arguments(oid) as arguments,pg_get_function_result(oid) as result from pg_proc where oid='public.write_product_price_with_history_at_version(uuid,bigint,text,jsonb,jsonb)'::regprocedure")).rows;
    const beforeState = await state(), beforeContract = await contract();
    await db.exec(supplierDefault);
    await db.exec(supplierDefault);
    assert.deepEqual(await state(),beforeState);
    assert.deepEqual(await contract(),beforeContract);
  } finally { await db.close(); }
});

test("JSON detail writers guard all four columns and commit history together", async () => {
  const db = await fixture();
  try {
    await seedPriceCheckMetadata(db);
    const checked = await priceCheckMetadata(db), brandState = await brandReviewState(db);
    for (const column of ["variant_pricing","category_pricing","desking_size_pricing","accessory_pricing"]) {
      const v = await version(db);
      const rows = [{id:"group",items:[{id:"row",currency:"EUR",price:20,prices:{"Cat A":20}}]}];
      const history = {source_table:`product_templates.${column}`,source_record_id:"row",price_field:column === "category_pricing" ? "prices.Cat A" : column === "desking_size_pricing" ? "default_price" : "price",old_price:10,new_price:20,currency:"EUR"};
      assert.equal(await manual(db,v,"detail",{[column]:rows},history),v+1);
      await assert.rejects(manual(db,v,"detail",{[column]:[]},history),conflict);
      const before = await historyCount(db,true);
      await assert.rejects(manual(db,v+1,"detail",{[column]:[]},{...history,note:"block"}),/check constraint/);
      assert.equal(await historyCount(db,true),before);
      assert.deepEqual((await db.query<Record<string, unknown>>(`select ${column} from product_templates where id=$1`,[a])).rows[0][column],rows);
    }
    assert.equal(await historyCount(db,true),4);
    assert.deepEqual(await priceCheckMetadata(db),checked);
    assert.deepEqual(await brandReviewState(db),brandState);
  } finally { await db.close(); }
});

test("components create/update verify ownership, reject stale/missing tokens, and never move parents", async () => {
  const db = await fixture();
  try {
    await assert.rejects(component(db,null,"create",null,componentPayload()),conflict);
    const id = await createComponent(db);
    assert.equal(await version(db),1);
    await assert.rejects(component(db,0,"update",id,componentPayload(30)),conflict);
    await assert.rejects(component(db,0,"update",id,{...componentPayload(30),template_id:b},b),/Component unavailable/);
    await assert.rejects(component(db,1,"update",id,{...componentPayload(30),template_id:b}),/Invalid component/);
    assert.equal(await component(db,1,"update",id,{...componentPayload(30),currency:"USD",qty:2}),2);
    assert.equal(await version(db,b),0);
    assert.deepEqual((await db.query<{template_id:string;unit_price:number;qty:number;currency:string}>("select template_id,unit_price::int,qty::int,currency from product_components where id=$1",[id])).rows[0],{template_id:a,unit_price:30,qty:2,currency:"USD"});
    await assert.rejects(component(db,2,"update",id,{...componentPayload(40),currency:"SAR"}),/Invalid component/);
    const lockIndex = corrective.indexOf("where id=p_template_id for update");
    assert.ok(lockIndex < corrective.indexOf("insert into public.product_components"));
    assert.ok(lockIndex < corrective.indexOf("perform public.update_component_pricing_parent_first"));
  } finally { await db.close(); }
});

test("single and group deactivate check the parent once and bump through existing triggers", async () => {
  const db = await fixture();
  try {
    const first = await createComponent(db);
    await component(db,1,"create",null,{...componentPayload(),component_name:"Second"});
    await assert.rejects(component(db,1,"deactivate",first),conflict);
    assert.equal(await component(db,2,"deactivate",first),3);
    await assert.rejects(component(db,2,"deactivate_group",null,{option_type:"other",component_group:"Options"}),conflict);
    assert.equal(await component(db,3,"deactivate_group",null,{option_type:"other",component_group:"Options"}),4);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from product_components where is_active")).rows[0].count,0);
  } finally { await db.close(); }
});

test("component detail pricing and history roll back together without double increments", async () => {
  const db = await fixture();
  try {
    const id = await createComponent(db);
    const history = {source_table:"product_components",source_record_id:id,price_field:"unit_price",new_price:35,currency:"USD"};
    assert.equal(await manual(db,1,"detail",{unit_price:35,currency:"USD"},history),2);
    assert.equal(await historyCount(db,true),1);
    assert.equal((await db.query<{old_price:number}>("select old_price::int from product_template_detail_price_history")).rows[0].old_price,20);
    await assert.rejects(manual(db,1,"detail",{unit_price:35},history),conflict);
    await assert.rejects(manual(db,2,"detail",{unit_price:50},{...history,new_price:50,note:"block"}),/check constraint/);
    assert.equal(await version(db),2);
    assert.equal((await db.query<{unit_price:number}>("select unit_price::int from product_components where id=$1",[id])).rows[0].unit_price,35);
    assert.equal(await historyCount(db,true),1);
  } finally { await db.close(); }
});

test("invoker RPCs enforce existing RLS and history denial rolls back mutations", async () => {
  const db = await fixture();
  try {
    await db.exec(`grant usage on schema auth to authenticated;
      grant select,update on product_templates to authenticated; grant select,insert,update on product_components to authenticated;
      grant select,insert on product_template_price_history,product_template_detail_price_history to authenticated;
      alter table product_templates enable row level security; alter table product_components enable row level security;
      alter table product_template_price_history enable row level security;
      create policy template_read on product_templates for select to authenticated using(true);
      create policy template_write on product_templates for update to authenticated using(true) with check(true);
      create policy component_read on product_components for select to authenticated using(true);
      create policy component_insert on product_components for insert to authenticated with check(false);
      create policy history_read on product_template_price_history for select to authenticated using(true);
      create policy history_write on product_template_price_history for insert to authenticated with check(false);
      set role authenticated;`);
    await assert.rejects(manual(db,0),/row-level security/);
    await assert.rejects(component(db,0,"create",null,componentPayload()),/row-level security/);
    assert.equal(await version(db),0); assert.equal(await historyCount(db),0);
    await db.exec("reset role; alter policy history_write on product_template_price_history with check(true); set role authenticated;");
    assert.equal(await manual(db,0),1);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("named action/form contracts propagate tokens through Smart Setup, imports, and modal refresh", async () => {
  const source = async (path:string) => readFile(new URL(`../../${path}`,import.meta.url),"utf8");
  const actions = await source("app/products/templates/actions.ts");
  for (const name of ["updateProductTemplate","updateProductTemplateForQuotationModal","updateProductTemplateDefaultPrice","updateProductTemplateDetailPrice","createProductComponent","updateProductComponent","deactivateProductComponent","deactivateProductComponentGroup"]) {
    const start = actions.indexOf(`export async function ${name}(`);
    const end = actions.indexOf("export async function",start+1);
    const body = actions.slice(start,end < 0 ? undefined : end);
    assert.match(body,/expectedPricingVersion\(formData.get\("expected_pricing_version"\)\)/,name);
    assert.match(body,/pricingConflictMessage/,name);
    assert.match(body,name === "updateProductTemplate" || name === "updateProductTemplateForQuotationModal" ? /\.eq\("pricing_version", expectedVersion\)/ : /p_expected_version: expectedVersion/,name);
  }
  const form = await source("components/products/product-template-form.tsx");
  assert.match(form,/name="expected_pricing_version" value=\{template.pricing_version \?\? ""\}/);
  assert.match(form,/pricingRef.current\?\.closest\("form"\)\?\.requestSubmit\(\)/);
  assert.match(form,/submitMode === "update" \? updateProductTemplate : createProductTemplate/);
  assert.match(form,/preserveFailedSave.current = true/);
  const shell = await source("components/products/template-form-shell.tsx");
  assert.match(shell,/onReset=.*preventReset\?\.\(\).*preventDefault/);
  const page = await source("app/products/templates/page.tsx");
  assert.match(page,/pricing_version,id,brand_id/);
  assert.match(page,/key=\{template.pricing_version\}/);
  const modal = await source("components/quotations/product-library-selector.tsx");
  assert.match(modal,/updateTemplateRecord\(result.template as ProductLibraryTemplate\)/);
  assert.match(await source("app/quotations/[id]/builder/page.tsx"),/pricing_version,id,brand_id/);
  const libraryActions = await source("app/quotations/actions.ts");
  const append = libraryActions.slice(libraryActions.indexOf('if (saveMode === "existing_family_variant")'),libraryActions.indexOf('const description = optionalTextValue(formData, "description");',libraryActions.indexOf('if (saveMode === "existing_family_variant")')));
  assert.match(append,/variant_pricing,is_active,pricing_version/);
  assert.match(append,/expectedPricingVersion\(existingTemplate.pricing_version\)/);
  assert.match(append,/\.eq\("pricing_version", expectedVersion\)/);
  assert.match(append,/if \(!savedTemplate\) redirectWithMessage\(redirectPath, pricingConflictMessage\)/);
  assert.equal(pricingConflictMessage,"This Product Template changed. Reload before saving.");
});
