import type { ProductTemplateDraft, ProductTemplateDraftDimension, ProductTemplateDraftPrice, ProductTemplateDraftSelectionRule } from "./product-template-draft";

export function createReviewedProductTemplateDraft(draft: ProductTemplateDraft) {
  return structuredClone(draft);
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
  return draft;
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
