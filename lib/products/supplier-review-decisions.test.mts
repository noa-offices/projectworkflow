import assert from "node:assert/strict";
import test from "node:test";
import { canManageReviewDecisions, validateDecisionInput, decisionKey, supplierPriceChanged, usableSupplierPrice, decisionForRow, decisionWithDraft, conflictingDecisionKeys, inputForRow, mapDecisions, type SavedReviewDecision } from "./supplier-review-decisions";
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
  assert.deepEqual(validateDecisionInput(input), { ...input, row_ref: "" });
  assert.equal(validateDecisionInput({ ...input, row_ref: "option:g:i:c" }).row_ref, "option:g:i:c");
  assert.throws(() => validateDecisionInput({ ...input, row_ref: "x".repeat(301) }));
  assert.throws(() => validateDecisionInput({ ...input, row_ref: 5 }));
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

// Interstuhl 2349: one option code, seven product rows (one per chair model), same code and price field, different prices.
const models = [["162S", 535], ["262S", 665], ["362S", 790], ["100S", 350], ["101S", 535], ["151S", 665], ["191S", 790]] as const;
const interstuhl = buildReviewRows(models.map(([m, price]) => ({ ...result, locator: `option:silver:2349-${m}`, code: "2349", status: "NEEDS_REVIEW" as const, reason: "needs_dimension_mapping" as const, importedPrice: price, referencePrice: null, referenceCurrency: null })), []);
const savedFor = (r: (typeof interstuhl)[number], decision: SavedReviewDecision["decision"], extra: Partial<SavedReviewDecision> = {}) => ({ ...saved, ...(inputForRow(r, { decision, customPrice: decision === "set_custom" ? "1" : "", note: "" })!), decision, ...extra }) as SavedReviewDecision;

test("rows sharing a code and price field but with different row identity are never locked and keep their own decision", () => {
  assert.equal(new Set(interstuhl.map(decisionKey)).size, 7);
  assert.equal(conflictingDecisionKeys(interstuhl).size, 0);
  const choices = ["ignore", "check_later", "keep_imported", "set_custom", "ignore", "keep_imported", "check_later"] as const;
  const records = interstuhl.map((r, i) => savedFor(r, choices[i]));
  assert.ok(records.every((r, i) => r.row_ref === interstuhl[i].result.locator));
  const map = mapDecisions(records, interstuhl); // save, then reload
  interstuhl.forEach((r, i) => assert.equal(decisionForRow(r, map[decisionKey(r)]), choices[i]));
  assert.equal(new Set(records.map((r) => JSON.stringify([r.model_code, r.price_field, r.row_ref]))).size, 7);
});
test("a decision saved the old way (no row identity) still loads on its row", () => {
  const legacy = { ...saved, category: row.category, row_ref: "" } as SavedReviewDecision;
  const legacyNoField = { ...saved, category: row.category } as Partial<SavedReviewDecision>; delete legacyNoField.row_ref; // rows returned by the old database have no row_ref at all until the migration
  for (const record of [legacy, legacyNoField as SavedReviewDecision]) {
    const map = mapDecisions([record], [row]);
    assert.equal(decisionForRow(row, map[decisionKey(row)]), "use_supplier");
  }
  // a different category does not inherit it, and a decision for the row itself wins over the old one
  assert.equal(mapDecisions([legacy], [{ ...row, category: "Other" }])[decisionKey({ ...row, category: "Other" })], undefined);
  const specific = { ...saved, row_ref: row.result.locator, decision: "ignore" } as SavedReviewDecision;
  assert.equal(decisionForRow(row, mapDecisions([legacy, specific], [row])[decisionKey(row)]), "ignore");
});
test("a true conflict (the same full key twice with different data) is still locked", () => {
  const twin = { ...interstuhl[0], result: { ...interstuhl[0].result, importedPrice: 999 } };
  assert.equal(conflictingDecisionKeys([interstuhl[0], twin]).has(decisionKey(interstuhl[0])), true);
});
