import assert from "node:assert/strict";
import test from "node:test";
import { commercialValidationActionLabel, commercialValidationFindingsLookup, commercialValidationGroup, commercialValidationLocationKey, commercialValidationLocationLabel } from "./product-template-commercial-validation-presentation.js";
import { validateCommercialDraft } from "./product-template-commercial-validation.js";
import type { ProductTemplateDraft } from "./product-template-draft.js";

const draft: ProductTemplateDraft = { version: 1, template: { templateName: "EVERYis1", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "EUR", pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] }, optionGroups: [{ id: "castors", label: "Castors / Glides", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] }, items: [{ id: "801", label: "801", displayName: "Soft Double Castors", dimensions: null, currency: "EUR", price: 0, specification: null, supplierCodes: ["801"], referenceCodes: [] }] }], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: ["Existing extraction warning"], confidence: null, sources: [] };

test("commercial validation presentation groups findings and uses readable locations", () => {
  const finding = validateCommercialDraft(draft)[0];
  assert.equal(commercialValidationGroup(finding), "Prices");
  assert.equal(commercialValidationActionLabel(finding), "Verify against manufacturer source");
  assert.equal(commercialValidationLocationLabel(draft, finding), "Option Group “Castors / Glides” → Soft Double Castors");
});

test("commercial validation presentation groups code drift with matrix codes", () => {
  const finding = { ...validateCommercialDraft(draft)[0], code: "POSSIBLE_CODE_DRIFT" as const };
  assert.equal(commercialValidationGroup(finding), "Matrix Codes");
});

test("commercial validation presentation groups findings by stable location", () => {
  const findings = validateCommercialDraft(draft);
  const key = commercialValidationLocationKey(findings[0].location);
  assert.equal(commercialValidationFindingsLookup(findings).get(key)?.length, 1);
});
