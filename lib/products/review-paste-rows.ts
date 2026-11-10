import { baseModelGroupRouteKey } from "./base-model-draft-groups";
import { draftModularRows, type ProductTemplateDraft } from "./product-template-draft";

/** Single source of truth for the sourceKey a row's "Paste image" box uses. The review UI and the crop targets both read it. */
export const WORKSTATION_IMAGE_SCOPE = "workstation:rows";
export const UNGROUPED_BASE_MODEL_IMAGE_SCOPE = "base_model:rows";
export const matrixImageScope = (matrixId: string) => `matrix:${matrixId}`;
export const modularImageScope = (groupId: string) => `modular:${groupId}`;
export const optionImageScope = (groupId: string) => `option:${groupId}`;
export const baseModelRowImageScope = (groupId: string | null | undefined) => (groupId ? baseModelGroupRouteKey(groupId) : UNGROUPED_BASE_MODEL_IMAGE_SCOPE);

export type ReviewPasteRowKind = "Base / Model" | "Workstation" | "Category / Matrix" | "Modular" | "Accessory";
export type ReviewPasteRow = {
  sourceKey: string; rowId: string; kind: ReviewPasteRowKind; groupLabel: string;
  label: string | null; displayName: string | null; supplierCodes: string[]; referenceCodes: string[];
};
type RowLike = { id: string; label: string | null; displayName: string | null; supplierCodes: string[]; referenceCodes: string[] };
const entry = (sourceKey: string, kind: ReviewPasteRowKind, groupLabel: string, row: RowLike): ReviewPasteRow =>
  ({ sourceKey, rowId: row.id, kind, groupLabel, label: row.label, displayName: row.displayName, supplierCodes: row.supplierCodes, referenceCodes: row.referenceCodes });

/**
 * Every row that shows a "Paste image" box in the Smart Setup review. Direct modular rows (DirectModularRowsEditor)
 * have no paste box and are intentionally absent.
 */
export function reviewPasteRows(draft: ProductTemplateDraft): ReviewPasteRow[] {
  return [
    ...draft.pricing.baseModelRows.map((row) => entry(baseModelRowImageScope(row.groupId), "Base / Model", row.groupId ? row.groupLabel ?? row.groupId : "Base / Model Pricing", row)),
    ...draft.pricing.workstationRows.map((row) => entry(WORKSTATION_IMAGE_SCOPE, "Workstation", "Workstation Pricing", row)),
    ...draft.pricing.priceMatrices.flatMap((matrix) => matrix.rows.map((row) => entry(matrixImageScope(matrix.id), "Category / Matrix", matrix.label ?? matrix.id, row))),
    ...draft.pricing.modularGroups.filter((group) => group.matrix).flatMap((group) => draftModularRows(group).map((row) => entry(modularImageScope(group.id), "Modular", group.label ?? group.id, row))),
    ...draft.optionGroups.flatMap((group) => group.items.map((row) => entry(optionImageScope(group.id), "Accessory", group.label ?? group.id, row))),
  ];
}
