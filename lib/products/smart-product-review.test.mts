import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeProductTemplateDraft, type ProductTemplateDraft } from "./product-template-draft.js";
import {
  accessoryNeedsReviewCount,
  ACCESSORY_REVIEW_REQUIRED_MESSAGE,
  applySmartProductReviewCurrencyOverride,
  collectPricedRowCurrencies,
  collectSourcePageNumbers,
  compactSourcePageRanges,
  createReviewedProductTemplateDraft,
  deriveSmartProductReviewCurrencyState,
  fillNullPricedRowCurrenciesFromDefault,
  formatDraftPrice,
  getSmartProductReviewSections,
  hasUnresolvedAccessoryReview,
  partialExtractionStatus,
  reviewImportantRequirements,
  reviewedProductTemplateDraftForApply,
  smartProductWarningSummary,
  smartProductExtractionCoverage,
  stripAccessoryReviewMetadata,
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

test("1: Source QA has a Show / Hide control following the existing expanded/collapsed button pattern", () => {
  const source = readFileSync("components/products/source-qa-panel.tsx", "utf8");
  assert.ok(source.includes('aria-expanded={expanded} onClick={toggleExpanded} className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-emerald-900">{expanded ? "Hide" : "Show"}'), "Expected a Show/Hide toggle button reusing the existing button styling convention");
});

test("2: collapsing Source QA hides the missing-from-JSON list and AI report, gating them behind expanded", () => {
  const source = readFileSync("components/products/source-qa-panel.tsx", "utf8");
  assert.ok(source.includes("{expanded ? <>{aiError ?"), "Expected the AI error/report block to only render while expanded");
  assert.ok(source.includes("Missing from supplied pages ({missing.length})"), "Expected the full missing-from-JSON list to still exist in the expanded branch");
  const expandedBranch = source.slice(source.indexOf("{expanded ? <>{aiError ?"), source.indexOf("{source && cropPage ?"));
  assert.ok(expandedBranch.includes("Missing from supplied pages ({missing.length})"), "Expected the missing-item list to be nested inside the expanded-only branch");
});

test("3: a compact PDF/status/missing summary remains visible while Source QA is collapsed", () => {
  const source = readFileSync("components/products/source-qa-panel.tsx", "utf8");
  assert.ok(source.includes("const compactSummary = source ? `PDF: ${source.pageCount} pages · Status: ${sourceQaReviewStatus(findings) === \"pass\" ? \"PASS\" : \"REVIEW NEEDED\"} · Missing: ${missing.length}` : status;"), "Expected a compact summary reusing the existing pageCount/status/missing values");
  assert.ok(source.includes("{!expanded ? compactSummary : status}"), "Expected the collapsed header to show the compact summary instead of the raw status message");
});

test("4: expanding Source QA restores Run Source QA, Crop Images, and Upload / Replace PDF exactly as before", () => {
  const source = readFileSync("components/products/source-qa-panel.tsx", "utf8");
  ["Run Source QA", "Crop Images", "Upload / Replace PDF", "Running Source QA…"].forEach((expected) => assert.ok(source.includes(expected), `Expected Source QA to still contain: ${expected}`));
  assert.ok(source.includes("{expanded ? <><button disabled={!source || aiPending} onClick={() => void runAiQa()}"), "Expected Run Source QA/Crop Images/Upload PDF controls to be gated behind expanded, not removed");
});

test("5: toggling Show/Hide only changes local expand state and never touches QA data", () => {
  const source = readFileSync("components/products/source-qa-panel.tsx", "utf8");
  assert.ok(source.includes("const toggleExpanded = () => { setExpanded((current) => !current); autoCollapsed.current = true; };"), "Expected the toggle handler to only update expanded/autoCollapsed state");
  ["setSource", "setPages", "setIgnored", "setAiReport", "setAiError", "setStatus"].forEach((setter) => {
    const toggleLine = source.slice(source.indexOf("const toggleExpanded ="), source.indexOf("const toggleExpanded =") + 120);
    assert.ok(!toggleLine.includes(setter), `Expected toggleExpanded to never call ${setter}`);
  });
});

test("6: existing Source QA wiring (Run Source QA, Crop Image, Ignore, crop event, upload) is unchanged", () => {
  const source = readFileSync("components/products/source-qa-panel.tsx", "utf8");
  [
    "const runAiQa = async () => { if (!source || aiPending) return;",
    "window.addEventListener(\"source-qa-crop\", open)",
    "onClick={() => { setFixedTarget(null); setCropSearch(finding.sourceCode); setCropPage(finding.pageNumber); }}>Crop Image<",
    "onClick={() => setIgnored((current) => new Set([...current, finding.normalizedCode]))}>Ignore<",
    "<SourceQaCropViewer storagePath={source.storagePath} pageCount={source.pageCount} pages={pages} initialSearch={cropSearch} initialPage={cropPage} targets={targets} initialFixedTargetId={fixedTarget?.id} existingTargetIds={targetImageIds} onAssign={assign} onClose={() => { setCropPage(null); setFixedTarget(null); }} />",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected unchanged Source QA wiring: ${expected}`));
});

test("Source QA defaults to expanded before a PDF is uploaded and auto-collapses once, without re-collapsing on later toggles", () => {
  const source = readFileSync("components/products/source-qa-panel.tsx", "utf8");
  assert.ok(source.includes("const [expanded, setExpanded] = useState(true); const autoCollapsed = useRef(false);"));
  assert.ok(source.includes('if (!autoCollapsed.current) { autoCollapsed.current = true; setExpanded(false); } } catch (error)'), "Expected upload success to collapse the panel exactly once (guarded by the autoCollapsed ref)");
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
  assert.deepEqual(smartProductExtractionCoverage(draft, 2), { extractedPages: "38–54", pendingPages: "45-54", missingSuppliedPages: null, status: "PARTIAL", sourceBatchCount: 2 });
  draft.extractionWarnings = ["Finishing top reference pending review."];
  assert.deepEqual(smartProductExtractionCoverage(draft, 2), { extractedPages: "38–54", pendingPages: null, missingSuppliedPages: null, status: "COMPLETE", sourceBatchCount: 2 });
});

function draftWithExtractedPages(pageNumbers: number[]) {
  const draft = structuredClone(reviewedSource);
  draft.sources = pageNumbers.map((pageNumber) => ({ id: `page-${pageNumber}`, documentName: null, pageNumber, region: null, rawText: null }));
  draft.extractionWarnings = [];
  return draft;
}

const physicalPages10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test("1: physical PDF pages 1-10 (mapped to printed 28-37) with only printed 28-32,35-36 extracted reports pending 33-34,37, NOT pending 1-10", () => {
  const draft = draftWithExtractedPages([28, 29, 30, 31, 32, 35, 36]);
  const coverage = smartProductExtractionCoverage(draft, 1, physicalPages10);
  assert.equal(coverage.missingSuppliedPages, "33–34, 37");
  assert.equal(coverage.pendingPages, "33–34, 37");
  assert.notEqual(coverage.status, "COMPLETE");
  assert.equal(coverage.status, "PARTIAL");
  assert.ok(!(coverage.pendingPages ?? "").includes("1–10"), "Physical PDF indices 1-10 must never leak into the printed-page pending list");
});

test("1b: Sigma example — physical PDF pages 1-10 mapped to printed 28-37, extracted printed 28-36, pending is exactly 37 and PARTIAL", () => {
  const draft = draftWithExtractedPages([28, 29, 30, 31, 32, 33, 34, 35, 36]);
  const coverage = smartProductExtractionCoverage(draft, 1, physicalPages10);
  assert.equal(coverage.missingSuppliedPages, "37");
  assert.equal(coverage.status, "PARTIAL");
});

test("2: physical PDF pages 1-10 mapped to printed 28-37 with every printed page 28-37 extracted reports no pending pages and COMPLETE", () => {
  const draft = draftWithExtractedPages([28, 29, 30, 31, 32, 33, 34, 35, 36, 37]);
  const coverage = smartProductExtractionCoverage(draft, 1, physicalPages10);
  assert.equal(coverage.missingSuppliedPages, null);
  assert.equal(coverage.pendingPages, null);
  assert.equal(coverage.status, "COMPLETE");
});

test("3: a page referenced in source text but outside the supplied printed 28-37 batch is a separate classification, never a missing supplied page", () => {
  const draft = draftWithExtractedPages([28, 29, 30, 31, 32, 33, 34, 35, 36, 37]);
  const coverage = smartProductExtractionCoverage(draft, 1, physicalPages10);
  assert.equal(coverage.missingSuppliedPages, null);
  assert.equal(coverage.status, "COMPLETE");
  assert.ok(!(coverage.missingSuppliedPages ?? "").includes("40"), "Page 40, referenced but never supplied, must never appear as a missing supplied page");
});

test("4: missing supplied pages are computed even when extractionWarnings incorrectly claim completion", () => {
  const draft = draftWithExtractedPages([28, 29, 30, 31, 32, 35, 36]);
  draft.extractionWarnings = ["Extraction complete."];
  const coverage = smartProductExtractionCoverage(draft, 1, physicalPages10);
  assert.equal(coverage.missingSuppliedPages, "33–34, 37");
  assert.notEqual(coverage.status, "COMPLETE");
});

test("5: non-contiguous missing supplied page ranges render as exact compressed ranges", () => {
  const draft = draftWithExtractedPages([28, 30, 32, 34, 36]);
  const coverage = smartProductExtractionCoverage(draft, 1, physicalPages10);
  assert.equal(coverage.missingSuppliedPages, "29, 31, 33, 35, 37");
});

test("6: null/unknown supplied page metadata never fabricates missing-page ranges", () => {
  const draft = draftWithExtractedPages([28, 29, 30]);
  assert.deepEqual(smartProductExtractionCoverage(draft, 1, null).missingSuppliedPages, null);
  assert.deepEqual(smartProductExtractionCoverage(draft, 1, undefined).missingSuppliedPages, null);
  assert.deepEqual(smartProductExtractionCoverage(draft, 1, []).missingSuppliedPages, null);
});

test("7: without a resolvable printed-page anchor (no pages extracted yet), physical page indices are never cross-domain compared against a printed range", () => {
  const draft = draftWithExtractedPages([]);
  const coverage = smartProductExtractionCoverage(draft, 1, physicalPages10);
  assert.equal(coverage.missingSuppliedPages, null);
  assert.equal(coverage.status, "COMPLETE");
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

function draftWithNeedsReviewAccessory() {
  const draft = currencyDraft();
  draft.optionGroups[0].items.push({ id: "electrification", label: "Electrification Unit", displayName: "Electrification Unit", dimensions: null, currency: "EUR", price: 40, specification: null, supplierCodes: [], referenceCodes: [], reviewStatus: "needs_review", reviewReason: "Exact target-family applicability is not proven by the supplied source." });
  return draft;
}

test("7: accessoryNeedsReviewCount / hasUnresolvedAccessoryReview detect an unresolved needs_review item, and reviewedProductTemplateDraftForApply refuses to apply it", () => {
  const draft = draftWithNeedsReviewAccessory();
  assert.equal(accessoryNeedsReviewCount(draft), 1);
  assert.equal(hasUnresolvedAccessoryReview(draft), true);
  assert.throws(() => reviewedProductTemplateDraftForApply(draft), new RegExp(ACCESSORY_REVIEW_REQUIRED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("8: once every accessory is confirmed or excluded, Apply proceeds and returns the resolved draft", () => {
  const confirmed = draftWithNeedsReviewAccessory();
  confirmed.optionGroups[0].items[1].reviewStatus = "confirmed";
  assert.equal(hasUnresolvedAccessoryReview(confirmed), false);
  assert.doesNotThrow(() => reviewedProductTemplateDraftForApply(confirmed));

  const excluded = draftWithNeedsReviewAccessory();
  excluded.optionGroups[0].items = excluded.optionGroups[0].items.filter((item) => item.id !== "electrification");
  assert.equal(hasUnresolvedAccessoryReview(excluded), false);
  assert.doesNotThrow(() => reviewedProductTemplateDraftForApply(excluded));
});

test("9/10/11: reviewStatus/reviewReason are stripped before the draft reaches Product Template mapping, and never appear in the applied result", () => {
  const confirmed = draftWithNeedsReviewAccessory();
  confirmed.optionGroups[0].items[1].reviewStatus = "confirmed";
  const applied = reviewedProductTemplateDraftForApply(confirmed);
  applied.optionGroups.forEach((group) => group.items.forEach((item) => {
    assert.equal("reviewStatus" in item, false, "Expected reviewStatus to be stripped before Product Template mapping");
    assert.equal("reviewReason" in item, false, "Expected reviewReason to be stripped before Product Template mapping");
  }));
  assert.ok(!JSON.stringify(applied).includes("reviewStatus"), "Expected the applied draft JSON to never contain reviewStatus");
});

test("stripAccessoryReviewMetadata removes reviewStatus/reviewReason from every optionGroups item without touching other fields", () => {
  const draft = draftWithNeedsReviewAccessory();
  const stripped = stripAccessoryReviewMetadata(draft);
  const item = stripped.optionGroups[0].items[1];
  assert.equal("reviewStatus" in item, false);
  assert.equal("reviewReason" in item, false);
  assert.equal(item.price, 40);
  assert.equal(item.id, "electrification");
  // Original draft is untouched.
  assert.equal(draft.optionGroups[0].items[1].reviewStatus, "needs_review");
});
