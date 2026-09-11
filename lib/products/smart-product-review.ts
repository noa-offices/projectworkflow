import type { ProductTemplateDraft, ProductTemplateDraftCurrency, ProductTemplateDraftDimension, ProductTemplateDraftPrice, ProductTemplateDraftSelectionRule } from "./product-template-draft";

export type SmartProductReviewCurrencyState = {
  kind: "common" | "mixed" | "unresolved" | "none";
  currency: ProductTemplateDraftCurrency | null;
  hasUnresolvedPricedRows: boolean;
};

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
  draft.pricing.modularGroups.forEach((group) => group.matrix.rows.forEach((row) => {
    if (Object.values(row.prices).some(isNumericPrice)) currencies.push(row.currency);
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
  next.pricing.modularGroups.forEach((group) => group.matrix.rows.forEach((row) => { if (Object.values(row.prices).some(isNumericPrice) && row.currency === null) row.currency = defaultCurrency; }));
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
  next.pricing.modularGroups.forEach((group) => group.matrix.rows.forEach((row) => { row.currency = currency; }));
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

export function reviewedProductTemplateDraftForApply(draft: ProductTemplateDraft) {
  const resolved = fillNullPricedRowCurrenciesFromDefault(draft);
  if (deriveSmartProductReviewCurrencyState(resolved).hasUnresolvedPricedRows) {
    throw new Error("Select a currency before applying imported prices.");
  }
  return resolved;
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
