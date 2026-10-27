import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReviewRows } from "@/lib/products/smart-setup-supplier-review";
import { decisionKey, type DecisionMap, type SavedReviewDecision } from "@/lib/products/supplier-review-decisions";
import type { SmartSetupSupplierCheckResult } from "@/lib/products/smart-setup-supplier-check";

const source = { versionId: "19b00000-0000-0000-0002-000000000001", definitionId: "d", title: "List", currency: "EUR", basis: "list" };
const results: SmartSetupSupplierCheckResult[] = ["A1", "A2", "A3"].map((code) => ({ locator: code, role: "main_product", code, priceField: "unit_price", dimension: "", status: "MISMATCH", reason: "price_differs", importedPrice: 120, importedCurrency: "EUR", referencePrice: 100, referenceCurrency: "EUR", source, evidence: null }));
const rows = buildReviewRows(results, []);
const fresh = { fingerprint: "fp", output: { source, results }, cells: [], unsupported: [] };
const savedRow = { decision: "ignore", status: "open", supplier_price: 100, currency: "EUR" } as SavedReviewDecision;
let saved: DecisionMap = {};
mock.module("./use-supplier-review-decisions", { namedExports: { useSupplierReviewDecisions: () => ({ rows, saved, edits: {}, conflicts: new Set<string>(), loading: false, loadError: null, enabled: true, saving: false, message: null, saveError: null, unsavedCount: 0, updateDraft() {}, save: async () => 0, retry() {} }) } });
const { SupplierReviewDialog, ReviewTableRow } = await import("./smart-setup-supplier-review-dialog");
const render = () => renderToStaticMarkup(createElement(SupplierReviewDialog, { fresh, stale: false, selected: null, canManageDecisions: true, onClose() {} }));

test("default view hides saved reviewed rows and counts them", () => {
  saved = { [decisionKey(rows[0])]: savedRow, [decisionKey(rows[1])]: savedRow };
  const html = render();
  assert.match(html, /Showing 1 of 3 rows \(2 reviewed hidden\)/);
  assert.match(html, /Show reviewed \(2\)/);
  assert.match(html, /aria-pressed="false"[^>]*>Show reviewed/);
  assert.doesNotMatch(html, /<tr[^>]*>.*A1.*<\/tr>/);
  assert.match(html, /A3/);
});

test("empty reviewed queue explains that prices did not change", () => {
  saved = Object.fromEntries(rows.map((row) => [decisionKey(row), savedRow]));
  const html = render();
  assert.match(html, /Showing 0 of 3 rows \(3 reviewed hidden\)/);
  assert.match(html, /All rows in this view are reviewed\. Product prices have not changed\./);
  assert.match(html, /Show reviewed \(3\)/);
});

test("a shown reviewed row has the grey Reviewed tag", () => {
  const html = renderToStaticMarkup(createElement(ReviewTableRow, { row: rows[0], reviewed: true }));
  assert.match(html, /bg-zinc-100[^>]*>Reviewed<\/span>/);
});
