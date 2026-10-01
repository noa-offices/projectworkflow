import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CachedReadSurface } from "../../components/local-read-cache/read-surface";
import { brandRows, managementRows, materialRows } from "./product-projections";
import { isProductEditor, limits, minimizedRows, readEntity, retentionMs, schemaVersion, type ReadEntity, type ReadSnapshot } from "./types";

const brand = { id: "b", name: "Brand", is_active: true };
const group = { id: "g", brand_id: "b", group_name: "Fabrics", sort_order: 1, is_active: true };
const material = { id: "m", brand_id: "b", material_group_id: "g", material_name: "Blue", material_code: "BL", sort_order: 1, is_active: true };
const row = { id: "1", title: "Cached title", code: "CODE", subtitle: "", status: "Active", href: "" };
const keys = ["products:management", "brands:list", "materials:library"] as const;

test("extension route mapping includes overview aliases but never Product Template details/editors/imports", () => {
  for (const path of ["/products/manage", "/products/management"]) assert.equal(readEntity(path), "products:management");
  assert.equal(readEntity("/products/templates", "?manage=1&q=chair"), "products:management");
  assert.equal(readEntity("/products/brands"), "brands:list");
  assert.equal(readEntity("/products/materials", "?brand=b&group=g"), "materials:library");
  for (const path of ["/products", "/products/templates", "/products/manage", "/products/management"]) {
    for (const param of ["template", "editTemplate", "addTemplate", "quoteImportMode", "quoteImportDraft"]) {
      assert.equal(readEntity(path, "?" + param + "=fixture"), null);
      assert.equal(isProductEditor(path, "?" + param + "=fixture"), true);
    }
  }
  assert.equal(readEntity("/products/brands", "?editBrand=b"), null);
  assert.equal(readEntity("/products/templates/fixture/edit"), null);
  assert.equal(readEntity("/products/manage", "?priceStatus=due"), null);
});
test("management list projection retains codes/lifecycle but never serializes editor inputs", () => {
  const t = { id: "t", template_name: "Chair", template_code: "TP", item_code: "IT", brand_id: "b", main_category_id: "c",
    is_active: false, lifecycle_status: "active", variant_pricing: "secret", category_pricing: "secret", modular_configuration: "secret",
    linked_options: "secret", components: "secret", materials: "secret", ai_extraction: "secret", supplier_cost: "secret", internal_cost: "secret", images: "secret" };
  const rows = managementRows([t], [brand], [{ id: "c", name: "Seating" }]);
  assert.equal(rows[0].status, "archived"); assert.equal(rows[0].code, "IT");
  assert.equal(rows[0].subtitle, "Template code: TP"); assert.equal(rows[0].category, "Seating");
  assert.ok(!JSON.stringify(rows).includes("secret"));
});
test("brand archive state and active-parent category counts match current list", () => {
  const rows = brandRows([{ ...brand, origin: "Italy", is_active: false }], [
    { id: "c", brand_id: "b", is_active: true, parent_id: null },
    { id: "s", brand_id: "b", is_active: true, parent_id: "c" },
    { id: "hidden", brand_id: "b", is_active: false, parent_id: null },
    { id: "orphan", brand_id: "b", is_active: true, parent_id: "hidden" },
  ]);
  assert.equal(rows[0].category, "1 categories · 1 subcategories");
  assert.equal(rows[0].subtitle, "Origin: Italy"); assert.equal(rows[0].archived, true);
});
test("material grouping preserves group order, numeric grades, direct/collection order and code tie-break", () => {
  const rows = materialRows([brand], [{ ...group, id: "later", sort_order: 2 }, group], [
    { ...material, id: "g10", material_category: "Grade 10" },
    { ...material, id: "g2b", material_category: "Grade 2", material_collection: "Wool", material_code: "B" },
    { ...material, id: "g2a", material_category: "Grade 2", material_collection: "Wool", material_code: "A" },
    { ...material, id: "direct", material_category: "Grade 2" },
    { ...material, id: "collection", material_collection: "Cotton" },
    { ...material, id: "uncat" },
    { ...material, id: "last", material_group_id: "later", sort_order: 0 },
  ]);
  assert.deepEqual(rows.map(r => r.id), ["direct", "g2a", "g2b", "g10", "collection", "uncat", "last"]);
  assert.equal(rows[0].group, "Fabrics"); assert.equal(rows[2].category, "Grade 2 / Wool");
});
test("empty material groups remain visible; inactive group contents are marked archived", () => {
  const empty = materialRows([brand], [group], []);
  assert.equal(empty[0].groupOnly, true); assert.equal(empty[0].groupId, "g");
  const inactive = materialRows([brand], [{ ...group, is_active: false }], [material]);
  assert.equal(inactive[0].archived, true);
});
for (const key of keys) {
  test(key + " renders useful cached metadata in the actual shared React surface", () => {
    const snapshot: ReadSnapshot = { userId: "A", key, entityType: key, data: [row], fetchedAt: Date.now(), expiresAt: Date.now() + retentionMs, schemaVersion };
    const html = renderToStaticMarkup(React.createElement(CachedReadSurface, { entity: key, snapshot, message: "Offline — saved data", refresh() {}, close() {} }));
    assert.match(html, /Cached title/); assert.match(html, /CODE/); assert.match(html, /Offline/);
    assert.ok(!html.includes("<form")); assert.ok(!html.includes("Edit Template</"));
  });
  test(key + " is bounded and whitelist rejects all heavy/editor fields at persistence boundary", () => {
    const dirty = { ...row, pricing: "secret", configuration: "secret", source_data: "secret", cost: "secret", gallery: "secret", editor: "secret" };
    const rows = minimizedRows(key, Array.from({ length: 1200 }, (_, i) => ({ ...dirty, id: String(i) })));
    assert.equal(rows.length, limits[key]); assert.ok(!JSON.stringify(rows).includes("secret"));
  });
}
test("signed swatches, storage paths and image byte payloads cannot become cached image credentials", () => {
  for (const thumbnail of ["https://storage.test/object/sign/private?token=secret", "data:image/png;base64,secret"]) {
    assert.equal(minimizedRows("materials:library", [{ ...row, thumbnail }])[0].thumbnail, undefined);
  }
});
test("editor interception is offline-only; authoritative GET and editor write behavior remain separate", () => {
  const runtime = readFileSync("components/local-read-cache/local-read-runtime.tsx", "utf8");
  assert.match(runtime, /!navigator.onLine && isProductEditor/);
  assert.match(runtime, /if \(navigator.onLine\) router.push/);
  const route = readFileSync("app/api/local-read-cache/[entity]/route.ts", "utf8");
  assert.match(route, /export async function GET/); assert.ok(!route.includes("POST"));
  const recovery = readFileSync("public/offline.js", "utf8");
  for (const key of keys) assert.ok(recovery.includes(key));
  assert.match(recovery, /editor is online-only and NOT CACHED/);
  assert.ok(!recovery.includes("saveWorkspaceDocument"));
});
test("extension fields do not change Product Library or quotation/client projection shape", () => {
  const extra = { ...row, group: "private extension field", brandId: "private extension field", groupOnly: true };
  for (const key of ["products", "quotations", "projects", "clients"] as ReadEntity[]) {
    assert.ok(!JSON.stringify(minimizedRows(key, [extra])).includes("private extension field"));
  }
});
