import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supplierApplyReviewedPrice, supplierBrandTargets } from "./supplier-price-repository.js";
import type { PriceMatch, SourceIdentity, SourceVersion, ReviewBatch } from "./supplier-price-contracts.js";

const a = "00000000-0000-0000-0000-000000000001", b = "00000000-0000-0000-0000-000000000002", c = "00000000-0000-0000-0000-000000000003";
const fresh = /This Product Template changed\. Build a fresh Supplier comparison before applying\./;
const migrations = await Promise.all(["20261002060146_pricing_identity_version_foundation.sql", "20261002065310_pricing_writer_concurrency.sql", "20261003141259_supplier_default_price_writer.sql"].map((name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8")));

// Same isolated transpile/inject pattern as the AI Settings tests. Node's module
// mocks intercept CommonJS loading before tsx can resolve @/ imports. Inject only
// boundary mocks here; real local dependencies (including permissions) still load.
async function loadTestModule<T>(path: string, dependencies: Record<string, unknown>): Promise<T> {
  const url = new URL(path, import.meta.url);
  const require = createRequire(url);
  const output = ts.transpileModule(await readFile(url, "utf8"), {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return require(name.startsWith("@/") ? fileURLToPath(new URL(`../../${name.slice(2)}`, import.meta.url)) : name);
  }, compiled, compiled.exports);
  return compiled.exports as T;
}
type Batch = ReviewBatch & { brand_price_list_update_id: string | null };
type State = { batch: Batch; source: SourceVersion; match: { batch_id: string; key: string; data: PriceMatch; supplier_price_decisions: { decision: string } | null }; identity: { source_id: string; key: string; data: SourceIdentity } };

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as 'select ''${a}''::uuid';
    create function public.current_user_is_active() returns boolean language sql as 'select true';
    create table brands(id uuid primary key,last_price_list_checked_at timestamptz);
    create table brand_price_list_updates(id uuid primary key,brand_id uuid,status text);
    create table product_templates(id uuid primary key,brand_id uuid,template_name text,item_code text,description text,default_image_url text,price_notes text,
      last_price_checked_at timestamptz,last_price_checked_by uuid,price_check_note text,created_at timestamptz default now(),is_active boolean default true,
      default_unit_price numeric default 100,currency text default 'EUR',variant_pricing jsonb default '[]',category_pricing jsonb default '[]',desking_size_pricing jsonb default '[]',accessory_pricing jsonb default '[]');
    create table product_components(id uuid primary key,template_id uuid not null references product_templates(id),option_type text,component_group text,component_code text,component_name text,description text,
      qty numeric,unit_label text,unit_price numeric,currency text,is_optional boolean,is_default_selected boolean,sort_order int,is_active boolean,price_notes text,calculation_data jsonb,created_by uuid);
    create table product_template_price_history(id uuid default gen_random_uuid(),product_template_id uuid,brand_id uuid,brand_price_list_update_id uuid,old_default_unit_price numeric,new_default_unit_price numeric,currency text,effective_from date,note text,changed_by uuid);
    create table product_template_detail_price_history(id uuid default gen_random_uuid(),product_template_id uuid,brand_id uuid,brand_price_list_update_id uuid,source_table text,source_record_id text,price_field text,old_price numeric,new_price numeric,currency text,effective_from date,note text,changed_by uuid);
    create table quotations(id uuid primary key,total numeric); insert into quotations values('${a}',500);
    insert into brands values('${a}','2026-01-01'); insert into brand_price_list_updates values('${c}','${a}','draft');
    insert into product_templates(id,brand_id,template_name,item_code,last_price_checked_at,last_price_checked_by,price_check_note) values('${a}','${a}','Existing','SIMPLE','2026-01-02','${b}','Earlier review');`);
  for (const sql of migrations) await db.exec(sql);
  await db.exec("update brands set stored_price_basis='list'");
  const source: SourceVersion = { id: b, brand_id: a, title: "Supplier list", status: "imported", currency: "EUR", basis: "list", effective_from: "2026-10-03", profile: { full_code_column: "CODE", strategy: "exact", currency: "EUR", basis: "list", price_columns: [{ column: "PRICE", price_field: "unit_price" }] }, filename: "source.csv", file_hash: "a".repeat(64), source_type: "csv", expected_rows: 1, expected_cells: 1, expected_chunks: 1, stored_rows: 1, stored_cells: 1, identity_count: 1, original_reference: null, working_reference: null, received_at: null };
  const identity: SourceIdentity = { key: "source-key", code: "SIMPLE", price_field: "unit_price", dimension: "", finishes: [], price: 110, currency: "EUR", row_keys: ["row"], issues: [] };
  const state: State = { batch: { id: c, brand_id: a, source_id: b, scope: "partial", selected_template_ids: [], status: "review", basis_warning: "", title: "Review", brand_price_list_update_id: c }, source,
    match: { batch_id: c, key: "match-key", data: { key: "match-key", source: structuredClone(identity), targets: [], classification: "increased", candidate_shared: false }, supplier_price_decisions: { decision: "reviewed" } }, identity: { source_id: b, key: identity.key, data: identity } };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let beforeRpc: (() => Promise<void>) | undefined;
  // Test transport: authoritative Product reads and writer RPC execute in real PostgreSQL.
  // Supplier records are immutable fixtures; filters implement the action's ownership lookups.
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {}; let start = 0, end = 499;
      const execute = async () => {
        let rows: Record<string, unknown>[];
        if (table === "supplier_price_batches") rows = [state.batch];
        else if (table === "supplier_source_versions") rows = [state.source];
        else if (table === "supplier_price_matches") rows = [state.match];
        else if (table === "supplier_source_identities") rows = [state.identity];
        else if (table === "product_components") rows = (await db.query<Record<string, unknown>>("select c.*,t.brand_id as \"product_templates.brand_id\" from product_components c join product_templates t on t.id=c.template_id order by c.id")).rows;
        else if (["product_templates", "brands"].includes(table)) rows = (await db.query<Record<string, unknown>>(`select * from ${table} order by id`)).rows;
        else throw Error(`Unexpected table: ${table}`);
        // PostgREST emits numeric price columns as JSON numbers; PGlite returns numeric strings.
        if (table === "product_templates" || table === "product_components") rows = rows.map((row) => {
          const field = table === "product_templates" ? "default_unit_price" : "unit_price";
          return { ...row, [field]: row[field] === null ? null : Number(row[field]) };
        });
        return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value)).slice(start, end + 1);
      };
      return { select() { return this; }, eq(key: string, value: unknown) { filters[key] = value; return this; }, order() { return this; }, range(from: number, to: number) { start = from; end = to; return this; },
        async single() { const rows = await execute(); return { data: rows.length === 1 ? structuredClone(rows[0]) : null, error: rows.length === 1 ? null : { message: "Record unavailable" } }; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then((data) => resolve({ data, error: null }), reject); } };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args }); if (beforeRpc) await beforeRpc();
      assert.equal(name, "write_product_price_with_history_at_version");
      try { const result = await db.query<{ version: number }>("select public.write_product_price_with_history_at_version($1,$2,$3,$4,$5) version", [args.p_template_id, args.p_expected_version, args.p_mode, JSON.stringify(args.p_payload), JSON.stringify(args.p_history)]); return { data: result.rows[0].version, error: null }; }
      catch (error) { return { data: null, error: { message: (error as Error).message } }; }
    },
  } as unknown as SupabaseClient;
  async function compare(code = "SIMPLE") {
    const { targets } = await supplierBrandTargets(client, a); const target = targets.find((item) => item.code === code); assert.ok(target);
    state.match.data.targets = [target]; state.identity.data.code = code; state.identity.data.price_field = target.price_field;
    state.match.data.source = structuredClone(state.identity.data);
  }
  await compare();
  const apply = () => supplierApplyReviewedPrice(client, c, "match-key");
  const version = async () => (await db.query<{ pricing_version: number }>("select pricing_version from product_templates where id=$1", [a])).rows[0].pricing_version;
  const untouched = async () => (await db.query("select jsonb_build_object('checked_at',last_price_checked_at,'checked_by',last_price_checked_by,'note',price_check_note) data from product_templates union all select to_jsonb(b) from brands b union all select to_jsonb(u) from brand_price_list_updates u union all select to_jsonb(q) from quotations q")).rows;
  return { db, state, client, calls, compare, apply, version, untouched, beforeRpc(work: () => Promise<void>) { beforeRpc = work; } };
}

test("all eligibility and ownership failures refuse the writer without changing Products", async () => {
  const f = await fixture();
  try {
    const original = structuredClone(f.state), before = await f.untouched();
    const cases: Array<[string, (state: State) => Promise<void> | void, RegExp]> = [
      ["unknown source basis", (s) => { s.source.basis = "unknown"; }, /basis must be confirmed/],
      ["unknown Brand basis", async () => { await f.db.exec("update brands set stored_price_basis='unknown'"); }, /basis must be confirmed/],
      ["basis mismatch", (s) => { s.source.basis = "net"; }, /does not match/],
      ["source incomplete", (s) => { s.source.status = "uploading"; }, /must be imported/],
      ["source archived", (s) => { s.source.status = "archived"; }, /must be imported/],
      ["batch not review", (s) => { s.batch.status = "building"; }, /must be in review/],
      ["missing decision", (s) => { s.match.supplier_price_decisions = null; }, /Review this Supplier/],
      ["skip decision", (s) => { s.match.supplier_price_decisions = { decision: "skip" }; }, /Review this Supplier/],
      ["embedded decision cannot approve", (s) => { s.match.data.decision = "reviewed"; s.match.supplier_price_decisions = null; }, /Review this Supplier/],
      ["multiple targets", (s) => { s.match.data.targets.push(structuredClone(s.match.data.targets[0])); }, /multiple-target/],
      ["null source price", (s) => { s.match.data.source!.price = null; }, /price is invalid/],
      ["currency mismatch", (s) => { s.match.data.targets[0].currency = "USD"; }, /currencies must match/],
      ["unsupported currency", (s) => { Object.assign(s.source, { currency: "GBP" }); Object.assign(s.identity.data, { currency: "GBP" }); Object.assign(s.match.data.source!, { currency: "GBP" }); }, /Unsupported Supplier/],
      ["source ownership", (s) => { s.source.brand_id = b; }, /does not belong/],
      ["source id ownership", (s) => { s.batch.source_id = a; }, /unavailable/],
      ["match ownership", (s) => { s.match.batch_id = b; }, /unavailable/],
      ["match key ownership", (s) => { s.match.data.key = "different"; }, /does not belong/],
      ["identity ownership", (s) => { s.identity.source_id = a; }, /unavailable/],
      ["forged snapshot price", (s) => { s.match.data.source!.price = 900; }, /does not match this source/],
      ["target Brand", (s) => { s.match.data.targets[0].brand_id = b; }, /does not belong/],
      ["current price equals source", (s) => { s.identity.data.price = 100; s.match.data.source!.price = 100; }, fresh],
    ];
    for (const classification of ["unchanged", "shared", "ambiguous", "baseline_drift", "needs_dimension_mapping", "unmatched", "referenced_companion", "invalid_source", "target_not_represented"] as const) cases.push([classification, (s) => { s.match.data.classification = classification; }, /Only changed|multiple-target/]);
    for (const field of ["key", "template_id", "pricing_version", "price", "raw_code", "code", "architecture", "group_id", "row_id", "column_id", "physical_field", "price_field", "dimension"] as const) cases.push([`stale ${field}`, (s) => { Object.assign(s.match.data.targets[0], { [field]: field === "price" ? 99 : "changed" }); }, fresh]);
    for (const [name, change, message] of cases) {
      Object.assign(f.state, structuredClone(original)); await f.db.exec("update brands set stored_price_basis='list'"); await change(f.state);
      await assert.rejects(f.apply(), message, name); assert.equal(f.calls.length, 0, name);
    }
    await f.db.exec("update brands set stored_price_basis='list'");
    assert.deepEqual(await f.untouched(), before); assert.equal(await f.version(), 0);
    assert.equal((await f.db.query("select * from product_template_price_history")).rows.length, 0);
  } finally { await f.db.close(); }
});

test("simple Apply writes one history, keeps metadata and historical snapshots, and rejects repeat", async () => {
  const f = await fixture();
  try {
    const before = await f.untouched(), snapshots = structuredClone(f.state);
    const result = await f.apply(); assert.equal(result.pricing_version, 1); assert.match(result.message, /Price applied\. Build a fresh comparison/);
    assert.equal(await f.version(), 1); assert.equal(f.calls[0].args.p_mode, "supplier_default");
    assert.deepEqual((await f.db.query("select default_unit_price::int,currency from product_templates")).rows[0], { default_unit_price: 110, currency: "EUR" });
    assert.deepEqual((await f.db.query("select old_default_unit_price::int,new_default_unit_price::int,currency,effective_from::text,note,changed_by,brand_price_list_update_id from product_template_price_history")).rows[0], { old_default_unit_price: 100, new_default_unit_price: 110, currency: "EUR", effective_from: "2026-10-03", note: `Supplier source: Supplier list; batch: ${c}; match: match-key`, changed_by: a, brand_price_list_update_id: c });
    assert.deepEqual(await f.untouched(), before); assert.deepEqual(f.state, snapshots);
    await assert.rejects(f.apply(), fresh); assert.equal(f.calls.length, 1);
    assert.equal((await f.db.query("select * from product_template_price_history")).rows.length, 1);
  } finally { await f.db.close(); }
});

test("live price/version drift and a concurrent writer all require a fresh comparison", async () => {
  const f = await fixture();
  try {
    await f.db.exec("update product_templates set default_unit_price=101"); await assert.rejects(f.apply(), fresh); assert.equal(f.calls.length, 0);
    await f.compare();
    f.beforeRpc(async () => { await f.db.exec("update product_templates set currency='USD'"); });
    await assert.rejects(f.apply(), fresh); assert.equal(f.calls.length, 1);
    assert.equal((await f.db.query("select * from product_template_price_history")).rows.length, 0);
  } finally { await f.db.close(); }
});

test("history failure rolls back Supplier price and pricing_version", async () => {
  const f = await fixture();
  try {
    const before = await f.untouched(); await f.db.exec("alter table product_template_price_history add constraint deny_history check(false)");
    await assert.rejects(f.apply(), /check constraint/); assert.equal(await f.version(), 0);
    assert.equal((await f.db.query<{ price: number }>("select default_unit_price::int price from product_templates")).rows[0].price, 100);
    assert.deepEqual(await f.untouched(), before);
  } finally { await f.db.close(); }
});

test("JSON, matrix, desking and accessory Apply preserve every unrelated value and use detail history", async () => {
  const f = await fixture();
  try {
    const before = await f.untouched();
    const examples = [
      { architecture: "variant_pricing", code: "VAR", roots: [{ id: "group", note: "keep", items: [{ id: "sibling", supplier_price_list_code: "OTHER", price: 7 }, { id: "row", supplier_price_list_code: "VAR", variant_name: "Variant", price: 100, currency: "EUR", metadata: { keep: true } }] }], field: "price", column: "" },
      { architecture: "category_pricing", code: "MAT", roots: [{ id: "group", price_columns: [{ id: "frozen", label: "Changed label", dimension_code: "cat_a" }, { id: "sibling", label: "B", dimension_code: "cat_b" }], items: [{ id: "row", supplier_price_list_code: "MAT", prices: { frozen: 100, sibling: 75 } }, { id: "other", supplier_price_list_code: "OTHER", prices: { frozen: 9, sibling: 8 } }] }], field: "prices", column: "frozen" },
      { architecture: "category_pricing", code: "DIRECT", roots: [{ id: "group", pricing_type: "modular_group", modular_pricing_mode: "direct", items: [{ id: "row", supplier_price_list_code: "DIRECT", price: 100 }] }], field: "price", column: "" },
      { architecture: "desking_size_pricing", code: "ADD", roots: [{ id: "group", items: [{ id: "row", base_supplier_price_list_code: "BASE", additional_supplier_price_list_code: "ADD", default_price: 50, additional_price: 100, qty: 4 }] }], field: "additional_price", column: "" },
      { architecture: "desking_size_pricing", code: "BASE", roots: [{ id: "group", items: [{ id: "row", base_supplier_price_list_code: "BASE", additional_supplier_price_list_code: "ADD", default_price: 100, additional_price: 50 }] }], field: "default_price", column: "" },
      { architecture: "accessory_pricing", code: "ACC", roots: [{ id: "group", price_categories: [{ id: "frozen", dimension_code: "cat_a" }, { id: "sibling", dimension_code: "cat_b" }], items: [{ id: "row", supplier_price_list_code: "ACC", prices: { frozen: 100, sibling: 75 }, is_active: true }] }], field: "prices", column: "frozen" },
      { architecture: "accessory_pricing", code: "ACC", roots: [{ id: "group", items: [{ id: "row", supplier_price_list_code: "ACC", price: 100, metadata: "keep" }] }], field: "price", column: "" },
      { architecture: "variant_pricing", code: "FLAT", roots: [{ id: "row", supplier_price_list_code: "FLAT", price: 100 }, { id: "other", supplier_price_list_code: "OTHER", price: 7 }], field: "price", column: "" },
    ];
    for (const example of examples) {
      const { architecture, code, roots, field, column } = example;
      await f.db.exec("update product_templates set variant_pricing='[]',category_pricing='[]',desking_size_pricing='[]',accessory_pricing='[]'");
      await f.db.query(`update product_templates set ${architecture}=$1`, [JSON.stringify(roots)]);
      await f.compare(code); const version = await f.version(); const snapshots = structuredClone(f.state);
      await f.apply(); assert.equal(await f.version(), version + 1, code);
      const expected = structuredClone(roots) as Array<Record<string, unknown>>;
      const row = (Array.isArray(expected[0].items) ? expected[0].items as Array<Record<string, unknown>> : expected).find((item) => item.id === "row")!;
      if (column) (row.prices as Record<string, unknown>)[column] = 110; else row[field] = 110;
      const after = (await f.db.query<Record<string, unknown>>(`select ${architecture} from product_templates`)).rows[0][architecture];
      assert.deepEqual(after, expected, code); assert.deepEqual(f.state, snapshots);
      const call = f.calls.at(-1)!; assert.equal(call.args.p_mode, "detail");
      const history = call.args.p_history as Record<string, unknown>;
      assert.equal(history.source_table, `product_templates.${architecture}`); assert.equal(history.source_record_id, "row"); assert.equal(history.price_field, column ? `prices.${column}` : field);
      await assert.rejects(f.apply(), fresh);
    }
    assert.equal((await f.db.query("select * from product_template_detail_price_history")).rows.length, examples.length);
    assert.deepEqual(await f.untouched(), before);
  } finally { await f.db.close(); }
});

test("component Apply changes only price and advances its parent once with detail history", async () => {
  const f = await fixture();
  try {
    await f.db.query("insert into product_components values($1,$2,'other','Options','COMP','Component','Keep',2,'Pc',100,'EUR',true,false,4,true,'Keep note','{}',$2)", [b, a]);
    await f.compare("COMP"); const version = await f.version(), before = await f.untouched();
    const component = (await f.db.query<Record<string, unknown>>("select * from product_components")).rows[0];
    await f.apply(); assert.equal(await f.version(), version + 1);
    assert.deepEqual((await f.db.query("select * from product_components")).rows[0], { ...component, unit_price: "110" });
    const history = (await f.db.query("select old_price::int,new_price::int,source_table,source_record_id,price_field,currency from product_template_detail_price_history")).rows[0];
    assert.deepEqual(history, { old_price: 100, new_price: 110, source_table: "product_components", source_record_id: b, price_field: "unit_price", currency: "EUR" });
    assert.deepEqual(await f.untouched(), before); await assert.rejects(f.apply(), fresh);
  } finally { await f.db.close(); }
});

test("server action rejects non-approvers and exposes only batchId plus matchKey", async () => {
  let role = "designer", calls = 0;
  const { applySupplierReviewedPrice } = await loadTestModule<typeof import("../../app/products/price-updates/supplier-sources/actions.js")>("../../app/products/price-updates/supplier-sources/actions.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { async requireBrandPriceReviewer() { return { profile: { role, account_status: "active" } }; } },
    "@/lib/supabase/server": { async createClient() { return {}; } },
    "@/lib/products/supplier-price-repository": {
    async supplierApplyReviewedPrice(_client: unknown, batchId: string, matchKey: string) { calls++; assert.equal(batchId, c); assert.equal(matchKey, "match-key"); return { message: "Applied" }; },
    supplierBrandMatches() {}, supplierBrandTargets() {}, supplierMatchChunks() {}, supplierSource() {}, supplierWrite() {},
    },
  });
    await assert.rejects(applySupplierReviewedPrice(c, "match-key"), /approver permission required/); assert.equal(calls, 0);
    role = "procurement_manager";
    await (applySupplierReviewedPrice as (...args: unknown[]) => Promise<unknown>)(c, "match-key", { price: 9999, target: "forged", pricing_version: 999, currency: "USD" });
    assert.equal(calls, 1); // Extra browser values never reach the writer.
    const code = await readFile(new URL("../../app/products/price-updates/supplier-sources/actions.ts", import.meta.url), "utf8");
    assert.match(code, /export async function applySupplierReviewedPrice\(batchId: string, matchKey: string\)/);
});

test("review UI shows explicit basis blocks and reserves Apply for one reviewed changed target", async () => {
  const f = await fixture();
  try {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { SupplierReviewControls } = await loadTestModule<typeof import("../../components/products/supplier-price-workspace-controls.js")>("../../components/products/supplier-price-workspace-controls.tsx", {
      "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } },
      "@/lib/supabase/client": { createClient() { assert.fail("Rendering review controls must not create a database client."); } },
      "@/app/products/price-updates/supplier-sources/actions": {},
    });
    const match: PriceMatch = { ...f.state.match.data, decision: "reviewed" };
    const props = { batchId: c, brandId: a, matches: [match], approver: true, sourceProfile: f.state.source.profile, sourceBasis: "list", brandBasis: "list", sourceStatus: "imported", batchStatus: "review" };
    const render = (changes: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(SupplierReviewControls, { ...props, ...changes }));
    const unknown = render({ sourceBasis: "unknown" });
    assert.match(unknown, /Apply blocked: source price basis is unknown\./);
    assert.match(unknown, /<button[^>]*disabled=""[^>]*>Apply price<\/button>/);
    assert.match(render({ brandBasis: "unknown" }), /Brand stored price basis is unknown/);
    assert.match(render({ brandBasis: "net" }), /does not match the Brand stored price basis/);
    assert.match(render(), /<button type="button" class="[^"]*">Apply price<\/button>/);
    assert.doesNotMatch(render({ approver: false }), />Apply price</);
    assert.doesNotMatch(render({ matches: [{ ...match, decision: undefined }] }), />Apply price</);
    assert.doesNotMatch(render({ matches: [{ ...match, targets: [...match.targets, match.targets[0]] }] }), />Apply price</);
    for (const classification of ["unchanged", "shared", "ambiguous", "baseline_drift", "needs_dimension_mapping", "unmatched", "referenced_companion", "invalid_source", "target_not_represented"] as const) assert.doesNotMatch(render({ matches: [{ ...match, classification }] }), />Apply price</, classification);
  } finally { await f.db.close(); }
});
