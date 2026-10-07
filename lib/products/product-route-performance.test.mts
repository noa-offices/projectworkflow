import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapSupplierReads, readProductPages, supplierFamilyCoverageSetup, supplierFamilyReviewFacts, supplierRows } from "./supplier-price-repository";
import { loadSupplierFamilyPriceStatusMap } from "./supplier-family-price-status-loader";
import { loadSupplierPriceUpdatesInputs } from "./supplier-price-updates-view";

const read = (path: string) => readFileSync(path, "utf8");
const management = read("app/products/templates/page.tsx");
const builder = read("app/quotations/[id]/local-builder/page.tsx");
const updates = read("app/products/price-updates/page.tsx");
const sources = read("app/products/price-updates/supplier-sources/page.tsx");
const loader = read("lib/products/supplier-family-price-status-loader.ts");

function parallelGroups(source: string) {
  const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const groups: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "Promise.all") groups.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  return groups;
}

test("management, Price Updates and Local Builder await independent reads together", () => {
  const hasTables = (source: string, tables: string[]) => parallelGroups(source).some((group) => tables.every((table) => group.includes(`.from("${table}")`)));
  assert.ok(hasTables(management, ["product_templates", "product_components", "brand_materials", "product_categories"]));
  assert.ok(hasTables(updates, ["brands", "product_templates", "supplier_price_batches"]));
  assert.ok(hasTables(builder, ["clients", "quotation_sections", "quotation_items", "brands"]));
  assert.ok(hasTables(builder, ["product_templates", "product_components", "brand_materials", "brand_price_list_updates"]));
});

test("management defers detail history and audit, and preserves its navigation and audit bound", () => {
  assert.match(management, /openTemplateId \? readProductPages[\s\S]*?\.from\("product_components"\)[\s\S]*?\.eq\("template_id", openTemplateId\)/);
  assert.match(management, /openTemplateId \? readProductPages[\s\S]*?\.from\("product_template_price_history"\)[\s\S]*?\.eq\("product_template_id", openTemplateId\)/);
  assert.match(management, /openTemplateId \? readProductPages[\s\S]*?\.from\("product_template_detail_price_history"\)/);
  assert.match(management, /openTemplateId \? supabase[\s\S]*?\.from\("audit_activity_log"\)[\s\S]*?\.limit\(500\)/);
  assert.match(management, /\(selectedTemplate \? \[selectedTemplate\] : \[\]\)\.map/);
});

