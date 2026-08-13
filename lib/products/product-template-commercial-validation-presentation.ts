import type { ProductTemplateDraft, ProductTemplateDraftPricedRow } from "./product-template-draft";
import type { CommercialValidationFinding } from "./product-template-commercial-validation";

export type CommercialValidationGroup = "Prices" | "Matrix Codes" | "Configuration Rules" | "Applicability";
export type CommercialValidationFindingLookup = ReadonlyMap<string, CommercialValidationFinding[]>;

const groups: Record<CommercialValidationFinding["code"], CommercialValidationGroup> = {
  ZERO_PRICE: "Prices", MISSING_PRICE: "Prices", SIMILAR_MATRIX_CODE: "Matrix Codes", DUPLICATE_MATRIX_LABEL: "Matrix Codes", POSSIBLE_CODE_DRIFT: "Matrix Codes", UNBOUNDED_OPTION_SELECTION: "Configuration Rules", REQUIRED_COMPANION_TEXT: "Configuration Rules", APPLICABILITY_TEXT: "Applicability",
};

function rowLabel(row: Pick<ProductTemplateDraftPricedRow, "id" | "label" | "displayName" | "supplierCodes"> | undefined) {
  return row?.displayName ?? row?.label ?? row?.supplierCodes[0] ?? row?.id ?? "Unknown item";
}

export function commercialValidationGroup(finding: CommercialValidationFinding) { return groups[finding.code]; }

export function commercialValidationLocationKey(location: CommercialValidationFinding["location"]) {
  return [location.kind, location.groupId ?? "", location.rowId ?? "", location.columnId ?? "", location.itemId ?? "", location.field ?? ""].join("\u0000");
}

export function commercialValidationFindingsLookup(findings: CommercialValidationFinding[]): CommercialValidationFindingLookup {
  const lookup = new Map<string, CommercialValidationFinding[]>();
  findings.forEach((finding) => { const key = commercialValidationLocationKey(finding.location); lookup.set(key, [...(lookup.get(key) ?? []), finding]); });
  return lookup;
}

export function commercialValidationActionLabel(finding: CommercialValidationFinding) {
  return ({ verify_source: "Verify against manufacturer source", review_rules: "Review configuration rules", review_configuration: "Review option compatibility", review_value: "Review value" })[finding.recommendedAction];
}

export function commercialValidationLocationLabel(draft: ProductTemplateDraft, finding: CommercialValidationFinding) {
  const { location } = finding;
  if (location.kind === "base_model_row") return `Base / Model → ${rowLabel(draft.pricing.baseModelRows.find((row) => row.id === location.rowId))}`;
  if (location.kind === "workstation_row") return `Workstation → ${rowLabel(draft.pricing.workstationRows.find((row) => row.id === location.rowId))}`;
  if (location.kind === "option_group") return `Option Group “${draft.optionGroups.find((group) => group.id === location.groupId)?.label ?? location.groupId ?? "Unknown"}”`;
  if (location.kind === "option_item") {
    const group = draft.optionGroups.find((item) => item.id === location.groupId);
    return `Option Group “${group?.label ?? location.groupId ?? "Unknown"}” → ${rowLabel(group?.items.find((item) => item.id === location.itemId))}`;
  }
  const matrix = location.kind === "modular_item" ? draft.pricing.modularGroups.find((group) => group.id === location.groupId)?.matrix : draft.pricing.priceMatrices.find((group) => group.id === location.groupId);
  if (location.kind === "price_matrix_column") return `Price Matrix “${matrix?.label ?? location.groupId ?? "Unknown"}” → ${matrix?.columns.find((column) => column.id === location.columnId)?.label ?? location.columnId ?? "Unknown column"}`;
  if (location.kind === "price_matrix_cell" || location.kind === "modular_item") return `Price Matrix “${matrix?.label ?? location.groupId ?? "Unknown"}” → ${rowLabel(matrix?.rows.find((row) => row.id === location.rowId))} → ${matrix?.columns.find((column) => column.id === location.columnId)?.label ?? location.columnId ?? "Unknown column"}`;
  return location.groupId ?? "Template";
}
