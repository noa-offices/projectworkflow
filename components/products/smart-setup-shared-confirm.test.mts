import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SmartSetupSupplierCheckResult } from "@/lib/products/smart-setup-supplier-check";

mock.module("@/app/products/smart-setup-supplier-check-actions", { namedExports: { checkSmartSetupSupplierPrices: async () => { throw Error("not called"); }, listSmartSetupSupplierSourcesAction: async () => ({ status: "unauthorized" }), loadSmartSetupSupplierFamilies: async () => { throw Error("not called"); } } });
mock.module("@/app/products/price-updates/supplier-sources/actions", { namedExports: { setSupplierTemplateFamilies: async () => { throw Error("not called"); } } });
mock.module("@/app/products/supplier-review-decision-actions", { namedExports: { listSupplierPriceDecisions: async () => [], saveSupplierPriceDecisions: async () => { throw Error("not called"); } } });
const { SupplierReviewDialog } = await import("./smart-setup-supplier-review-dialog");

const source = { versionId: "v1", definitionId: "d1", title: "List", currency: "EUR", basis: "list" };
const row = (locator: string, code: string, price: number, candidate = 100): SmartSetupSupplierCheckResult => ({ locator, role: "main_product", code, priceField: "unit_price", dimension: "", status: "NEEDS_REVIEW", reason: "shared_price_unconfirmed", importedPrice: price, importedCurrency: "EUR", referencePrice: null, referenceCurrency: null, source, evidence: null, sharedCandidate: { price: candidate, currency: "EUR" } });
const cells = (results: SmartSetupSupplierCheckResult[]) => results.map((r) => ({ locator: r.locator, label: r.locator, code: r.code, dimension: "", dimensionLabel: "" }));
const render = (results: SmartSetupSupplierCheckResult[], canManageDecisions: boolean) => renderToStaticMarkup(createElement(SupplierReviewDialog, { fresh: { fingerprint: "f", output: { source, results }, cells: cells(results), unsupported: [] }, stale: false, selected: null, onClose() {}, canManageDecisions, initialStatuses: ["NEEDS_REVIEW", "MISMATCH", "NOT_FOUND", "MATCHED"] } as never));

test("the review window offers Confirm shared on each shared row when every price equals the supplier price", () => {
  const html = render([row("a", "3283", 100), row("b", "3283", 100)], true);
  assert.equal(html.match(/Confirm shared/g)?.length, 4, "2 rows, each in the mobile card and the table");
  assert.doesNotMatch(html, />Undo</);
});
test("read-only users get the button too (it saves nothing)", () => {
  assert.equal(render([row("a", "801", 100), row("b", "801", 100)], false).match(/Confirm shared/g)?.length, 2);
});
test("a row price that differs from the supplier price: no button and a short plain reason", () => {
  const html = render([row("a", "3283", 90, 100), row("b", "3283", 90, 100)], true);
  assert.doesNotMatch(html, /Confirm shared/);
  assert.match(html, /A row price differs from the supplier price, so it cannot be confirmed\./);
});
test("a single row and a code without a usable supplier price get no button", () => {
  assert.doesNotMatch(render([row("a", "3283", 100)], true), /Confirm shared/);
  const noPrice = [row("a", "903", 100), row("b", "903", 100)].map(({ sharedCandidate, ...rest }) => { void sharedCandidate; return rest as SmartSetupSupplierCheckResult; });
  assert.doesNotMatch(render(noPrice, true), /Confirm shared/);
});
