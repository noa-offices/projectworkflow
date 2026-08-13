import type { ProductTemplateDraft, ProductTemplateDraftPrice, ProductTemplateDraftPricedRow } from "./product-template-draft";

export type CommercialValidationSeverity = "warning" | "info";
export type CommercialValidationRecommendedAction = "verify_source" | "review_rules" | "review_configuration" | "review_value";
export type CommercialValidationLocation = {
  kind: "template" | "base_model_row" | "workstation_row" | "price_matrix" | "price_matrix_column" | "price_matrix_cell" | "modular_item" | "option_group" | "option_item";
  groupId?: string;
  rowId?: string;
  columnId?: string;
  itemId?: string;
  field?: string;
};
export type CommercialValidationFinding = {
  severity: CommercialValidationSeverity;
  code: "ZERO_PRICE" | "MISSING_PRICE" | "DUPLICATE_MATRIX_LABEL" | "SIMILAR_MATRIX_CODE" | "POSSIBLE_CODE_DRIFT" | "UNBOUNDED_OPTION_SELECTION" | "APPLICABILITY_TEXT" | "REQUIRED_COMPANION_TEXT";
  location: CommercialValidationLocation;
  title: string;
  message: string;
  recommendedAction: CommercialValidationRecommendedAction;
};

export type CommercialValidationContext = { existingDraft?: ProductTemplateDraft; incomingDraft?: ProductTemplateDraft };

const applicabilityText = /\b(?:not applicable|only available|only for|not for|except|not available|cannot be combined|not compatible)\b/i;
const requiredCompanionText = /\b(?:always complete with|must be completed with|requires|required with)\b/i;

function rowName(row: Pick<ProductTemplateDraftPricedRow, "id" | "label" | "displayName" | "supplierCodes">) {
  return row.displayName ?? row.label ?? row.supplierCodes[0] ?? row.id;
}

function normalizedCode(value: string | null) {
  return (value ?? "").trim().toUpperCase().replace(/[\s._-]/g, "");
}

function shortCode(value: string) {
  return /^[A-Z0-9]{2,4}$/.test(value) && /[A-Z]/.test(value);
}

function editDistanceOne(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let differences = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) { leftIndex += 1; rightIndex += 1; continue; }
    differences += 1;
    if (differences > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else { leftIndex += 1; rightIndex += 1; }
  }
  return true;
}

function similarShortCodes(left: string, right: string) {
  if (!shortCode(left) || !shortCode(right) || !/\d/.test(`${left}${right}`) || !editDistanceOne(left, right)) return false;
  const lastLeft = left.at(-1);
  const lastRight = right.at(-1);
  return !(left.slice(0, -1) === right.slice(0, -1) && lastLeft !== undefined && lastRight !== undefined && /\d/.test(lastLeft) && /\d/.test(lastRight) && Math.abs(Number(lastLeft) - Number(lastRight)) === 1);
}

function finding(severity: CommercialValidationSeverity, code: CommercialValidationFinding["code"], location: CommercialValidationLocation, title: string, message: string, recommendedAction: CommercialValidationRecommendedAction): CommercialValidationFinding {
  return { severity, code, location, title, message, recommendedAction };
}

function priceFindings(findings: CommercialValidationFinding[], price: ProductTemplateDraftPrice, location: CommercialValidationLocation, label: string) {
  if (price === 0) findings.push(finding("warning", "ZERO_PRICE", location, "Zero price — verify source", `${label} has an explicit zero price. Verify it against the manufacturer source.`, "verify_source"));
  else if (price === null) findings.push(finding("info", "MISSING_PRICE", location, "Missing price", `No supplied price is present for ${label}.`, "review_value"));
}

