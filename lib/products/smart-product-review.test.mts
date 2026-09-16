import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import {
  applySmartProductReviewCurrencyOverride,
  collectPricedRowCurrencies,
  collectSourcePageNumbers,
  compactSourcePageRanges,
  createReviewedProductTemplateDraft,
  deriveSmartProductReviewCurrencyState,
  fillNullPricedRowCurrenciesFromDefault,
  formatDraftPrice,
  getSmartProductReviewSections,
  partialExtractionStatus,
  reviewImportantRequirements,
  reviewedProductTemplateDraftForApply,
  smartProductWarningSummary,
  smartProductExtractionCoverage,
  updateReviewedMaterialSuggestion,
  updateReviewedMatrix,
  updateReviewedMatrixPrice,
  updateReviewedMatrixRow,
  updateReviewedOptionItem,
  updateReviewedTemplate,
} from "./smart-product-review.js";

test("important requirements use one trimmed, distinct line per saved value", () => {
  assert.deepEqual(reviewImportantRequirements(" Finishing top required \n\nWall fixing required\nFinishing top required "), ["Finishing top required", "Wall fixing required"]);
  assert.deepEqual(reviewImportantRequirements(""), []);
});

test("Smart Setup keeps imported requirements in a dedicated expanded-row textarea", () => {
  const source = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
  ["Important Requirements", "One requirement per line", "reviewImportantRequirements", "value={row.importantRequirements}"].forEach((expected) => assert.ok(source.includes(expected)));
  assert.ok((source.match(/ImportantRequirementsField/g) ?? []).length >= 4);
});

test("partial extraction status detects explicit continuation warnings only", () => {
  const warning = "Extraction complete through printed page 44. Printed pages 45–54 remain and must be extracted in the next supplemental batch.";
  assert.deepEqual(partialExtractionStatus(["Unreadable price.", warning]), { warning, extractedThrough: "Printed page 44", remainingPages: "Printed pages 45-54" });
  assert.equal(partialExtractionStatus(["Unreadable price."]), null);
  assert.equal(partialExtractionStatus(["Supplemental extraction required for a source image."]), null);
});

test("partial extraction status uses the latest batch and clears without a continuation warning", () => {
  const first = "Extraction complete through printed pages 38-44. Printed pages 45-54 remain and must be extracted in the next supplemental batch.";
  const latest = "Extraction complete through printed page 49. Printed pages 50-54 remain and must be extracted in the next supplemental batch.";
  assert.deepEqual(partialExtractionStatus([first, latest]), { warning: latest, extractedThrough: "Printed page 49", remainingPages: "Printed pages 50-54" });
  assert.equal(partialExtractionStatus([]), null);
});

test("partial extraction UI reuses Add More JSON and preserves normal warnings generically", () => {
  const source = readFileSync("components/products/smart-product-json-import.tsx", "utf8");
  ["PARTIAL EXTRACTION", "MORE EXTRACTION REQUIRED", "EXTRACTION COVERAGE", "Source batches:", "Continue the existing product family; do not create a new template.", "smart-product-add-more-json", "smart-product-partial-extraction", "Review warnings"].forEach((expected) => assert.ok(source.includes(expected)));
  assert.ok(!source.includes("Universal Cabinets"));
});

test("extraction coverage compacts all imported source pages and uses only explicit pending warnings", () => {
  assert.equal(compactSourcePageRanges([38, 39, 40, 41, 42, 43, 44]), "38–44");
  assert.equal(compactSourcePageRanges([38, 39, 40, 45, 46]), "38–40, 45–46");
  const draft = structuredClone(reviewedSource);
  draft.sources = [38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 54].map((pageNumber) => ({ id: `page-${pageNumber}`, documentName: null, pageNumber, region: null, rawText: null }));
  draft.extractionWarnings = ["Unreadable price.", "Extraction complete through printed page 44. Printed pages 45-54 remain and must be extracted in the next supplemental batch."];
  assert.deepEqual(collectSourcePageNumbers(draft), [38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54]);
  assert.deepEqual(smartProductExtractionCoverage(draft, 2), { extractedPages: "38–54", pendingPages: "45-54", status: "PARTIAL", sourceBatchCount: 2 });
  draft.extractionWarnings = ["Finishing top reference pending review."];
  assert.deepEqual(smartProductExtractionCoverage(draft, 2), { extractedPages: "38–54", pendingPages: null, status: "COMPLETE", sourceBatchCount: 2 });
});

test("review helpers preserve explicit zero and omit empty pricing sections", () => {
  assert.equal(formatDraftPrice(null), "—");
  assert.equal(formatDraftPrice(0), "0");
  assert.deepEqual(getSmartProductReviewSections({
    version: 1,
    template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: null,
    pricing: { workstationRows: [], baseModelRows: [{ id: "base", label: null, displayName: null, dimensions: null, currency: null, price: 0, specification: null, supplierCodes: [], referenceCodes: [] }], priceMatrices: [], modularGroups: [] },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  }), [["Base / Model Pricing", 1]]);
});

