import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { buildEffectiveDocumentGroups } from "../quotations/document-grouping";
import { loadProjectScope, pickColumns } from "./project-scope";

// ---- A small fake database: tables are arrays; the query builder filters, orders, ranges, counts and projects columns like PostgREST. ----
type Row = Record<string, unknown>;
type Db = { tables: Record<string, Row[]>; failures: Set<string>; countOffset: Record<string, number>; reads: string[] };
function fakeClient(db: Db) {
  return {
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed" }, error: null }) }) },
    from(table: string) {
      db.reads.push(table);
      let columns = "*"; let withCount = false; let range: [number, number] | null = null;
      const filters: Array<[string, unknown]> = []; const orders: Array<[string, boolean]> = [];
      const run = () => {
        if (db.failures.has(table)) return { data: null, error: { message: `${table} failed` }, count: null };
        let rows = (db.tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
        for (const [key, ascending] of [...orders].reverse()) rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]), "en", { numeric: true }) * (ascending ? 1 : -1));
        const count = rows.length + (db.countOffset[table] ?? 0);
        if (range) rows = rows.slice(range[0], range[1] + 1);
        const cols = columns.split(",").map((column) => column.trim());
        const data = columns === "*" ? rows : rows.map((row) => Object.fromEntries(cols.map((column) => [column, row[column] ?? null])));
        return { data, error: null, count: withCount ? count : null };
      };
      const query: Record<string, unknown> = {
        select(cols: string, options?: { count?: string }) { columns = cols; withCount = options?.count === "exact"; return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        order(key: string, options?: { ascending?: boolean }) { orders.push([key, options?.ascending !== false]); return query; },
        range(from: number, to: number) { range = [from, to]; return query; },
        returns() { return query; },
        async maybeSingle() { const result = run(); return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : null }; },
        then(resolve: (value: unknown) => void) { resolve(run()); },
      };
      return query;
    },
  };
}
const newDb = (tables: Record<string, Row[]>): Db => ({ tables, failures: new Set(), countOffset: {}, reads: [] });

// ---- The same rows, live and as the frozen copy (project_snapshot_* rows hold to_jsonb of the original row, as the migration does) ----
const Q = "10000000-0000-4000-8000-000000000001";
const quotation: Row = {
  id: Q, client_id: "client-1", project_id: null, quotation_no: "QN-0002-001", revision_no: 5, option_no: 1, title: "Office", quotation_date: "2026-11-01", currency: "AED",
  subtotal: 1554, discount_total: 155, vat_percent: 5, vat_amount: 69.95, grand_total: 1468.95, payment_terms: "50% advance", validity: "30 days", delivery_terms: "8 weeks",
  warranty_terms: "2 years", notes: "Notes", legacy_reference: null, layout_settings: { pricing_rule: "whole_aed_v1", projectFile: { orderNo: "CO-0002-001" } },
  overall_discount_type: "amount", overall_discount_value: 0, status: "client_confirmed", internal_only: "kept in data only",
};
const section = (n: number, over: Row = {}): Row => ({ id: `20000000-0000-4000-8000-00000000000${n}`, quotation_id: Q, section_title: `Section ${n}`, section_notes: null, parent_section_id: null, section_kind: "main", sort_order: n * 10, is_active: true, created_at: "x", ...over });
const item = (n: number, over: Row = {}): Row => ({
  id: `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`, quotation_id: Q, section_id: section(1).id, item_type: "product", source_component_data: { a: n }, manual_serial: null,
  item_code_snapshot: `C${n}`, item_name_snapshot: `Item ${n}`, brand_name_snapshot: n % 2 ? "Brand A" : "Brand B", category_name_snapshot: null, specified_image_url_snapshot: "https://img/" + n,
  proposed_image_url_snapshot: null, specification_snapshot: "spec", finish_selections_snapshot: [], selected_options_snapshot: null, room_name_snapshot: null, model_snapshot: null, finish_snapshot: "Oak",
  size_snapshot: "100x50", origin_snapshot: null, supplier_name_snapshot: n % 3 === 0 ? "Supplier X" : null, qty: n, unit_label: "Pc", unit_price: 1554, net_price: 1399, net_total: 1399 * n,
  currency: "AED", sort_order: n * 10, is_optional: false, include_in_total: true, is_rate_only: false, line_style: "normal", is_active: true, notes: null, internal_cost: 700, cell_layout: {}, ...over,
});
const liveRows = { items: [item(1), item(2), item(3), item(4, { item_type: "note" }), item(5, { is_active: false })], sections: [section(1), section(2), section(3, { is_active: false })] };

