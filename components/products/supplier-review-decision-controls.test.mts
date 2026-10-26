import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canManageReviewDecisions, type DecisionDraft } from "@/lib/products/supplier-review-decisions";
import { buildReviewRows } from "@/lib/products/smart-setup-supplier-review";
import type { SmartSetupSupplierCheckResult } from "@/lib/products/smart-setup-supplier-check";
import { ReviewDecisionControls, ReviewSaveButton } from "./supplier-review-decision-controls";

mock.module("@/app/products/supplier-review-decision-actions", { namedExports: { listSupplierPriceDecisions: async () => [], saveSupplierPriceDecisions: async () => { throw Error("No save during render"); } } });
const { SupplierReviewDialog } = await import("./smart-setup-supplier-review-dialog");
const r: SmartSetupSupplierCheckResult = { locator: "l", role: "main_product", code: "A1", priceField: "unit_price", dimension: "", status: "MISMATCH", reason: "price_differs", importedPrice: 120, importedCurrency: "EUR", referencePrice: 100, referenceCurrency: "EUR", source: { versionId: "19b00000-0000-0000-0002-000000000001", definitionId: "d", title: "List", currency: "EUR", basis: "list" }, evidence: null };
const fresh = { fingerprint: "fp", output: { source: r.source, results: [r] }, cells: [], unsupported: [] };
const draft: DecisionDraft = { decision: "", customPrice: "", note: "" };
const controls = (over: Partial<SmartSetupSupplierCheckResult> = {}, options: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ReviewDecisionControls, { row: buildReviewRows([{ ...r, ...over }], [])[0], draft, disabled: false, changed: false, conflict: false, onChange() {}, ...options }));

test("Action column and Save decisions are visible only for the two manager roles", () => {
  for (const role of ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff"]) {
    const manager = canManageReviewDecisions(role, "active");
    const html = renderToStaticMarkup(createElement(SupplierReviewDialog, { fresh, stale: false, selected: null, onClose() {}, canManageDecisions: manager }));
    assert.equal(/<th[^>]*>Action<\/th>/.test(html), manager, role);
    assert.equal(html.includes("Save decisions"), manager, role);
    assert.equal(html.includes("Select all shown"), manager, role);
    if (manager) assert.match(html, /<button[^>]*disabled=""[^>]*>Export CSV<\/button>/, "export waits for saved decisions to load");
  }
});
test("Use supplier price is disabled for missing and unusable prices, but zero is usable", () => {
  for (const over of [{ status: "NOT_FOUND", referencePrice: null }, { status: "NEEDS_REVIEW", referencePrice: 5 }, { referencePrice: null }, { referencePrice: -1 }]) assert.match(controls(over as Partial<SmartSetupSupplierCheckResult>), /value="use_supplier" disabled=""/);
  assert.doesNotMatch(controls({ referencePrice: 0 }), /value="use_supplier" disabled/);
});
test("custom price, note, changed-price tag and unsaved count render plainly", () => {
  const html = controls({}, { changed: true, draft: { decision: "set_custom", customPrice: "80", note: "Check finish" } });
  assert.match(html, /Price changed, check again/); assert.match(html, /bg-amber-50/);
  assert.match(html, /type="number"/); assert.match(html, /EUR/); assert.match(html, /<textarea/); assert.match(html, /Check finish/);
  assert.match(html, /Confirm this decision/);
  const button = renderToStaticMarkup(createElement(ReviewSaveButton, { count: 5, disabled: false, saving: false, onSave() {} }));
  assert.match(button, /5 unsaved changes/); assert.doesNotMatch(button, /disabled=""/);
});
test("manager view shows every row without paging; footer count appears only once decisions are known", async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ ...r, locator: `l${i}`, code: `C${i}` }));
  const html = renderToStaticMarkup(createElement(SupplierReviewDialog, { fresh: { ...fresh, output: { source: r.source, results: many } }, stale: false, selected: null, onClose() {}, canManageDecisions: true }));
  assert.equal(html.match(/<tr style="height:60px"/g)?.length, 120); assert.doesNotMatch(html, />Next</); assert.doesNotMatch(html, />Previous</);
  mock.module("@/app/products/smart-setup-supplier-check-actions", { namedExports: { checkSmartSetupSupplierPrices: async () => { throw Error("no check"); }, listSmartSetupSupplierSourcesAction: async () => ({ status: "unauthorized" }) } });
  const { SupplierVerificationPanel } = await import("./smart-setup-supplier-verification");
  const option = { definitionId: "d", name: "F", versionId: r.source.versionId, versionTitle: "List", effectiveFrom: null, receivedAt: null, currency: "EUR", basis: "list" };
  const footer = renderToStaticMarkup(createElement(SupplierVerificationPanel, { brandId: "b", sources: { state: "ready", options: [option], canManageDecisions: true }, definitionId: "d", onSelect() {}, selected: option, running: false, error: null, stale: false, fresh, reviewOpen: false, onReviewOpen() {}, onReviewClose() {}, onRun() {} }));
  assert.match(footer, /1 mismatch/); assert.doesNotMatch(footer, /0 decided/, "no made-up count before the saved decisions load");
});