const reviewedSource: ProductTemplateDraft = {
  version: 1,
  template: { templateName: "ARCA", templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: "Family specification", origin: null, supplierName: "True Design", dimensions: null, supplierCodes: [], referenceCodes: [] },
  defaultCurrency: "EUR",
  pricing: {
    workstationRows: [],
    baseModelRows: [],
    priceMatrices: [
      { id: "lounge", label: "ARCA Lounge", columns: [{ id: "cat-a", label: "COM / S" }], rows: [{ id: "aa-9090", label: "AA 9090", displayName: "High Backrest", dimensions: null, currency: "EUR", specification: "Original lounge specification", supplierCodes: ["AA 9090"], referenceCodes: [], prices: { "cat-a": 1323 } }] },
      { id: "small", label: "ARCA Small", columns: [{ id: "cat-a", label: "COM / S" }], rows: [{ id: "aa-8090", label: "AA 8090", displayName: "Small", dimensions: null, currency: "EUR", specification: "Small specification", supplierCodes: ["AA 8090"], referenceCodes: [], prices: { "cat-a": 900 } }] },
    ],
    modularGroups: [],
  },
  optionGroups: [{ id: "extras", label: "Extra Charges", selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] }, items: [{ id: "chrome", label: "Chrome Frame", displayName: "Chrome Frame", dimensions: null, currency: "EUR", price: 32, specification: "Original applicability", supplierCodes: [], referenceCodes: [] }] }],
  materialSuggestions: [{ id: "steel", label: "Steel", notes: "Steel notes", supplierCodes: [], referenceCodes: [] }, { id: "wood", label: "Wood", notes: "Wood notes", supplierCodes: [], referenceCodes: [] }],
  linkedFamilySuggestions: [],
  extractionWarnings: ["Review source applicability."],
  confidence: 0.9,
  sources: [],
};

test("validated draft enters an isolated editable review without changing the original", () => {
  const reviewed = createReviewedProductTemplateDraft(reviewedSource);
  assert.deepEqual(reviewed, reviewedSource);
  assert.notEqual(reviewed, reviewedSource);
  assert.notEqual(reviewed.pricing.priceMatrices[0], reviewedSource.pricing.priceMatrices[0]);
});

test("template and matrix edits preserve IDs and isolate sibling matrices", () => {
  const templateEdited = updateReviewedTemplate(reviewedSource, { specification: "Reviewed master specification" });
  const rowEdited = updateReviewedMatrixRow(templateEdited, 0, 0, { specification: "Reviewed AA 9090 specification" });
  const matrixEdited = updateReviewedMatrix(rowEdited, 0, { label: "ARCA Lounge Reviewed" });
  assert.equal(matrixEdited.template.specification, "Reviewed master specification");
  assert.equal(matrixEdited.pricing.priceMatrices[0].id, "lounge");
  assert.equal(matrixEdited.pricing.priceMatrices[0].rows[0].id, "aa-9090");
  assert.equal(matrixEdited.pricing.priceMatrices[0].rows[0].specification, "Reviewed AA 9090 specification");
  assert.deepEqual(matrixEdited.pricing.priceMatrices[1], reviewedSource.pricing.priceMatrices[1]);
  assert.equal(reviewedSource.template.specification, "Family specification");
});

test("matrix price editing targets one cell and preserves blank/null versus explicit zero", () => {
  const blank = updateReviewedMatrixPrice(reviewedSource, 0, 0, "cat-a", "");
  const zero = updateReviewedMatrixPrice(reviewedSource, 0, 0, "cat-a", "0");
  const numeric = updateReviewedMatrixPrice(reviewedSource, 0, 0, "cat-a", "1324");
  assert.equal(blank.pricing.priceMatrices[0].rows[0].prices["cat-a"], null);
  assert.equal(zero.pricing.priceMatrices[0].rows[0].prices["cat-a"], 0);
  assert.equal(numeric.pricing.priceMatrices[0].rows[0].prices["cat-a"], 1324);
  assert.equal(numeric.pricing.priceMatrices[1].rows[0].prices["cat-a"], 900);
});

test("option and material edits affect only their target records", () => {
  const optionEdited = updateReviewedOptionItem(reviewedSource, 0, 0, { specification: "Reviewed applicability" });
  const materialEdited = updateReviewedMaterialSuggestion(optionEdited, 0, { notes: "Reviewed steel notes" });
  assert.equal(materialEdited.optionGroups[0].items[0].specification, "Reviewed applicability");
  assert.equal(materialEdited.materialSuggestions[0].notes, "Reviewed steel notes");
  assert.equal(materialEdited.materialSuggestions[1].notes, "Wood notes");
  assert.equal(reviewedSource.optionGroups[0].items[0].specification, "Original applicability");
});

