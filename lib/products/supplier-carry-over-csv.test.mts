import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewRows, reviewRowsToCsv } from "./smart-setup-supplier-review";
import { decisionKey, type SavedReviewDecision } from "./supplier-review-decisions";
import type { CarryOverDecision } from "./supplier-carry-over";
import type { SmartSetupSupplierCheckResult } from "./smart-setup-supplier-check";

const source = { versionId: "new", definitionId: "d", title: "New", currency: "EUR", basis: "list" };
const result = (code: string): SmartSetupSupplierCheckResult => ({ locator: code, role: "main_product", code, priceField: "unit_price", dimension: "", status: "MISMATCH", reason: "price_differs", importedPrice: 120, importedCurrency: "EUR", referencePrice: 100, referenceCurrency: "EUR", source, evidence: null });
const rows = buildReviewRows([result("S"), result("C"), result("P"), result("N")], []);
const earlier = { model_code: "C", price_field: "unit_price", category: null, decision: "set_custom", custom_price: 85, note: "=SUM(A1)", imported_price: 120, supplier_price: 100, currency: "EUR", decided_at: "2026-10-26T12:00:00Z", decided_by_name: "Junais KP", from_source_id: "old", from_label: "=Earlier list" } as CarryOverDecision;
const saved = { ...earlier, id: "saved", model_code: "S", supplier_source_id: "new", supplier_price_list_label: "New", status: "open", decided_by: "u", updated_by: "u", updated_at: "2026-10-26T12:00:00Z" } as SavedReviewDecision;
test("CSV reports saved, carried, changed and new provenance with guarded earlier notes", () => {
  const states = {
    [decisionKey(rows[0])]: { kind: "saved", saved },
    [decisionKey(rows[1])]: { kind: "carried_over", earlier },
    [decisionKey(rows[2])]: { kind: "price_changed", earlier: { ...earlier, model_code: "P", supplier_price: 90 } },
    [decisionKey(rows[3])]: { kind: "new" },
  } as const;
  const csv = reviewRowsToCsv(rows, { [decisionKey(rows[0])]: saved }, new Set(), states);
  assert.match(csv, /Source of decision/);
  assert.match(csv, /Saved/); assert.match(csv, /Carried over/); assert.match(csv, /Price changed/); assert.match(csv, /New/);
  assert.match(csv, /,85,'=SUM\(A1\),Junais KP/);
  assert.ok(csv.includes("'=Earlier list") === false, "source label is not a CSV column");
  const changedLine = csv.split("\r\n").find((line) => line.includes(",P,"))!;
  assert.match(changedLine, /Not decided/); assert.doesNotMatch(changedLine, /,85,/);
});
