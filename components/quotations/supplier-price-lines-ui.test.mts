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
    brandId: "b", onDone() {}, line: { code: "2349", supplierPrice: 535, supplierCurrency: "EUR", link: { tierLabel: "162S", rows: [{ targetKey: "t", code: "2349", name: "Silver 101S", note: "", price: 535, currency: "EUR", linkedTiers: ["101S"], taken: true, takenReason: "Already linked. This row does not name all these tiers." }] } },
  }));
  assert.match(html, /Linked to 101S/);
  assert.match(html, /does not name all these tiers/);
  assert.match(html, /type="radio"[^>]*disabled/);
});
