import { draftModularRows, type ProductTemplateDraft, type ProductTemplateDraftCurrency, type ProductTemplateDraftDimension, type ProductTemplateDraftPrice, type ProductTemplateDraftSelectionRule } from "./product-template-draft";

/** Prices of a modular row in either pricing mode (matrix cells or one direct price). */
function modularRowPrices(row: { prices?: Record<string, ProductTemplateDraftPrice>; price?: ProductTemplateDraftPrice }) {
  return row.prices ? Object.values(row.prices) : [row.price ?? null];
}

export type SmartProductReviewCurrencyState = {
  kind: "common" | "mixed" | "unresolved" | "none";
  currency: ProductTemplateDraftCurrency | null;
  hasUnresolvedPricedRows: boolean;
};

export type PartialExtractionStatus = { warning: string; extractedThrough: string | null; remainingPages: string | null };

function printedPageLabel(value: string, plural = false) {
  return `Printed page${plural ? "s" : ""} ${value.replace(/\s+/g, " ").trim()}`;
}

export function partialExtractionStatus(warnings: string[]): PartialExtractionStatus | null {
  for (const warning of [...warnings].reverse()) {
    const normalized = warning.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
    const partial = /extraction complete through/i.test(normalized) && (/(?:page|pages)\s+\d+(?:\s*-\s*\d+)?\s+remain/i.test(normalized) || /supplemental extraction (?:is )?required/i.test(normalized));
    if (!partial) continue;
    const extracted = /extraction complete through\s+(?:printed\s+)?pages?\s+(\d+(?:\s*-\s*\d+)?)/i.exec(normalized)?.[1] ?? null;
    const remaining = /(?:printed\s+)?pages?\s+(\d+(?:\s*-\s*\d+)?)\s+remain/i.exec(normalized)?.[1] ?? null;
    return { warning, extractedThrough: extracted ? printedPageLabel(extracted, extracted.includes("-")) : null, remainingPages: remaining ? printedPageLabel(remaining, remaining.includes("-")) : null };
  }
  return null;
}

export function collectSourcePageNumbers(draft: ProductTemplateDraft) {
  return [...new Set(draft.sources.map((source) => source.pageNumber).filter((pageNumber): pageNumber is number => typeof pageNumber === "number" && Number.isInteger(pageNumber) && pageNumber > 0))].sort((left, right) => left - right);
}

export function compactSourcePageRanges(pageNumbers: number[]) {
  const pages = [...new Set(pageNumbers.filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0))].sort((left, right) => left - right);
  return pages.reduce<string[]>((ranges, page, index) => {
    const previous = pages[index - 1];
    if (index === 0 || page !== previous + 1) ranges.push(String(page));
    else if (page === previous + 1) ranges[ranges.length - 1] = ranges[ranges.length - 1].includes("–") ? `${ranges[ranges.length - 1].split("–")[0]}–${page}` : `${previous}–${page}`;
    return ranges;
  }, []).join(", ");
}

/**
 * Coverage status combines two independent signals:
 * 1. The extractor's own claim (extractionWarnings -> partialExtractionStatus) — unchanged, existing behavior.
 * 2. The uploaded Source QA PDF's actual supplied page set (when known), independently diffed against the
 *    pages the draft actually represents (collectSourcePageNumbers). A supplied page missing from that set
 *    forces PARTIAL even when extractionWarnings incorrectly claim COMPLETE. Pages merely referenced in the
 *    source text (e.g. "see page 40") but never part of the uploaded PDF are a separate Source QA
 *    classification and must never be treated as a missing supplied page here.
 *
 * `suppliedPhysicalPageNumbers` are the uploaded PDF's own 1-based physical page indices (page 1, 2, 3…),
 * which live in a different numbering domain than the printed catalogue page numbers the extractor records
 * (e.g. printed pages 28-37). They must never be diffed against each other directly — that is the exact bug
 * this guards against. The only safe, non-invented anchor available here is the lowest printed page number
 * the extractor itself already recorded for this draft: physical page 1 is assumed to correspond to that
 * printed page, giving physicalPageNumber -> printedPageNumber = physicalPageNumber + (minExtractedPrintedPage - 1).
 * Without at least one extracted printed page there is no anchor, so no cross-domain comparison is attempted.
 */
