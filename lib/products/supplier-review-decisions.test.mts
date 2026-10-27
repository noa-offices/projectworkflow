import assert from "node:assert/strict";
import test from "node:test";
import { canManageReviewDecisions, validateDecisionInput, decisionKey, supplierPriceChanged, usableSupplierPrice, decisionForRow, decisionWithDraft, conflictingDecisionKeys, inputForRow, type SavedReviewDecision } from "./supplier-review-decisions";
import { buildReviewRows, reviewRowsToCsv } from "./smart-setup-supplier-review";
import type { SmartSetupSupplierCheckResult } from "./smart-setup-supplier-check";

const result: SmartSetupSupplierCheckResult = { locator: "one", role: "main_product", code: "A1", priceField: "unit_price", dimension: "", status: "MISMATCH", reason: "price_differs", importedPrice: 120, importedCurrency: "EUR", referencePrice: 100, referenceCurrency: "EUR", source: { versionId: "19000000-0000-0000-0000-000000000001", definitionId: "d", title: "List", currency: "EUR", basis: "list" }, evidence: null };
const row = buildReviewRows([result], [])[0];
const input = { supplier_source_id: result.source.versionId, supplier_price_list_label: "List", model_code: "A1", price_field: "unit_price", category: null, imported_price: 120, supplier_price: 100, currency: "EUR", decision: "use_supplier", custom_price: null, note: null, status: "open" };
const saved = { ...input, id: "id", decided_by: "user", decided_by_name: "Amal Admin", decided_at: "2026-10-26T12:00:00Z", updated_by: "user", updated_at: "2026-10-26T12:00:00Z" } as SavedReviewDecision;

test("only active cost managers can save review decisions", () => {
  for (const role of ["system_owner", "admin_manager"]) assert.equal(canManageReviewDecisions(role, "active"), true);
  for (const role of ["procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer", "warehouse_staff", "unknown", null]) assert.equal(canManageReviewDecisions(role, "active"), false);
  for (const status of ["disabled", "pending", null]) assert.equal(canManageReviewDecisions("system_owner", status), false);
});
test("decision validation rejects invalid fields and accepts zero custom/supplier prices", () => {
  assert.deepEqual(validateDecisionInput(input), input);
  assert.equal(validateDecisionInput({ ...input, decision: "set_custom", custom_price: 0 }).custom_price, 0);
  for (const patch of [{ decision: "bad" }, { decision: "set_custom" }, { decision: "set_custom", custom_price: -1 }, { custom_price: 2 }, { note: "x".repeat(501) }, { note: 2 }, { supplier_price: null }, { supplier_price: Infinity }, { supplier_source_id: "bad" }, { model_code: " " }, { price_field: "bad" }, { currency: "bad" }, { status: "applied" }, { decided_by: "spoof" }]) assert.throws(() => validateDecisionInput({ ...input, ...patch }));
  assert.equal(validateDecisionInput({ ...input, supplier_price: 0 }).supplier_price, 0);
});
test("changed or unavailable supplier snapshots and cancelled decisions are not decided", () => {
  assert.equal(supplierPriceChanged(row, saved), false);
  assert.equal(supplierPriceChanged(row, { ...saved, supplier_price: 90 }), true);
  assert.equal(supplierPriceChanged(row, { ...saved, currency: "USD" }), true);
  const missing = { ...row, result: { ...result, status: "NOT_FOUND" as const, referencePrice: null } };
  assert.equal(usableSupplierPrice(missing), null);
  assert.equal(supplierPriceChanged(missing, saved), true);
  assert.equal(usableSupplierPrice({ ...row, result: { ...result, status: "NEEDS_REVIEW" } }), null);
  assert.equal(decisionForRow(row, { ...saved, supplier_price: 90 }), "");
  assert.equal(decisionForRow(row, { ...saved, status: "cancelled" }), "");
  assert.equal(decisionForRow(row, saved), "use_supplier");
});
test("CSV includes decision metadata, Dubai time, and guards notes including whitespace-prefixed formulas", () => {
  const csv = reviewRowsToCsv([row], { [decisionKey(row)]: { ...saved, note: "  =HYPERLINK(\"bad\")" } });
  assert.match(csv, /Decision,My price,Note,Decided by,Decided at/);
  assert.match(csv, /Use supplier price/); assert.match(csv, /Amal Admin/); assert.match(csv, /26 Oct 2026, 16:00/);
  assert.ok(csv.includes("'  =HYPERLINK"));
  for (const note of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "\n=1"]) assert.ok(reviewRowsToCsv([row], { [decisionKey(row)]: { ...saved, note } }).includes(`'${note}`));
  assert.match(reviewRowsToCsv([row], { [decisionKey(row)]: { ...saved, supplier_price: 90 } }), /Not decided/);
});
test("kept and custom amounts retain the imported currency when the supplier currency differs", () => {
  const mismatch = { ...row, result: { ...result, importedCurrency: "USD", status: "NEEDS_REVIEW" as const, reason: "currency_mismatch" as const } };
  const input = inputForRow(mismatch, { decision: "keep_imported", customPrice: "", note: "" });
  assert.equal(input?.currency, "USD"); assert.equal(input?.supplier_price, null);
  assert.equal(supplierPriceChanged(mismatch, { ...saved, ...input } as SavedReviewDecision), false);
  assert.equal(inputForRow(mismatch, { decision: "set_custom", customPrice: "80", note: "" })?.currency, "USD");
});
test("conflicting duplicate keys stay undecided in CSV even if the other category is filtered out", () => {
  const other = { ...row, category: "Other category" };
  const conflicts = conflictingDecisionKeys([row, other]);
  assert.equal(conflicts.has(decisionKey(row)), true);
  assert.equal(conflictingDecisionKeys([row, { ...row }]).size, 0);
  const csv = reviewRowsToCsv([row], { [decisionKey(row)]: { ...saved, decision: "set_custom", custom_price: 88 } }, conflicts);
  assert.match(csv, /Not decided,,/); assert.doesNotMatch(csv, /Set my price|,88,/);
});
test("clearing a saved action cancels it; blank custom prices fail before saving", () => {
  assert.equal(inputForRow(row, { decision: "", customPrice: "", note: "" }, saved)?.status, "cancelled");
  assert.equal(inputForRow(row, { decision: "", customPrice: "", note: "" }), null);
  assert.throws(() => inputForRow(row, { decision: "set_custom", customPrice: " ", note: "" }), /enter your price/);
});
test("a note edit does not reconfirm a stale action; explicit confirmation does", () => {
  const stale = { ...saved, supplier_price: 90 };
  const draft = { decision: "use_supplier" as const, customPrice: "", note: "Need to check" };
  assert.equal(decisionWithDraft(row, stale, draft), "");
  assert.throws(() => inputForRow(row, draft, stale), /confirm or change the action/);
  assert.equal(decisionWithDraft(row, stale, { ...draft, confirmed: true }), "use_supplier");
  assert.equal(inputForRow(row, { ...draft, confirmed: true }, stale)?.supplier_price, 100);
});