function tables(withSnapshot: boolean, rows = liveRows): Record<string, Row[]> {
  const activeItems = rows.items.filter((row) => row.is_active);
  const activeSections = rows.sections.filter((row) => row.is_active);
  return {
    quotations: [quotation],
    clients: [{ id: "client-1", client_number: "0002", company_name: "Client Co" }],
    projects: [],
    quotation_sections: rows.sections,
    quotation_items: rows.items,
    project_snapshots: withSnapshot ? [{ id: "snap-1", quotation_id: Q, contract_total: 1470, pricing_rule: "whole_aed_v1", quotation_data: quotation }] : [],
    project_snapshot_sections: withSnapshot ? activeSections.map((row) => ({ snapshot_id: "snap-1", original_section_id: row.id, sort_order: row.sort_order, section_title: row.section_title, data: row })) : [],
    project_snapshot_items: withSnapshot ? activeItems.map((row) => ({ snapshot_id: "snap-1", original_item_id: row.id, sort_order: row.sort_order, data: row })) : [],
  };
}

const PROJECT_ITEM_COLUMNS = "id,item_name_snapshot,item_code_snapshot,brand_name_snapshot,size_snapshot,finish_snapshot,supplier_name_snapshot,qty,unit_label,unit_price,net_price,net_total,currency,sort_order,is_optional,is_active,line_style";
const PROCUREMENT_ITEM_COLUMNS = "id,item_name_snapshot,item_code_snapshot,brand_name_snapshot,supplier_name_snapshot,size_snapshot,finish_snapshot,qty,unit_price,net_total,currency,sort_order,is_active";
const HEADER_COLUMNS = "subtotal,vat_percent,vat_amount,grand_total,payment_terms";

/** What the Project page and the procurement page compute from their rows. */
function pageNumbers(items: Array<Record<string, unknown>>) {
  const groups = buildEffectiveDocumentGroups(items as never[]);
  return groups.map((group) => ({ key: group.keys, label: group.displayLabel, ids: group.items.map((entry) => (entry as { id: string }).id), total: group.items.reduce((sum, entry) => sum + Number((entry as { net_total?: number }).net_total ?? 0), 0) }));
}

// ---- Proof: identical from live rows and from the copy ----

test("the Project page and the procurement pages get identical lines, vendor groups, totals and header from the copy and from live rows", async () => {
  for (const columns of [PROJECT_ITEM_COLUMNS, PROCUREMENT_ITEM_COLUMNS]) {
    const live = await loadProjectScope(fakeClient(newDb(tables(false))), Q, { itemColumns: columns, headerColumns: HEADER_COLUMNS });
    const frozen = await loadProjectScope(fakeClient(newDb(tables(true))), Q, { itemColumns: columns, headerColumns: HEADER_COLUMNS });
    assert.equal(live.source, "live"); assert.equal(frozen.source, "snapshot");
    assert.deepEqual(frozen.items, live.items);
    assert.deepEqual(frozen.header, live.header);
    assert.deepEqual(pageNumbers(frozen.items), pageNumbers(live.items));
    assert.equal(live.items.length, 4); // inactive rows are in neither
  }
  const frozen = await loadProjectScope(fakeClient(newDb(tables(true))), Q, { itemColumns: PROJECT_ITEM_COLUMNS, headerColumns: HEADER_COLUMNS });
  assert.deepEqual(frozen.header, { subtotal: 1554, vat_percent: 5, vat_amount: 69.95, grand_total: 1468.95, payment_terms: "50% advance" });
  assert.equal(frozen.contractTotal, 1470);
  assert.equal(frozen.pricingRule, "whole_aed_v1");
});

const state = { db: newDb({}) };
mock.module("server-only", { namedExports: {} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => fakeClient(state.db) } });
mock.module("@/lib/company-profile", { namedExports: { getCompanyProfile: async () => ({ displayName: "Co" }) } });