export function smartProductExtractionCoverage(draft: ProductTemplateDraft, sourceBatchCount: number, suppliedPhysicalPageNumbers?: number[] | null) {
  const partial = partialExtractionStatus(draft.extractionWarnings);
  const extractedPageNumbers = collectSourcePageNumbers(draft);
  const extractedSet = new Set(extractedPageNumbers);
  const minExtractedPrintedPage = extractedPageNumbers[0] ?? null;
  const missingSuppliedPageNumbers = Array.isArray(suppliedPhysicalPageNumbers) && minExtractedPrintedPage !== null
    ? suppliedPhysicalPageNumbers
        .filter((physicalPageNumber) => Number.isInteger(physicalPageNumber) && physicalPageNumber > 0)
        .map((physicalPageNumber) => physicalPageNumber + (minExtractedPrintedPage - 1))
        .filter((printedPageNumber) => !extractedSet.has(printedPageNumber))
    : [];
  const missingSuppliedPages = missingSuppliedPageNumbers.length ? compactSourcePageRanges(missingSuppliedPageNumbers) : null;
  const warningPendingPages = partial?.remainingPages?.replace(/^Printed pages?\s+/i, "") ?? null;
  const pendingPages = [warningPendingPages, missingSuppliedPages].filter((value): value is string => Boolean(value)).join(", ") || null;
  return {
    extractedPages: compactSourcePageRanges(extractedPageNumbers),
    pendingPages,
    missingSuppliedPages,
    status: (partial || missingSuppliedPages) ? "PARTIAL" : "COMPLETE",
    sourceBatchCount,
  } as const;
}

function isNumericPrice(value: ProductTemplateDraftPrice) {
  return typeof value === "number" && Number.isFinite(value);
}

export function collectPricedRowCurrencies(draft: ProductTemplateDraft) {
  const currencies: Array<ProductTemplateDraftCurrency | null> = [];
  draft.pricing.workstationRows.forEach((row) => {
    if (isNumericPrice(row.price) || isNumericPrice(row.additionalPrice)) currencies.push(row.currency);
  });
  draft.pricing.baseModelRows.forEach((row) => {
    if (isNumericPrice(row.price)) currencies.push(row.currency);
  });
  draft.pricing.priceMatrices.forEach((matrix) => matrix.rows.forEach((row) => {
    if (Object.values(row.prices).some(isNumericPrice)) currencies.push(row.currency);
  }));
  draft.pricing.modularGroups.forEach((group) => draftModularRows(group).forEach((row) => {
    if (modularRowPrices(row).some(isNumericPrice)) currencies.push(row.currency);
  }));
  draft.optionGroups.forEach((group) => group.items.forEach((item) => {
    if (isNumericPrice(item.price)) currencies.push(item.currency);
  }));
  return currencies;
}

export function deriveSmartProductReviewCurrencyState(draft: ProductTemplateDraft): SmartProductReviewCurrencyState {
  const rowCurrencies = collectPricedRowCurrencies(draft);
  if (!rowCurrencies.length) return { kind: draft.defaultCurrency ? "common" : "none", currency: draft.defaultCurrency, hasUnresolvedPricedRows: false };
  const explicitCurrencies = [...new Set(rowCurrencies.filter((currency): currency is ProductTemplateDraftCurrency => currency !== null))];
  const hasNullRows = rowCurrencies.some((currency) => currency === null);
  const safeDefault = draft.defaultCurrency !== null && explicitCurrencies.every((currency) => currency === draft.defaultCurrency);
  const hasUnresolvedPricedRows = hasNullRows && !safeDefault;
  if (explicitCurrencies.length > 1) return { kind: "mixed", currency: null, hasUnresolvedPricedRows };
  const commonCurrency = explicitCurrencies[0] ?? (safeDefault ? draft.defaultCurrency : null);
  if (commonCurrency) return { kind: "common", currency: commonCurrency, hasUnresolvedPricedRows };
  return { kind: "unresolved", currency: null, hasUnresolvedPricedRows: true };
}

