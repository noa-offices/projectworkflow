import { draftModularRows, isDirectModularGroup, type ProductTemplateDraft, type ProductTemplateDraftModularDirectRow, type ProductTemplateDraftModularGroup, type ProductTemplateDraftPriceMatrix, type ProductTemplateDraftCurrency, type ProductTemplateDraftDimension, type ProductTemplateDraftBaseModelRow, type ProductTemplateDraftMatrixRow, type ProductTemplateDraftPrice, type ProductTemplateDraftWorkstationRow, type ProductTemplateDraftSelectionRule } from "./product-template-draft";
import { smartReviewRuleTarget, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";
import { draftUngroupedBaseModelRows, replaceDraftBaseModelScopeRows } from "./base-model-draft-groups";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";

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

/** List operations shared by matrix models and later row-based review screens. */
export function addReviewedRow<T>(rows: T[], row: T): T[] { return [...rows, row]; }
export function moveReviewedRow<T>(rows: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= rows.length) return rows;
  const next = [...rows]; [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function removeReviewedRow<T extends { id: string }>(rows: T[], rowId: string): T[] {
  return rows.filter((row) => row.id !== rowId);
}

export type ManualMatrixModel = { id: string; name: string; code: string; specification: string; prices: Record<string, string> };
function manualMatrixRow(matrix: ProductTemplateDraftPriceMatrix, input: ManualMatrixModel): ProductTemplateDraftMatrixRow {
  const name = input.name.trim();
  return {
    id: input.id, label: name, displayName: name, supplierCodes: input.code.trim() ? [input.code.trim()] : [], referenceCodes: [],
    dimensions: null, currency: "EUR", specification: input.specification.trim() || null,
    prices: Object.fromEntries(matrix.columns.map((column) => [column.id, nullableReviewNumber(input.prices[column.id] ?? "")])),
  };
}
export function addReviewedMatrixModel(draft: ProductTemplateDraft, matrixIndex: number, input: ManualMatrixModel): ProductTemplateDraft {
  const matrix = draft.pricing.priceMatrices[matrixIndex];
  const name = input.name.trim();
  if (!matrix || !name || draft.pricing.priceMatrices.some((entry) => entry.rows.some((row) => row.id === input.id))) return draft;
  return updateReviewedMatrix(draft, matrixIndex, { rows: addReviewedRow(matrix.rows, manualMatrixRow(matrix, input)) });
}
export function moveReviewedMatrixModel(draft: ProductTemplateDraft, matrixIndex: number, rowIndex: number, direction: -1 | 1): ProductTemplateDraft {
  const matrix = draft.pricing.priceMatrices[matrixIndex];
  return matrix ? updateReviewedMatrix(draft, matrixIndex, { rows: moveReviewedRow(matrix.rows, rowIndex, direction) }) : draft;
}
type ReviewRuleTarget = { kind: string; group_id: string; row_id: string } | null | undefined;
/** Drops every option-group rule (draft and review plan) whose target `matches`, and fixes the route's row count. */
function removeReviewedRowRules(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan | undefined, matches: (target: ReviewRuleTarget) => boolean, routeKey: string, rowCount: number | null) {
  const cleanedDraft = { ...draft, optionGroups: draft.optionGroups.map((group) => group.conditionalConfiguration ? {
    ...group, conditionalConfiguration: { ...group.conditionalConfiguration, applicability: group.conditionalConfiguration.applicability.filter((rule) => !matches(rule.target ?? (rule.base_model_group_id && rule.base_model_row_id ? { kind: "base_model", group_id: rule.base_model_group_id, row_id: rule.base_model_row_id } : null))) },
  } : group) };
  const nextPlan = plan ? { ...plan, routes: plan.routes.map((route) => ({
    ...route,
    ...(route.key === routeKey && rowCount !== null ? { rowCount } : {}),
    ...(route.accessory ? { accessory: { ...route.accessory, rules: route.accessory.rules.filter((rule) => !matches(smartReviewRuleTarget(rule))) } } : {}),
  })) } : undefined;
  return { draft: cleanedDraft, plan: nextPlan && rowCount === null ? { ...nextPlan, routes: nextPlan.routes.filter((route) => route.key !== routeKey) } : nextPlan };
}
export function removeReviewedMatrixModel(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan | undefined, matrixIndex: number, rowId: string) {
  const matrix = draft.pricing.priceMatrices[matrixIndex];
  if (!matrix || matrix.rows.length <= 1 || !matrix.rows.some((row) => row.id === rowId)) return { draft, plan };
  const matches = (target: ReviewRuleTarget) => (target?.kind === "price_matrix" || target?.kind === "base_model") && target.group_id === matrix.id && target.row_id === rowId;
  return removeReviewedRowRules(updateReviewedMatrix(draft, matrixIndex, { rows: removeReviewedRow(matrix.rows, rowId) }), plan, matches, `matrix:${matrix.id}`, matrix.rows.length - 1);
}

/** Base / Model and Workstation rows: same add / move / remove behaviour as matrix models. An empty price stays missing (null), 0 stays 0. */
export type ManualPricedRow = { id: string; name: string; code: string; specification: string; price: string; additionalPrice?: string };
const reviewRowIdTaken = (draft: ProductTemplateDraft, id: string) =>
  draft.pricing.priceMatrices.some((matrix) => matrix.rows.some((row) => row.id === id)) || draft.pricing.baseModelRows.some((row) => row.id === id) || draft.pricing.workstationRows.some((row) => row.id === id) || draft.pricing.modularGroups.some((group) => group.id === id || draftModularRows(group).some((row) => row.id === id));
const manualPricedRow = (input: ManualPricedRow) => {
  const name = input.name.trim();
  return {
    id: input.id, label: name, displayName: name, supplierCodes: input.code.trim() ? [input.code.trim()] : [], referenceCodes: [],
    dimensions: null, currency: "EUR" as const, price: nullableReviewNumber(input.price), specification: input.specification.trim() || null,
  };
};
/** The ungrouped Base / Model rows are the table this phase edits; native System Groups are untouched. */
const setUngroupedBaseModelRows = (draft: ProductTemplateDraft, rows: ProductTemplateDraftBaseModelRow[]): ProductTemplateDraft =>
  ({ ...draft, pricing: { ...draft.pricing, baseModelRows: replaceDraftBaseModelScopeRows(draft.pricing.baseModelRows, null, rows) } });
export function addReviewedBaseModelRow(draft: ProductTemplateDraft, input: ManualPricedRow): ProductTemplateDraft {
  if (!input.name.trim() || reviewRowIdTaken(draft, input.id)) return draft;
  return setUngroupedBaseModelRows(draft, addReviewedRow(draftUngroupedBaseModelRows(draft.pricing), manualPricedRow(input)));
}
export function moveReviewedBaseModelRow(draft: ProductTemplateDraft, rowIndex: number, direction: -1 | 1): ProductTemplateDraft {
  const rows = draftUngroupedBaseModelRows(draft.pricing);
  const next = moveReviewedRow(rows, rowIndex, direction);
  return next === rows ? draft : setUngroupedBaseModelRows(draft, next);
}
export function removeReviewedBaseModelRow(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan | undefined, rowId: string) {
  const rows = draftUngroupedBaseModelRows(draft.pricing);
  if (rows.length <= 1 || !rows.some((row) => row.id === rowId)) return { draft, plan };
  const matches = (target: ReviewRuleTarget) => (target?.kind === "price_matrix" || target?.kind === "base_model") && target.group_id === LEGACY_BASE_MODEL_GROUP_ID && target.row_id === rowId;
  return removeReviewedRowRules(setUngroupedBaseModelRows(draft, removeReviewedRow(rows, rowId)), plan, matches, "base_model:rows", rows.length - 1);
}
const setWorkstationRows = (draft: ProductTemplateDraft, workstationRows: ProductTemplateDraftWorkstationRow[]): ProductTemplateDraft => ({ ...draft, pricing: { ...draft.pricing, workstationRows } });
export function addReviewedWorkstationRow(draft: ProductTemplateDraft, input: ManualPricedRow): ProductTemplateDraft {
  if (!input.name.trim() || reviewRowIdTaken(draft, input.id)) return draft;
  const row: ProductTemplateDraftWorkstationRow = { ...manualPricedRow(input), additionalPrice: nullableReviewNumber(input.additionalPrice ?? ""), layoutType: null };
  return setWorkstationRows(draft, addReviewedRow(draft.pricing.workstationRows, row));
}
export function moveReviewedWorkstationRow(draft: ProductTemplateDraft, rowIndex: number, direction: -1 | 1): ProductTemplateDraft {
  const next = moveReviewedRow(draft.pricing.workstationRows, rowIndex, direction);
  return next === draft.pricing.workstationRows ? draft : setWorkstationRows(draft, next);
}
export function removeReviewedWorkstationRow(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan | undefined, rowId: string) {
  const rows = draft.pricing.workstationRows;
  if (rows.length <= 1 || !rows.some((row) => row.id === rowId)) return { draft, plan };
  const matches = (target: ReviewRuleTarget) => target?.kind === "workstation" && target.row_id === rowId;
  return removeReviewedRowRules(setWorkstationRows(draft, removeReviewedRow(rows, rowId)), plan, matches, "workstation:rows", rows.length - 1);
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

export type ManualOptionLine = { id: string; name: string; supplierCode: string; price: string; specification: string };
export function addReviewedOptionLine(draft: ProductTemplateDraft, groupIndex: number, input: ManualOptionLine): ProductTemplateDraft {
  const name = input.name.trim();
  if (!name) return draft;
  const group = draft.optionGroups[groupIndex];
  if (!group) return draft;
  const price = nullableReviewNumber(input.price);
  const item: ProductTemplateDraft["optionGroups"][number]["items"][number] = {
    id: input.id, label: name, displayName: name, supplierCodes: input.supplierCode.trim() ? [input.supplierCode.trim()] : [], referenceCodes: [],
    dimensions: null, currency: "EUR", price, specification: input.specification.trim() || null,
    ...(group.priceCategories?.length ? { prices: Object.fromEntries(group.priceCategories.map((category) => [category.id, price])) } : {}),
  };
  return { ...draft, optionGroups: draft.optionGroups.map((entry, index) => index === groupIndex ? { ...entry, items: [...entry.items, item] } : entry) };
}

export function moveReviewedOptionLine(draft: ProductTemplateDraft, groupIndex: number, itemIndex: number, direction: -1 | 1): ProductTemplateDraft {
  const group = draft.optionGroups[groupIndex], target = itemIndex + direction;
  if (!group || target < 0 || target >= group.items.length) return draft;
  const items = [...group.items]; [items[itemIndex], items[target]] = [items[target], items[itemIndex]];
  return { ...draft, optionGroups: draft.optionGroups.map((entry, index) => index === groupIndex ? { ...entry, items } : entry) };
}

export function removeReviewedOptionLine(draft: ProductTemplateDraft, groupIndex: number, itemId: string): ProductTemplateDraft {
  const group = draft.optionGroups[groupIndex];
  if (!group || group.items.length <= 1 || !group.items.some((item) => item.id === itemId)) return draft;
  return { ...draft, optionGroups: draft.optionGroups.map((entry, index) => index === groupIndex ? {
    ...entry, items: entry.items.filter((item) => item.id !== itemId),
    selection: { ...entry.selection, defaultItemIds: entry.selection.defaultItemIds.filter((id) => id !== itemId) },
  } : entry) };
}

export function toggleReviewedOptionDefault(draft: ProductTemplateDraft, groupIndex: number, itemId: string): ProductTemplateDraft {
  const group = draft.optionGroups[groupIndex];
  if (!group || !group.items.some((item) => item.id === itemId)) return draft;
  const current = group.selection.defaultItemIds, selected = current.includes(itemId);
  const single = group.selection.maxSelections === 1 || group.conditionalConfiguration?.selection === "exactly_one";
  const defaultItemIds = single ? selected ? [] : [itemId]
    : selected ? current.filter((id) => id !== itemId)
      : group.selection.maxSelections !== null && current.length >= group.selection.maxSelections ? current : [...current, itemId];
  return { ...draft, optionGroups: draft.optionGroups.map((entry, index) => index === groupIndex ? { ...entry, selection: { ...entry.selection, defaultItemIds } } : entry) };
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

/** Modular Pricing: items of a matrix-priced group reuse the matrix row builder, items of a direct-priced group the priced-row builder. */
export type ManualModularItem = ManualPricedRow & { prices?: Record<string, string> };
export type ManualModularGroup = ManualPricedRow & { groupId: string; groupName: string };
const setModularGroup = (draft: ProductTemplateDraft, groupIndex: number, patch: Partial<ProductTemplateDraftModularGroup>): ProductTemplateDraft =>
  ({ ...draft, pricing: { ...draft.pricing, modularGroups: draft.pricing.modularGroups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group) } });
const modularRowsPatch = (group: ProductTemplateDraftModularGroup, rows: unknown[]): Partial<ProductTemplateDraftModularGroup> =>
  isDirectModularGroup(group) ? { directRows: rows as ProductTemplateDraftModularDirectRow[] } : { matrix: group.matrix ? { ...group.matrix, rows: rows as ProductTemplateDraftMatrixRow[] } : undefined };
export function addReviewedModularItem(draft: ProductTemplateDraft, groupIndex: number, input: ManualModularItem): ProductTemplateDraft {
  const group = draft.pricing.modularGroups[groupIndex];
  if (!group || !input.name.trim() || reviewRowIdTaken(draft, input.id)) return draft;
  const row = isDirectModularGroup(group) ? manualPricedRow(input) : group.matrix ? manualMatrixRow(group.matrix, { ...input, prices: input.prices ?? {} }) : null;
  return row ? setModularGroup(draft, groupIndex, modularRowsPatch(group, addReviewedRow<unknown>(draftModularRows(group), row))) : draft;
}
export function moveReviewedModularItem(draft: ProductTemplateDraft, groupIndex: number, rowIndex: number, direction: -1 | 1): ProductTemplateDraft {
  const group = draft.pricing.modularGroups[groupIndex];
  if (!group) return draft;
  const rows = draftModularRows(group);
  const next = moveReviewedRow(rows, rowIndex, direction);
  return next === rows ? draft : setModularGroup(draft, groupIndex, modularRowsPatch(group, next));
}
export function removeReviewedModularItem(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan | undefined, groupIndex: number, rowId: string) {
  const group = draft.pricing.modularGroups[groupIndex];
  const rows = group ? draftModularRows(group) : [];
  if (!group || rows.length <= 1 || !rows.some((row) => row.id === rowId)) return { draft, plan };
  const matches = (target: ReviewRuleTarget) => target?.kind === "modular" && target.group_id === group.id && target.row_id === rowId;
  return removeReviewedRowRules(setModularGroup(draft, groupIndex, modularRowsPatch(group, removeReviewedRow(rows, rowId))), plan, matches, `modular:${group.id}`, rows.length - 1);
}
/** A manual group is direct-priced with its first item, and gets its own review route (Apply only keeps groups that have one). */
export function addReviewedModularGroup(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan | undefined, input: ManualModularGroup) {
  const label = input.groupName.trim();
  if (!label || !input.name.trim() || input.groupId === input.id || reviewRowIdTaken(draft, input.groupId) || reviewRowIdTaken(draft, input.id)) return { draft, plan };
  const group: ProductTemplateDraftModularGroup = { id: input.groupId, label, defaultDimensions: null, defaultSpecification: null, pricingMode: "direct", directRows: [manualPricedRow(input)] };
  const route = { key: `modular:${group.id}`, sourceId: group.id, sourceKind: "modular" as const, sourceName: label, groupName: label, rowCount: 1, columnCount: 0, recommendedDestination: "modular" as const, destination: "modular" as const, supportedDestinations: ["modular", "skip"] as ("modular" | "skip")[] };
  const lastModular = plan ? plan.routes.map((item) => item.sourceKind).lastIndexOf("modular") : -1;
  const firstOption = plan ? plan.routes.findIndex((item) => item.sourceKind === "option") : -1;
  const at = !plan ? 0 : lastModular >= 0 ? lastModular + 1 : firstOption >= 0 ? firstOption : plan.routes.length;
  return {
    draft: { ...draft, pricing: { ...draft.pricing, modularGroups: [...draft.pricing.modularGroups, group] } },
    plan: plan ? { ...plan, routes: [...plan.routes.slice(0, at), route, ...plan.routes.slice(at)] } : plan,
  };
}
export function removeReviewedModularGroup(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan | undefined, groupId: string) {
  if (draft.pricing.modularGroups.length <= 1 || !draft.pricing.modularGroups.some((group) => group.id === groupId)) return { draft, plan };
  const matches = (target: ReviewRuleTarget) => target?.kind === "modular" && target.group_id === groupId;
  const without = { ...draft, pricing: { ...draft.pricing, modularGroups: draft.pricing.modularGroups.filter((group) => group.id !== groupId) } };
  return removeReviewedRowRules(without, plan, matches, `modular:${groupId}`, null);
}