test("the document loader gives an identical result from the copy and from live rows, for every Project document", async () => {
  const { loadQuotationDerivedDocumentData } = await import("../quotations/derived-document-data");

  state.db = newDb(tables(false));
  const live = await loadQuotationDerivedDocumentData(Q, { projectScope: true });
  state.db = newDb(tables(true));
  const frozen = await loadQuotationDerivedDocumentData(Q, { projectScope: true });
  assert.ok(live && frozen);
  assert.deepEqual(frozen, live);
  assert.equal(frozen.items.length, 3); // the note row is not a document line
  assert.deepEqual(frozen.sections.map((entry) => entry.id), live.sections.map((entry) => entry.id));
  assert.deepEqual(pageNumbers(frozen.items as never[]), pageNumbers(live.items as never[]));

  // A later quotation edit changes the quotation's own documents, not the Project's.
  const edited = tables(true);
  edited.quotation_items = liveRows.items.map((row) => row.qty === 2 ? { ...row, qty: 99, net_total: 99 } : row);
  state.db = newDb(edited);
  const projectDoc = await loadQuotationDerivedDocumentData(Q, { projectScope: true });
  const quotationDoc = await loadQuotationDerivedDocumentData(Q);
  assert.equal(projectDoc?.items.find((entry) => entry.item_code_snapshot === "C2")?.qty, 2);
  assert.equal(quotationDoc?.items.find((entry) => entry.item_code_snapshot === "C2")?.qty, 99);
});

test("the document loader still returns null for a missing quotation", async () => {
  state.db = newDb({ ...tables(false), quotations: [] });
  const { loadQuotationDerivedDocumentData } = await import("../quotations/derived-document-data");
  assert.equal(await loadQuotationDerivedDocumentData(Q, { projectScope: true }), null);
});

// ---- Ids ----

test("ids stay the original ids, for items, sections and parents", async () => {
  const rows = { sections: [section(1), section(2, { parent_section_id: section(1).id })], items: [item(1, { parent_item_id: item(2).id }), item(2)] };
  const db = newDb(tables(true, rows));
  // Even a saved row whose own id is wrong or missing is keyed by the original id.
  db.tables.project_snapshot_items[0] = { ...db.tables.project_snapshot_items[0], data: { ...(db.tables.project_snapshot_items[0].data as Row), id: "wrong" } };
  const scope = await loadProjectScope(fakeClient(db), Q, { itemColumns: "id,section_id,parent_item_id,qty", sectionColumns: "id,parent_section_id,section_title" });
  assert.deepEqual(scope.items.map((entry) => entry.id), [item(1).id, item(2).id]);
  assert.equal((scope.items[0] as Row).parent_item_id, item(2).id);
  assert.equal((scope.items[0] as Row).section_id, section(1).id);
  assert.deepEqual(scope.sections.map((entry) => entry.id), [section(1).id, section(2).id]);
  assert.equal((scope.sections[1] as Row).parent_section_id, section(1).id);
});

test("pickColumns returns only the asked columns, null for a missing one", () => {
  assert.deepEqual(pickColumns({ a: 1, b: 2 }, "a,c"), { a: 1, c: null });
  assert.deepEqual(pickColumns(null, "a", { id: "x" }), { a: null, id: "x" });
});

// ---- Fallback: never a half Project ----

test("no copy: live rows, and the reason says so", async () => {
  const scope = await loadProjectScope(fakeClient(newDb(tables(false))), Q, { itemColumns: PROJECT_ITEM_COLUMNS, headerColumns: HEADER_COLUMNS });
  assert.equal(scope.source, "live"); assert.equal(scope.fallback, "no_snapshot"); assert.equal(scope.snapshotId, null); assert.equal(scope.contractTotal, null);
  assert.equal(scope.items.length, 4);
});

test("a copy that fails to read or reads partially falls back to live rows", async (t) => {
  t.mock.method(console, "error", () => {});
  const options = { itemColumns: PROJECT_ITEM_COLUMNS, sectionColumns: "id,section_title", headerColumns: HEADER_COLUMNS };
  const live = await loadProjectScope(fakeClient(newDb(tables(false))), Q, options);

  for (const table of ["project_snapshots", "project_snapshot_items", "project_snapshot_sections"]) {
    const db = newDb(tables(true)); db.failures.add(table);
    const scope = await loadProjectScope(fakeClient(db), Q, options);
    assert.equal(scope.source, "live", table); assert.equal(scope.fallback, "unreadable", table);
    assert.deepEqual(scope.items, live.items, table);
  }
  for (const table of ["project_snapshot_items", "project_snapshot_sections"]) {
    const db = newDb(tables(true)); db.countOffset[table] = 1; // the database says one more row than was returned
    const scope = await loadProjectScope(fakeClient(db), Q, options);
    assert.equal(scope.source, "live", table); assert.equal(scope.fallback, "unreadable", table);
  }
  const db = newDb(tables(true)); db.tables.project_snapshots[0].contract_total = null;
  assert.equal((await loadProjectScope(fakeClient(db), Q, options)).source, "live");
  const thrown = await loadProjectScope({ from(table: string) { if (table.startsWith("project_")) throw new Error("boom"); return fakeClient(newDb(tables(false))).from(table); } }, Q, options);
  assert.equal(thrown.source, "live"); assert.equal(thrown.fallback, "unreadable"); assert.deepEqual(thrown.items, live.items);
});

