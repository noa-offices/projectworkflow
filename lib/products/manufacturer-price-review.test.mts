import assert from "node:assert/strict";
import test from "node:test";
import type { ManufacturerPriceDifference, ManufacturerUpdateDiff } from "./manufacturer-update-diff.js";
import { defaultManufacturerPriceSelection, formatManufacturerPrice, manufacturerReviewContext, manufacturerReviewTitle, manufacturerSelectablePriceFields, selectedManufacturerPricePatches } from "./manufacturer-price-review.js";
import { manufacturerPricePatchKey } from "./manufacturer-price-patches.js";

const field = (rowId: string, currencyChanged = false): ManufacturerPriceDifference => ({ pricingType: "accessory", groupId: "group", groupName: "Group", rowId, subgroupId: null, subgroupName: null, displayName: rowId, supplierCode: rowId, field: "price", currentValue: 1, incomingValue: 2, currentCurrency: "EUR", incomingCurrency: currencyChanged ? "USD" : "EUR", priceChanged: true, currencyChanged });
const diff = (fields: ManufacturerPriceDifference[]): ManufacturerUpdateDiff => ({ sections: { base_model: { matchedItems: [], ambiguousMatches: [], newCandidates: [], notFoundInImportedSource: [], structuralDifferences: [] }, workstation: { matchedItems: [], ambiguousMatches: [], newCandidates: [], notFoundInImportedSource: [], structuralDifferences: [] }, category_matrix: { matchedItems: [], ambiguousMatches: [], newCandidates: [], notFoundInImportedSource: [], structuralDifferences: [] }, modular: { matchedItems: [], ambiguousMatches: [], newCandidates: [], notFoundInImportedSource: [], structuralDifferences: [] }, accessory: { matchedItems: [{ status: "MATCHED", evidence: "supplier_code", existing: fields[0], incoming: { routeKey: "option:group", groupId: "group", rowId: "incoming", displayName: "Incoming", supplierCode: "A", referenceCode: null }, priceFields: fields, nonPriceDifferences: [], context: { accessoryRole: null, applicabilityRuleCount: 0 } }], ambiguousMatches: [], newCandidates: [], notFoundInImportedSource: [], structuralDifferences: [] } }, summary: { matchedItems: 1, changedPriceFields: fields.length, unchangedPriceFields: 0, newCandidates: 0, notFoundInImportedSource: 0, ambiguousMatches: 0, nonPriceDifferences: 0, structuralDifferences: 0 }, deferredSections: [] });

test("normal changed prices select by default while currency conflicts stay unsupported", () => {
  const normal = field("normal"); const currency = field("currency", true); const result = diff([normal, currency]);
  assert.deepEqual(manufacturerSelectablePriceFields(result).map((item) => item.rowId), ["normal"]);
  assert.deepEqual([...defaultManufacturerPriceSelection(result)], [manufacturerPricePatchKey(normal)]);
});

test("clear, select-all, and individual uncheck produce exact accepted patches", () => {
  const one = field("one"); const two = field("two"); const result = diff([one, two]);
  assert.equal(selectedManufacturerPricePatches(result, new Set()).length, 0);
  assert.deepEqual(selectedManufacturerPricePatches(result, defaultManufacturerPriceSelection(result)).map((item) => item.rowId), ["one", "two"]);
  assert.deepEqual(selectedManufacturerPricePatches(result, new Set([manufacturerPricePatchKey(two)])).map((item) => item.rowId), ["two"]);
});

test("null price display never renders as zero", () => {
  assert.equal(formatManufacturerPrice(null, "EUR"), "—");
  assert.equal(formatManufacturerPrice(0, "EUR"), "EUR 0");
});

test("review titles and context use readable values without internal subgroup IDs", () => {
  assert.equal(manufacturerReviewTitle("1AF 090", "Service Unit W123.6 - Right"), "1AF 090 — Service Unit W123.6 - Right");
  assert.equal(manufacturerReviewTitle("1AF 090", "1AF 090"), "1AF 090");
  assert.equal(manufacturerReviewContext("Support Service Units", "W123.6", "Price"), "Support Service Units · W123.6 · Price");
  assert.equal(manufacturerReviewContext("Support Service Units", null, "Price"), "Support Service Units · Price");
});