test("all newly paged route queries apply a range and deterministic ID tiebreaker", () => {
  for (const source of [management, builder, updates]) {
    const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(file) === "readProductPages") {
        assert.match(node.getText(file), /\.range\(from, to\)/);
        assert.match(node.getText(file), /\.order\("id"/);
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
});

test("selection fields, shared badges and quotation snapshot guards remain present", () => {
  for (const source of [management, builder]) {
    for (const field of ["variant_pricing", "category_pricing", "accessory_pricing", "desking_size_pricing", "material_suggestions", "image_settings", "proposed_image_url_20"]) assert.ok(source.includes(field), field);
    assert.match(source, /loadSupplierFamilyPriceStatusMap\(supabase,/);
    assert.match(source, /supplierFamilyStatusPresentation\(supplierStatus\)/);
  }
  assert.match(builder, /baselineStart\.workspace_version === baselineEnd\?\.workspace_version/);
  assert.match(sources, /supplierFamilyCoverageSetup\(client, brand\.id, referenceSource\?\.id, coverage\)/);
  assert.doesNotMatch(loader, /\.eq\("template_id"|families\.map\(async/);
});

test("complete product paging retains more than 1000 rows and fails closed on a later-page error", async () => {
  const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const ranges: number[][] = [];
  const result = await readProductPages(async (from, to) => { ranges.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; });
  assert.deepEqual(result.data, rows);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
  const failed = await readProductPages(async (from, to) => from ? { data: null, error: { message: "timeout" } } : { data: rows.slice(from, to + 1), error: null });
  assert.equal(failed.data, null);
  assert.equal(failed.error?.message, "timeout");
});

test("Supplier read workers start three independent jobs, bound fan-out, and preserve result order", async () => {
  let active = 0, maximum = 0;
  const releases: Array<() => void> = [];
  const work = mapSupplierReads([0, 1, 2, 3, 4], async (id) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--; return id;
  });
  assert.equal(active, 3);
  while (releases.length) { releases.shift()!(); await new Promise<void>((resolve) => setImmediate(resolve)); }
  assert.deepEqual(await work, [0, 1, 2, 3, 4]);
  assert.equal(maximum, 3);
});

type Row = Record<string, unknown>;
function fixture(tables: Record<string, Row[]>) {
  const reads: Array<{ table: string; filters: Array<[string, unknown]>; range: number[]; after?: string }> = [];
  const client = { from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let from = 0, to = 499;
    let after: string | undefined;
    const query = {
      select() { return query; }, order() { return query; }, returns() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      in(key: string, value: unknown[]) { filters.push([key, value]); return query; },
      range(start: number, end: number) { from = start; to = end; return query; },
      neq(key: string, value: unknown) { assert.equal(key, "template_ids"); assert.equal(value, "{}"); filters.push(["__targeted", true]); return query; },
      gt(key: string, value: string) { assert.equal(key, "key"); after = value; return query; },
      then(resolve: (result: { data: Row[]; error: null }) => unknown) {
        reads.push({ table, filters, range: [from, to], after });
        const data = (tables[table] ?? []).filter((row) => (after === undefined || String(row.key) > after) && filters.every(([key, value]) => key === "__targeted" ? Array.isArray(row.template_ids) && row.template_ids.length > 0 : Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(from, to + 1);
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, reads };
}

test("large match reads seek after the unique batch key without OFFSET or losing JSON targets", async () => {
  const matches = Array.from({ length: 1201 }, (_, index) => ({ batch_id: "b", key: String(index).padStart(5, "0"), data: { targets: [{ key: index }] } }));
  const f = fixture({ supplier_price_matches: matches });
  const rows = await supplierRows(f.client, "supplier_price_matches", "key,data", { batch_id: "b" }, "key");
  assert.deepEqual(rows, matches);
  assert.deepEqual(f.reads.map((read) => read.range), [[0, 499], [0, 499], [0, 499]]);
  assert.deepEqual(f.reads.map((read) => read.after), [undefined, "00499", "00999"]);
});

test("Price Updates batches metadata across Brands and preserves covered and legacy badges", async () => {
  const f = fixture({
    supplier_source_definitions: [{ id: "d1", brand_id: "b1", name: "Furniture", is_active: true }, { id: "d2", brand_id: "b2", name: "Chairs", is_active: true }],
    supplier_source_definition_families: [{ definition_id: "d1", template_id: "f1" }, { definition_id: "d2", template_id: "f2" }],
    supplier_source_versions: [],
  });
  const inputs = await loadSupplierPriceUpdatesInputs(f.client, ["b1", "b2"]);
  assert.equal(inputs.definitions.length, 2);
  assert.equal(f.reads.filter((read) => read.table === "supplier_source_definitions").length, 1);
  assert.equal(f.reads.filter((read) => read.table === "supplier_source_versions").length, 1);
  const statuses = await loadSupplierFamilyPriceStatusMap(f.client, [{ id: "f1", brand_id: "b1" }, { id: "f2", brand_id: "b2" }, { id: "legacy", brand_id: "b1" }]);
  assert.equal(statuses.get("f1")?.status, "no_price_list");
  assert.equal(statuses.get("f2")?.status, "no_price_list");
  assert.equal(statuses.get("legacy")?.status, "legacy_manual");
  assert.ok(f.reads.every((read) => read.filters.every(([key]) => key !== "template_id")));
});

test("coverage setup reuses the supplied overview without reading definition/version tables", async () => {
  const f = fixture({ product_templates: [{ id: "f", brand_id: "b", template_name: "Desk", is_active: true }] });
  const overview = { definitions: [{ id: "d", name: "Furniture", profileId: null, profileTitle: null, isActive: true, canDelete: true, families: [{ id: "f", name: "Desk" }], latest: null }], conflicts: [], uncovered: [] };
  const rows = await supplierFamilyCoverageSetup(f.client, "b", null, overview);
  assert.deepEqual(rows[0].currentSources, [{ definitionId: "d", definitionName: "Furniture" }]);
  assert.deepEqual(f.reads.map((read) => read.table).sort(), ["product_categories", "product_templates"]);
});

test("parallel batch facts retain completed, excluded and open target outcomes", async () => {
  const f = fixture({
    supplier_price_batches: [
      { id: "complete", brand_id: "b", source_id: "s", status: "completed", scope: "complete", coverage_template_ids: ["f"], completed_at: "2026-10-01" },
      { id: "open", brand_id: "b", source_id: "s2", status: "review", scope: "complete", coverage_template_ids: ["f"], completed_at: null },
    ],
    supplier_price_matches: [
      { batch_id: "complete", key: "a", template_ids: ["f"], data: { classification: "changed", targets: [{ template_id: "f", key: "a" }] } },
      { batch_id: "complete", key: "b", template_ids: ["f"], data: { classification: "target_not_represented", targets: [{ template_id: "f", key: "b" }] } },
      { batch_id: "open", key: "c", template_ids: ["f"], data: { classification: "changed", targets: [{ template_id: "f", key: "c" }] } },
      { batch_id: "open", key: "d", template_ids: [], data: { classification: "unmatched", targets: [] } },
    ],
    supplier_price_decisions: [{ batch_id: "complete", key: "b", decision: "excluded_from_source" }],
  });
  const facts = await supplierFamilyReviewFacts(f.client, "b");
  assert.equal(facts.length, 2);
  assert.equal(facts[0].partiallyChecked, true);
  assert.equal(facts[0].resolvedTargets, 1);
  assert.equal(facts[0].excludedTargets, 1);
  assert.equal(facts[1].unresolvedTargets, 1);
  // Untargeted matches are filtered server-side and never read.
  assert.ok(f.reads.filter((read) => read.table === "supplier_price_matches").every((read) => read.filters.some(([key]) => key === "__targeted")));
});