test("a Project with more rows than one read returns loses none", async () => {
  const many = { sections: [section(1)], items: Array.from({ length: 2350 }, (_, i) => item(i + 1, { sort_order: i, net_total: 1 })) };
  const scope = await loadProjectScope(fakeClient(newDb(tables(true, many))), Q, { itemColumns: "id,sort_order" });
  assert.equal(scope.source, "snapshot");
  assert.equal(scope.items.length, 2350);
  assert.equal(new Set(scope.items.map((entry) => entry.id)).size, 2350);
  assert.deepEqual(scope.items.slice(0, 3).map((entry) => (entry as Row).sort_order), [0, 1, 2]);
});

// ---- Source text: the readers no longer read quotation_items to show a Project that has a copy ----

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("the Project page and both procurement pages read their lines only through the scope module", () => {
  for (const path of ["app/projects/orders/[orderNo]/page.tsx", "app/procurement/orders/[orderNo]/page.tsx", "app/procurement/completed/[orderNo]/page.tsx"]) {
    const source = read(path);
    assert.ok(!source.includes('.from("quotation_items")'), path);
    assert.ok(source.includes("loadProjectScope"), path);
  }
  const project = read("app/projects/orders/[orderNo]/page.tsx");
  assert.ok(!/entry\.quotationRow\.(subtotal|vat_percent|vat_amount|grand_total|payment_terms)/.test(project), "totals come from the copy");
  assert.ok(project.includes("contractTotal={String(entry.order.total)}"), "the contract total stays the frozen Project File total");
  assert.ok(project.includes('scope.source === "live" && scope.fallback === "no_snapshot"'));
  assert.ok(project.includes("Older Project: no frozen copy yet"));
});

test("the document loader reads the live tables only when it is not given the Project scope", () => {
  const loader = read("lib/quotations/derived-document-data.ts");
  assert.equal(loader.split('.from("quotation_items")').length - 1, 1);
  assert.equal(loader.split('.from("quotation_sections")').length - 1, 1);
  assert.ok(loader.indexOf("? Promise.resolve({ data: scope.items })") < loader.indexOf('.from("quotation_items")'));
  assert.ok(loader.includes("options.projectScope"));
});

test("the Project documents ask for the Project scope; the quotation's own export does not", () => {
  for (const path of [
    "app/quotations/[id]/purchase-order/page.tsx", "app/quotations/[id]/procurement-rfq/page.tsx", "app/quotations/[id]/order-confirmation/page.tsx", "app/quotations/[id]/delivery-note/page.tsx",
    "app/quotations/[id]/download-purchase-order/route.ts", "app/quotations/[id]/download-procurement-rfq/route.ts", "app/quotations/[id]/download-delivery-note/route.ts",
  ]) {
    const source = read(path);
    assert.ok(source.includes("loadQuotationDerivedDocumentData(id, { projectScope: true })"), path);
    assert.ok(!source.includes("loadQuotationDerivedDocumentData(id)"), path);
  }
  assert.ok(read("app/api/export-quotation/route.ts").includes("loadQuotationDerivedDocumentData(quotationId)"));
});

// ---- Step C2a: the current scope ----

function withVariation(base: Record<string, Row[]>): Record<string, Row[]> {
  const rows = [item(1, { qty: 7, net_total: 700 }), item(9, { id: "new-row" })];
  return {
    ...base,
    project_variations: [{ id: "var-1", snapshot_id: "snap-1", variation_no: 1, variation_quotation_id: "v-q", variation_quotation_no: "QN-0002-001-V1", base_revision_no: 5, previous_contract_total: 1470, new_contract_total: 2000, contract_delta: 530, currency: "AED", pricing_rule: "whole_aed_v1", change_summary: { added: [], removed: [], changed: [], unchanged_count: 0 }, applied_by_name: "Sara", applied_at: "2026-11-05", layout_settings: { variationOf: {} }, quotation_data: { ...quotation, id: "v-q", title: "Office - Variation 1", grand_total: 2000, quotation_no: "QN-0002-001-V1" } }],
    project_variation_sections: [{ variation_id: "var-1", variation_section_id: "v-section", sort_order: 10, data: section(1, { id: "v-section" }) }],
    project_variation_items: rows.map((row, index) => ({ variation_id: "var-1", variation_item_id: index ? "new-row" : "v-row-1", original_item_id: index ? null : item(1).id, sort_order: Number(row.sort_order), data: { ...row, id: index ? "new-row" : "v-row-1", section_id: "v-section", parent_item_id: index ? "v-row-1" : null } })),
  };
}
const scopeOptions = { itemColumns: "id,section_id,parent_item_id,qty,net_total", sectionColumns: "id,section_title", headerColumns: "id,title,grand_total,quotation_no,layout_settings" };

