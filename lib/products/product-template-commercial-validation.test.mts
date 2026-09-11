import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import { validateCommercialDraft } from "./product-template-commercial-validation.js";

function draft(): ProductTemplateDraft {
  return {
    version: 1, template: { templateName: "Test", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] }, defaultCurrency: "AED",
    pricing: { workstationRows: [], baseModelRows: [], priceMatrices: [], modularGroups: [] }, optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  };
}
function row(id: string, price: number | null) { return { id, label: id, displayName: null, dimensions: null, currency: "AED" as const, price, specification: null, supplierCodes: [], referenceCodes: [] }; }

test("commercial validator flags advisory commercial risks without mutating the draft", () => {
  const value = draft();
  value.pricing.baseModelRows.push(row("base", 0));
  value.pricing.priceMatrices.push({ id: "matrix", label: "Upholstery", columns: [{ id: "sg1", label: "SG1" }, { id: "sg5", label: "SG5" }, { id: "hp4", label: "HP4" }], rows: [{ ...row("model", null), prices: { sg1: 0, sg5: null, hp4: 120 } }] });
  value.optionGroups.push({ id: "options", label: "Options", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [{ ...row("801", 0), specification: "Only for counter chairs; must be completed with support." }, row("802", 30)] });
  const before = structuredClone(value);
  const findings = validateCommercialDraft(value);
  assert.deepEqual(value, before);
  assert.deepEqual(findings.map((item) => item.code), ["ZERO_PRICE", "SIMILAR_MATRIX_CODE", "ZERO_PRICE", "MISSING_PRICE", "UNBOUNDED_OPTION_SELECTION", "ZERO_PRICE", "APPLICABILITY_TEXT", "REQUIRED_COMPANION_TEXT"]);
  assert.deepEqual(findings.find((item) => item.code === "ZERO_PRICE" && item.location.kind === "option_item")?.location, { kind: "option_item", groupId: "options", itemId: "801", field: "price" });
});

test("commercial validator finds duplicate normalized labels and preserves valid normal drafts", () => {
  const duplicate = draft();
  duplicate.pricing.priceMatrices.push({ id: "matrix", label: null, columns: [{ id: "one", label: "SG 3" }, { id: "two", label: "SG-3" }], rows: [{ ...row("model", null), prices: { one: 20, two: 30 } }] });
  assert.ok(validateCommercialDraft(duplicate).some((item) => item.code === "DUPLICATE_MATRIX_LABEL"));
  const normal = draft(); normal.pricing.baseModelRows.push(row("base", 100));
  assert.deepEqual(validateCommercialDraft(normal), []);
});

test("commercial validator leaves ProductTemplateDraft structural validation unchanged", () => {
  const invalid = normalizeProductTemplateDraft({ version: 1 });
  assert.equal(invalid.valid, false);
});

test("commercial validator distinguishes an explicit unavailable matrix cell from a missing price", () => {
  const value = draft();
  value.pricing.priceMatrices.push({ id: "legs", label: "Legs", columns: [{ id: "painted", label: "Painted" }, { id: "chromed", label: "Chromed" }], rows: [
    { ...row("known-missing", null), prices: { painted: 867, chromed: null }, unavailableCategoryIds: [] },
    { ...row("not-offered", null), prices: { painted: 867, chromed: null }, unavailableCategoryIds: ["chromed"] },
  ] });
  const missing = validateCommercialDraft(value).filter((item) => item.code === "MISSING_PRICE");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].location.rowId, "known-missing");
});

test("commercial validator detects only conservative incoming matrix code drift in matching matrices", () => {
  const existing = draft();
  existing.pricing.priceMatrices.push({ id: "upholstery", label: "Upholstery", columns: [{ id: "sg3", label: "SG3" }, { id: "lg6", label: "LG6" }, { id: "hp4", label: "HP4" }], rows: [] });
  const incoming = draft();
  incoming.pricing.priceMatrices.push({ id: "upholstery", label: "Upholstery", columns: [{ id: "sg5", label: "SG5" }, { id: "lgg", label: "LGG" }, { id: "hp-4", label: "HP-4" }], rows: [] });
  const findings = validateCommercialDraft(incoming, { existingDraft: existing });
  const drifts = findings.filter((item) => item.code === "POSSIBLE_CODE_DRIFT");
  assert.equal(drifts.length, 2);
  assert.ok(drifts[0].message.includes("SG5") && drifts[0].message.includes("SG3"));
  assert.ok(drifts[1].message.includes("LGG") && drifts[1].message.includes("LG6"));
  assert.equal(findings.some((item) => item.message.includes("HP-4")), false);
  assert.equal(validateCommercialDraft(incoming).some((item) => item.code === "POSSIBLE_CODE_DRIFT"), false);
  assert.deepEqual(existing.pricing.priceMatrices[0].columns.map((column) => column.label), ["SG3", "LG6", "HP4"]);
  assert.deepEqual(incoming.pricing.priceMatrices[0].columns.map((column) => column.label), ["SG5", "LGG", "HP-4"]);
});

test("commercial validator does not compare unrelated matrices for code drift", () => {
  const existing = draft(); existing.pricing.priceMatrices.push({ id: "existing", label: "Fabric", columns: [{ id: "sg3", label: "SG3" }], rows: [] });
  const incoming = draft(); incoming.pricing.priceMatrices.push({ id: "incoming", label: "Leather", columns: [{ id: "sg5", label: "SG5" }], rows: [] });
  assert.equal(validateCommercialDraft(incoming, { existingDraft: existing }).some((item) => item.code === "POSSIBLE_CODE_DRIFT"), false);
});
