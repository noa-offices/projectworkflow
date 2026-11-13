/* eslint-disable @typescript-eslint/no-explicit-any -- Isolate server actions while rendering the real popup and picker. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as lines from "../../lib/products/supplier-price-lines";
import * as links from "../../lib/products/supplier-link-confirm";

function compile(path: string, dependencies: Record<string, any>, extra = "") {
  const output = ts.transpileModule(readFileSync(path, "utf8") + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = { exports: {} as any };
  new Function("require", "module", "exports", "document", output)((name: string) => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, compiled, compiled.exports, { body: {} });
  return compiled.exports;
}
const common = { react: React, "react/jsx-runtime": jsx, "react-dom": { createPortal: (element: unknown) => element }, "@/app/products/price-updates/supplier-sources/actions": {}, "@/lib/products/supplier-price-lines": lines };
test("linked tier names and conflict explanation render beside an unclear line without an apply button", () => {
  const { SourceLines } = compile("components/quotations/supplier-price-lines-popup.tsx", {
    ...common, "./supplier-price-link-panel": { ConfirmAllSuggested: () => null, SupplierLinkButton: () => null, NotInProductGroup: () => null },
    "@/components/products/supplier-family-bar": { SupplierFamilyBar: () => null }, "./supplier-coverage-popup": {}, "./supplier-price-lines-actions": {},
    "./supplier-template-check-actions": {}, "./supplier-template-status-actions": {},
    "@/lib/products/supplier-template-check": { evaluateTemplateCheck: () => ({ ok: false }) },
  }, "\nexport { SourceLines };\n");
  const html = renderToStaticMarkup(React.createElement(SourceLines, {
    brandId: "b", templateId: "t", templateName: "Silver", onDone() {},
    source: { sourceId: "s", title: "Supplier", families: [], chosen: [], missing: [], lines: [{ key: "x", code: "2349", field: "Silver", state: "ambiguous", ourPrice: 535, ourCurrency: "EUR", supplierPrice: 600, supplierCurrency: "EUR", difference: 65, binding: { id: "b", kind: "alias" }, linkedTiers: ["101S", "162S"], matchHint: "Conflicting tiers: 101S EUR 600; 162S EUR 650." }] },
  }));
  assert.match(html, /Linked to 101S, 162S/);
  assert.match(html, /Unclear match/);
  assert.match(html, /101S EUR 600; 162S EUR 650/);
  assert.doesNotMatch(html, /Use supplier price/);
});
test("picker shows saved tiers and disables an unrelated second link with its reason", () => {
  let stateIndex = 0;
  const { SupplierLinkButton } = compile("components/quotations/supplier-price-link-panel.tsx", {
    ...common, react: { ...React, useState: (initial: unknown) => [stateIndex++ === 0 ? true : initial, () => {}] }, "@/lib/products/supplier-link-confirm": links,
  });
  const html = renderToStaticMarkup(React.createElement(SupplierLinkButton, {
    brandId: "b", onDone() {}, line: { code: "2349", supplierPrice: 535, supplierCurrency: "EUR", link: { tierLabel: "162S", rows: [{ targetKey: "t", code: "2349", name: "Silver 101S", note: "", price: 535, currency: "EUR", linkedTiers: ["101S"], taken: true, takenReason: "Different price (EUR 600.00) from the row (EUR 535.00)" }] } },
  }));
  assert.match(html, /Linked to 101S/);
  assert.match(html, /Different price \(EUR 600\.00\) from the row \(EUR 535\.00\)/);
  assert.match(html, /type="radio"[^>]*disabled/);
});

test("picker shows 'Also linked to' for a linked row that can take one more tier of the same price", () => {
  let stateIndex = 0;
  const { SupplierLinkButton } = compile("components/quotations/supplier-price-link-panel.tsx", {
    ...common, react: { ...React, useState: (initial: unknown) => [stateIndex++ === 0 ? true : initial, () => {}] }, "@/lib/products/supplier-link-confirm": links,
  });
  const html = renderToStaticMarkup(React.createElement(SupplierLinkButton, {
    brandId: "b", onDone() {}, line: { code: "608", supplierPrice: 49, supplierCurrency: "EUR", link: { tierLabel: "JC213", rows: [{ targetKey: "t", code: "608", name: "Seat depth", note: "", price: 49, currency: "EUR", linkedTiers: ["JC211"], taken: false }] } },
  }));
  assert.match(html, /Also linked to JC211/);
  assert.doesNotMatch(html, /type="radio"[^>]*disabled/);
});

// Shared groups: one card per supplier line. Real SourceLines render with lines from the real builder.
const groupTarget = (key: string, price: number, label: string) => ({ key, template_id: "T1", template_name: "Chair", brand_id: "b", architecture: "accessory_pricing", group_id: "g", row_id: key, column_id: "", dimension: "", price_field: "unit_price", physical_field: "price", code: "521304H", raw_code: "521304H", price, currency: "EUR", pricing_version: "3", label });
async function renderGroups(canSave?: boolean, mapped = false) {
  const { matchSupplierPrices } = await import("../../lib/products/supplier-price-matching");
  const targets = [groupTarget("a1", 170, "Column high 490 - 620 mm"), groupTarget("a2", 170, "Column high 520 - 615 mm")];
  const src = { key: "s", code: "521304H", price_field: "unit_price", dimension: "", raw_dimension: "", finishes: [], price: 174, currency: "EUR", row_keys: [], issues: [] };
  const bindings = mapped ? [{ id: "sb", code: "521304H", price_field: "unit_price", source_dimension: "", kind: "shared" as const, confirmed: true, target_keys: ["a1", "a2"] }] : [];
  const built = lines.buildPriceLines(matchSupplierPrices([src as any], targets as any, [], bindings), "T1", bindings).lines;
  const { SourceLines } = compile("components/quotations/supplier-price-lines-popup.tsx", {
    ...common, "./supplier-price-link-panel": { ConfirmAllSuggested: () => null, SupplierLinkButton: () => null, NotInProductGroup: () => null },
    "@/components/products/supplier-family-bar": { SupplierFamilyBar: () => null }, "./supplier-coverage-popup": {}, "./supplier-price-lines-actions": {},
    "./supplier-template-check-actions": {}, "./supplier-template-status-actions": {}, "@/lib/products/supplier-template-check": { evaluateTemplateCheck: () => ({ ok: false }) },
  }, "\nexport { SourceLines };\n");
  const html = renderToStaticMarkup(React.createElement(SourceLines, { brandId: "b", templateId: "T1", templateName: "Chair", onDone() {}, canSave, source: { sourceId: "s", title: "Supplier", families: [], chosen: [], missing: [], lines: built } }));
  return { html, built };
}
test("an unclear shared supplier line shows as one card with one button and per-row prices; the counts stay per line", async () => {
  const { html, built } = await renderGroups();
  assert.equal(built.length, 2);
  assert.equal((html.match(/data-shared-group="unmapped"/g) ?? []).length, 1);
  assert.equal((html.match(/Map these 2 rows as shared/g) ?? []).length, 1);
  assert.doesNotMatch(html, />Map as shared</);
  assert.match(html, /shared by 2 rows/);
  assert.match(html, /One supplier price covers these 2 rows\. They will share the same price\./);
  assert.match(html, /Column high 490 - 620 mm/); assert.match(html, /Column high 520 - 615 mm/);
  assert.match(html, /differs from supplier price/, "both 170 rows are marked, the supplier price is 174");
  assert.match(html, /All \(2\)/); assert.match(html, /Needs attention \(2\)/);
});
test("a user who may not save sees the card without the button and with the reason", async () => {
  const { html } = await renderGroups(false);
  assert.equal((html.match(/data-shared-group="unmapped"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Map these 2 rows as shared/);
  assert.match(html, /Brand price approver permission required\./);
});
test("a mapped shared group shows Shared (N rows) and the existing Remove mapping", async () => {
  const { html } = await renderGroups(true, true);
  assert.equal((html.match(/data-shared-group="mapped"/g) ?? []).length, 1);
  assert.match(html, /Shared \(2 rows\)/);
  assert.equal((html.match(/Remove mapping/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Map these/);
});