test("one applied variation is the current scope: lines keep their previous ids, a new line uses its own, and the header stays the Project's", async () => {
  const scope = await loadProjectScope(fakeClient(newDb(withVariation(tables(true)))), Q, scopeOptions);
  assert.equal(scope.source, "snapshot"); assert.equal(scope.appliedVariationNo, 1);
  assert.equal(scope.contractTotal, 2000); assert.equal(scope.originalContractTotal, 1470); assert.equal(scope.pricingRule, "whole_aed_v1");
  assert.deepEqual(scope.items.map((row) => row.id), [item(1).id, "new-row"]);
  assert.equal((scope.items[0] as Row).qty, 7);
  assert.equal((scope.items[1] as Row).parent_item_id, item(1).id, "a parent reference follows the line id");
  assert.equal((scope.items[0] as Row).section_id, "v-section"); assert.deepEqual(scope.sections.map((row) => row.id), ["v-section"]);
  assert.equal(scope.header?.id, Q); assert.equal(scope.header?.title, "Office"); assert.equal(scope.header?.grand_total, 2000); assert.equal(scope.header?.quotation_no, "QN-0002-001-V1");
  assert.deepEqual((scope.header?.layout_settings as Row).projectFile, { orderNo: "CO-0002-001" });
  assert.equal(scope.originalHeader?.grand_total, 1468.95);
});

test("the latest of two applied variations is the current scope, and both are listed in order", async () => {
  const base = withVariation(tables(true));
  const second = { ...base.project_variations[0], id: "var-2", variation_no: 2, new_contract_total: 2500, quotation_data: { ...quotation, grand_total: 2500 } };
  base.project_variations = [second, base.project_variations[0]];
  base.project_variation_items = [...base.project_variation_items, { variation_id: "var-2", variation_item_id: "v2-row", original_item_id: item(1).id, sort_order: 1, data: item(1, { id: "v2-row", qty: 9 }) }];
  const scope = await loadProjectScope(fakeClient(newDb(base)), Q, { itemColumns: "id,qty" });
  assert.equal(scope.appliedVariationNo, 2); assert.equal(scope.contractTotal, 2500);
  assert.deepEqual(scope.appliedVariations.map((row) => row.variationNo), [1, 2]);
  assert.deepEqual(scope.items, [{ id: item(1).id, qty: 9 }]);
});

test("a variation that cannot be read falls back to the original copy, not a half scope; no copy still means live", async (t) => {
  t.mock.method(console, "error", () => {});
  const original = await loadProjectScope(fakeClient(newDb(tables(true))), Q, scopeOptions);
  for (const breakIt of [
    (db: Db) => db.failures.add("project_variations"),
    (db: Db) => db.failures.add("project_variation_items"),
    (db: Db) => db.failures.add("project_variation_sections"),
    (db: Db) => { db.countOffset.project_variation_items = 1; },
  ]) {
    const db = newDb(withVariation(tables(true))); breakIt(db);
    const scope = await loadProjectScope(fakeClient(db), Q, scopeOptions);
    assert.deepEqual(scope, original);
  }
  assert.equal((await loadProjectScope(fakeClient(newDb(tables(false))), Q, scopeOptions)).source, "live");
});

test("before the migration is applied the missing table is silent, and the original copy is unchanged", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const real = fakeClient(newDb(tables(true)));
  const client = { from(table: string) { if (table !== "project_variations") return real.from(table); const query: Record<string, unknown> = { select: () => query, eq: () => query, order: () => query, then(resolve: (value: unknown) => void) { resolve({ data: null, error: { code: "PGRST205", message: "no table" } }); } }; return query; } };
  const scope = await loadProjectScope(client, Q, scopeOptions);
  assert.equal(scope.source, "snapshot"); assert.equal(scope.appliedVariationNo, null); assert.deepEqual(scope.appliedVariations, []);
  assert.equal(logged.mock.callCount(), 0);
});