test("Apply receives the current reviewed draft and warning summary uses current warnings", () => {
  const edited = updateReviewedTemplate(reviewedSource, { specification: "Applied reviewed specification" });
  assert.equal(reviewedProductTemplateDraftForApply(edited).template.specification, "Applied reviewed specification");
  assert.notEqual(reviewedProductTemplateDraftForApply(edited).template.specification, reviewedSource.template.specification);
  assert.deepEqual(smartProductWarningSummary(edited, ["Validation warning"]), {
    count: 2,
    warnings: ["Review source applicability.", "Validation warning"],
  });
  assert.equal(normalizeProductTemplateDraft(edited).valid, true);
});

function currencyDraft() {
  return structuredClone(reviewedSource);
}

test("currency state derives common, default-filled, unresolved, and mixed priced rows", () => {
  const allEur = currencyDraft();
  assert.deepEqual(deriveSmartProductReviewCurrencyState(allEur), { kind: "common", currency: "EUR", hasUnresolvedPricedRows: false });

  const defaultFilled = currencyDraft();
  defaultFilled.pricing.priceMatrices[0].rows[0].currency = null;
  const filled = fillNullPricedRowCurrenciesFromDefault(defaultFilled);
  assert.equal(filled.pricing.priceMatrices[0].rows[0].currency, "EUR");
  assert.deepEqual(deriveSmartProductReviewCurrencyState(filled), { kind: "common", currency: "EUR", hasUnresolvedPricedRows: false });

  const unresolved = currencyDraft();
  unresolved.defaultCurrency = null;
  unresolved.pricing.priceMatrices[0].rows[0].currency = null;
  unresolved.pricing.priceMatrices[1].rows[0].currency = null;
  unresolved.optionGroups[0].items[0].currency = null;
  assert.deepEqual(deriveSmartProductReviewCurrencyState(unresolved), { kind: "unresolved", currency: null, hasUnresolvedPricedRows: true });
  assert.throws(() => reviewedProductTemplateDraftForApply(unresolved), /Select a currency/);

  const mixed = currencyDraft();
  mixed.pricing.priceMatrices[1].rows[0].currency = "USD";
  assert.deepEqual(deriveSmartProductReviewCurrencyState(mixed), { kind: "mixed", currency: null, hasUnresolvedPricedRows: false });
  assert.doesNotThrow(() => reviewedProductTemplateDraftForApply(mixed));
  mixed.optionGroups[0].items[0].currency = null;
  assert.deepEqual(deriveSmartProductReviewCurrencyState(mixed), { kind: "mixed", currency: null, hasUnresolvedPricedRows: true });
});

test("zero is a priced value for unresolved currency checks", () => {
  const value = currencyDraft();
  value.defaultCurrency = null;
  value.pricing.priceMatrices = [];
  value.optionGroups = [];
  value.pricing.baseModelRows = [{ id: "free", label: "Free", displayName: null, dimensions: null, currency: null, price: 0, specification: null, supplierCodes: [], referenceCodes: [] }];
  assert.deepEqual(collectPricedRowCurrencies(value), [null]);
  assert.equal(deriveSmartProductReviewCurrencyState(value).hasUnresolvedPricedRows, true);
});

test("global currency override covers every pricing structure without changing amounts", () => {
  const value = currencyDraft();
  value.pricing.workstationRows = [{ id: "desk", label: "Desk", displayName: null, dimensions: null, currency: "USD", price: 0, additionalPrice: 25, layoutType: null, specification: null, supplierCodes: [], referenceCodes: [] }];
  value.pricing.baseModelRows = [{ id: "base", label: "Base", displayName: null, dimensions: null, currency: null, price: 100, specification: null, supplierCodes: [], referenceCodes: [] }];
  value.pricing.modularGroups = [{ id: "modules", label: "Modules", defaultDimensions: null, defaultSpecification: null, matrix: { id: "module-matrix", label: null, columns: [{ id: "cat", label: "Cat" }], rows: [{ id: "module", label: "Module", displayName: null, dimensions: null, currency: "USD", specification: null, supplierCodes: [], referenceCodes: [], prices: { cat: 0 } }] } }];
  const overridden = applySmartProductReviewCurrencyOverride(value, "AED");
  assert.equal(overridden.defaultCurrency, "AED");
  assert.deepEqual(collectPricedRowCurrencies(overridden), ["AED", "AED", "AED", "AED", "AED", "AED"]);
  assert.equal(value.pricing.baseModelRows[0].currency, null);
  assert.equal(overridden.pricing.workstationRows[0].price, 0);
  assert.equal(overridden.pricing.workstationRows[0].additionalPrice, 25);
  assert.equal(overridden.pricing.baseModelRows[0].price, 100);
  assert.equal(overridden.pricing.priceMatrices[0].rows[0].prices["cat-a"], 1323);
  assert.equal(overridden.pricing.priceMatrices[1].rows[0].prices["cat-a"], 900);
  assert.equal(overridden.pricing.modularGroups[0].matrix!.rows[0].prices.cat, 0);
  assert.equal(overridden.optionGroups[0].items[0].price, 32);
});