export function fillNullPricedRowCurrenciesFromDefault(draft: ProductTemplateDraft) {
  const defaultCurrency = draft.defaultCurrency;
  if (!defaultCurrency) return structuredClone(draft);
  const explicitCurrencies = new Set(collectPricedRowCurrencies(draft).filter((currency): currency is ProductTemplateDraftCurrency => currency !== null));
  if ([...explicitCurrencies].some((currency) => currency !== defaultCurrency)) return structuredClone(draft);
  const next = structuredClone(draft);
  next.pricing.workstationRows.forEach((row) => { if ((isNumericPrice(row.price) || isNumericPrice(row.additionalPrice)) && row.currency === null) row.currency = defaultCurrency; });
  next.pricing.baseModelRows.forEach((row) => { if (isNumericPrice(row.price) && row.currency === null) row.currency = defaultCurrency; });
  next.pricing.priceMatrices.forEach((matrix) => matrix.rows.forEach((row) => { if (Object.values(row.prices).some(isNumericPrice) && row.currency === null) row.currency = defaultCurrency; }));
  next.pricing.modularGroups.forEach((group) => draftModularRows(group).forEach((row) => { if (modularRowPrices(row).some(isNumericPrice) && row.currency === null) row.currency = defaultCurrency; }));
  next.optionGroups.forEach((group) => group.items.forEach((item) => { if (isNumericPrice(item.price) && item.currency === null) item.currency = defaultCurrency; }));
  return next;
}

export function applySmartProductReviewCurrencyOverride(draft: ProductTemplateDraft, currency: ProductTemplateDraftCurrency) {
  const next = structuredClone(draft);
  next.defaultCurrency = currency;
  // This is an explicit label/interpretation override. Numeric prices are never converted.
  next.pricing.workstationRows.forEach((row) => { row.currency = currency; });
  next.pricing.baseModelRows.forEach((row) => { row.currency = currency; });
  next.pricing.priceMatrices.forEach((matrix) => matrix.rows.forEach((row) => { row.currency = currency; }));
  next.pricing.modularGroups.forEach((group) => draftModularRows(group).forEach((row) => { row.currency = currency; }));
  next.optionGroups.forEach((group) => group.items.forEach((item) => { item.currency = currency; }));
  return next;
}

export function createReviewedProductTemplateDraft(draft: ProductTemplateDraft) {
  return fillNullPricedRowCurrenciesFromDefault(draft);
}

export function nullableReviewNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function reviewCodeList(value: string) {
  return Array.from(new Set(value.split(/[\n,]+/).map((code) => code.trim()).filter(Boolean)));
}

export function reviewImportantRequirements(value: string) {
  return Array.from(new Set(value.split(/\n/).map((requirement) => requirement.trim()).filter(Boolean)));
}

export function reviewDimensionRawText(
  dimensions: ProductTemplateDraftDimension | null,
  rawText: string,
): ProductTemplateDraftDimension | null {
  const normalized = rawText.trim() || null;
  if (!dimensions && !normalized) return null;
  return {
    width: dimensions?.width ?? null,
    depth: dimensions?.depth ?? null,
    height: dimensions?.height ?? null,
    diameter: dimensions?.diameter ?? null,
    unit: dimensions?.unit ?? null,
    rawText: normalized,
  };
}

export function updateReviewedTemplate(
  draft: ProductTemplateDraft,
  patch: Partial<ProductTemplateDraft["template"]> & { defaultCurrency?: ProductTemplateDraft["defaultCurrency"] },
) {
  const { defaultCurrency, ...templatePatch } = patch;
  return {
    ...draft,
    ...(defaultCurrency !== undefined ? { defaultCurrency } : {}),
    template: { ...draft.template, ...templatePatch },
  };
}

export function updateReviewedMatrix(
  draft: ProductTemplateDraft,
  matrixIndex: number,
  patch: Partial<ProductTemplateDraft["pricing"]["priceMatrices"][number]>,
) {
  return {
    ...draft,
    pricing: {
      ...draft.pricing,
      priceMatrices: draft.pricing.priceMatrices.map((matrix, index) => index === matrixIndex ? { ...matrix, ...patch } : matrix),
    },
  };
}

export function updateReviewedMatrixRow(
  draft: ProductTemplateDraft,
  matrixIndex: number,
  rowIndex: number,
  patch: Partial<ProductTemplateDraft["pricing"]["priceMatrices"][number]["rows"][number]>,
) {
  const matrix = draft.pricing.priceMatrices[matrixIndex];
  return updateReviewedMatrix(draft, matrixIndex, {
    rows: matrix.rows.map((row, index) => index === rowIndex ? { ...row, ...patch } : row),
  });
}

export function updateReviewedMatrixPrice(
  draft: ProductTemplateDraft,
  matrixIndex: number,
  rowIndex: number,
  columnId: string,
  value: string,
) {
  const row = draft.pricing.priceMatrices[matrixIndex].rows[rowIndex];
  return updateReviewedMatrixRow(draft, matrixIndex, rowIndex, {
    prices: { ...row.prices, [columnId]: nullableReviewNumber(value) },
  });
}