export function validateCommercialDraft(draft: ProductTemplateDraft, context?: CommercialValidationContext): CommercialValidationFinding[] {
  const findings: CommercialValidationFinding[] = [];

  draft.pricing.baseModelRows.forEach((row) => priceFindings(findings, row.price, { kind: "base_model_row", rowId: row.id, field: "price" }, `Base / Model row “${rowName(row)}”`));
  draft.pricing.workstationRows.forEach((row) => {
    priceFindings(findings, row.price, { kind: "workstation_row", rowId: row.id, field: "price" }, `Workstation row “${rowName(row)}”`);
    priceFindings(findings, row.additionalPrice, { kind: "workstation_row", rowId: row.id, field: "additionalPrice" }, `Workstation additional price for “${rowName(row)}”`);
  });

  const inspectMatrix = (matrix: ProductTemplateDraft["pricing"]["priceMatrices"][number], kind: "price_matrix_cell" | "modular_item", groupId: string) => {
    const normalizedLabels = new Map<string, string>();
    matrix.columns.forEach((column) => {
      const normalized = normalizedCode(column.label ?? column.id);
      if (normalized && normalizedLabels.has(normalized)) findings.push(finding("warning", "DUPLICATE_MATRIX_LABEL", { kind: "price_matrix_column", groupId, columnId: column.id, field: "label" }, "Duplicate normalized matrix label", `Column “${column.label ?? column.id}” normalizes to the same value as “${normalizedLabels.get(normalized)}”. Verify the source labels.`, "verify_source"));
      else if (normalized) normalizedLabels.set(normalized, column.label ?? column.id);
    });
    for (let leftIndex = 0; leftIndex < matrix.columns.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < matrix.columns.length; rightIndex += 1) {
      const left = matrix.columns[leftIndex]; const right = matrix.columns[rightIndex];
      const leftCode = normalizedCode(left.label ?? left.id); const rightCode = normalizedCode(right.label ?? right.id);
      if (similarShortCodes(leftCode, rightCode)) findings.push(finding("warning", "SIMILAR_MATRIX_CODE", { kind: "price_matrix_column", groupId, columnId: right.id, field: "label" }, "Possible pricing-code mismatch — verify source", `Short matrix codes “${left.label ?? left.id}” and “${right.label ?? right.id}” are very similar. Verify both against the source.`, "verify_source"));
    }
    matrix.rows.forEach((row) => matrix.columns.forEach((column) => priceFindings(findings, row.prices[column.id] ?? null, { kind, groupId, rowId: row.id, columnId: column.id, field: `prices.${column.id}` }, `Matrix cell “${rowName(row)}” / “${column.label ?? column.id}”`)));
  };
  draft.pricing.priceMatrices.forEach((matrix) => inspectMatrix(matrix, "price_matrix_cell", matrix.id));
  draft.pricing.modularGroups.forEach((group) => inspectMatrix(group.matrix, "modular_item", group.id));

  if (context?.existingDraft) {
    const existingMatrices = context.existingDraft.pricing.priceMatrices;
    draft.pricing.priceMatrices.forEach((incoming) => {
      const matching = existingMatrices.find((existing) => existing.id === incoming.id || (normalizedCode(existing.label) && normalizedCode(existing.label) === normalizedCode(incoming.label)));
      if (!matching) return;
      incoming.columns.forEach((incomingColumn) => {
        const incomingCode = normalizedCode(incomingColumn.label ?? incomingColumn.id);
        matching.columns.forEach((existingColumn) => {
          const existingCode = normalizedCode(existingColumn.label ?? existingColumn.id);
          if (!incomingCode || incomingCode === existingCode || !similarShortCodes(incomingCode, existingCode)) return;
          findings.push(finding("warning", "POSSIBLE_CODE_DRIFT", { kind: "price_matrix_column", groupId: incoming.id, columnId: incomingColumn.id, field: "label" }, "Possible pricing-code drift", `Incoming pricing code “${incomingColumn.label ?? incomingColumn.id}” is very similar to existing code “${existingColumn.label ?? existingColumn.id}” in this matrix. Verify both against the manufacturer source before merging.`, "verify_source"));
        });
      });
    });
  }

  draft.optionGroups.forEach((group) => {
    const pricedItems = group.items.filter((item) => item.price !== null);
    if (group.selection.mode === "optional" && group.selection.maxSelections === null && pricedItems.length > 1) findings.push(finding("warning", "UNBOUNDED_OPTION_SELECTION", { kind: "option_group", groupId: group.id, field: "selection" }, "Unlimited simultaneous selection", "This option group allows unlimited selections. Verify that these items are commercially compatible when selected together.", "review_configuration"));
    group.items.forEach((item) => {
      priceFindings(findings, item.price, { kind: "option_item", groupId: group.id, itemId: item.id, field: "price" }, `Option item “${rowName(item)}”`);
      if (applicabilityText.test(item.specification ?? "")) findings.push(finding("warning", "APPLICABILITY_TEXT", { kind: "option_item", groupId: group.id, itemId: item.id, field: "specification" }, "Applicability rule detected in text", "This item contains model/compatibility restrictions in its specification. Review Conditional Configuration before Apply.", "review_rules"));
      if (requiredCompanionText.test(item.specification ?? "")) findings.push(finding("warning", "REQUIRED_COMPANION_TEXT", { kind: "option_item", groupId: group.id, itemId: item.id, field: "specification" }, "Possible required-companion rule", "This item contains language that may require companion configuration. Review the rule before Apply.", "review_rules"));
    });
  });
  return findings;
}