export function updateReviewedOptionItem(
  draft: ProductTemplateDraft,
  groupIndex: number,
  itemIndex: number,
  patch: Partial<ProductTemplateDraft["optionGroups"][number]["items"][number]>,
) {
  return {
    ...draft,
    optionGroups: draft.optionGroups.map((group, index) => index === groupIndex
      ? { ...group, items: group.items.map((item, rowIndex) => rowIndex === itemIndex ? { ...item, ...patch } : item) }
      : group),
  };
}

export function updateReviewedMaterialSuggestion(
  draft: ProductTemplateDraft,
  index: number,
  patch: Partial<ProductTemplateDraft["materialSuggestions"][number]>,
) {
  return {
    ...draft,
    materialSuggestions: draft.materialSuggestions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  };
}

/** Number of optionGroups[].items across the draft still marked reviewStatus: "needs_review". */
export function accessoryNeedsReviewCount(draft: ProductTemplateDraft) {
  return draft.optionGroups.reduce((count, group) => count + group.items.filter((item) => item.reviewStatus === "needs_review").length, 0);
}

/** Smart Setup review boundary: no unresolved needs_review accessory may reach Apply. */
export function hasUnresolvedAccessoryReview(draft: ProductTemplateDraft) {
  return accessoryNeedsReviewCount(draft) > 0;
}

export const ACCESSORY_REVIEW_REQUIRED_MESSAGE = "Review required: confirm or exclude all accessories marked Needs Review before applying.";

/**
 * Strips Smart Setup's review-boundary metadata (reviewStatus/reviewReason)
 * from every optionGroups[].items entry. These fields must never reach saved
 * Product Template pricing JSON, Product Library, or quotation data.
 */
export function stripAccessoryReviewMetadata(draft: ProductTemplateDraft): ProductTemplateDraft {
  return {
    ...draft,
    optionGroups: draft.optionGroups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        const stripped = { ...item };
        delete stripped.reviewStatus;
        delete stripped.reviewReason;
        return stripped;
      }),
    })),
  };
}

export function reviewedProductTemplateDraftForApply(draft: ProductTemplateDraft) {
  const resolved = fillNullPricedRowCurrenciesFromDefault(draft);
  if (deriveSmartProductReviewCurrencyState(resolved).hasUnresolvedPricedRows) {
    throw new Error("Select a currency before applying imported prices.");
  }
  if (hasUnresolvedAccessoryReview(resolved)) {
    throw new Error(ACCESSORY_REVIEW_REQUIRED_MESSAGE);
  }
  return stripAccessoryReviewMetadata(resolved);
}

export function smartProductWarningSummary(draft: ProductTemplateDraft, validationWarnings: string[]) {
  const warnings = [...draft.extractionWarnings, ...validationWarnings];
  return { count: warnings.length, warnings };
}

export function formatDraftPrice(price: ProductTemplateDraftPrice) {
  return price === null ? "—" : String(price);
}

export function formatDraftDimensions(dimensions: ProductTemplateDraftDimension | null) {
  if (!dimensions) return "—";
  if (dimensions.rawText) return dimensions.rawText;
  const values = [dimensions.width, dimensions.depth, dimensions.height].filter((value): value is number => value !== null);
  if (dimensions.diameter !== null) return `Ø ${dimensions.diameter}${dimensions.unit ? ` ${dimensions.unit}` : ""}`;
  return values.length ? `${values.join(" × ")}${dimensions.unit ? ` ${dimensions.unit}` : ""}` : "—";
}

export function formatSelectionRule(selection: ProductTemplateDraftSelectionRule) {
  return `${selection.mode.replaceAll("_", " ")} · min ${selection.minSelections}${selection.maxSelections === null ? "" : ` · max ${selection.maxSelections}`}`;
}

export function getSmartProductReviewSections(draft: ProductTemplateDraft) {
  const sections: [string, number][] = [
    ["Workstation Pricing", draft.pricing.workstationRows.length],
    ["Base / Model Pricing", draft.pricing.baseModelRows.length],
    ["Finish / Category Pricing", draft.pricing.priceMatrices.length],
    ["Modular Item Pricing", draft.pricing.modularGroups.length],
    ["Options / Accessories", draft.optionGroups.length],
  ];
  return sections.filter(([, count]) => count > 0);
}
