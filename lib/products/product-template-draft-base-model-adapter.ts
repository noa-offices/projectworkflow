import { BASE_MODEL_GROUP_PRICING_TYPE } from "./base-model-pricing-groups";
import { draftBaseModelGroupIds, draftBaseModelGroupIsActive, draftBaseModelGroupLabel, draftBaseModelGroupRows, draftUngroupedBaseModelRows } from "./base-model-draft-groups";
import type { ProductTemplateDraft, ProductTemplateDraftBaseModelRole, ProductTemplateDraftBaseModelRow, ProductTemplateDraftMatrixRow, ProductTemplateDraftPricedRow } from "./product-template-draft";
import { directMatrixRowPrice, routeDraftPriceMatrices, type DraftPriceMatrixRoute } from "./product-template-draft-pricing-routing";

function dimensionText(dimension: ProductTemplateDraftPricedRow["dimensions"]) {
  return dimension?.rawText ?? [dimension?.diameter !== null && dimension?.diameter !== undefined ? `Ø${dimension.diameter}` : null, dimension?.width, dimension?.depth, dimension?.height].filter((value) => value !== null && value !== undefined).join(" × ") + (dimension?.unit ? ` ${dimension.unit}` : "");
}

function mapRow(row: ProductTemplateDraftPricedRow | ProductTemplateDraftMatrixRow, price: number | null, index: number, role?: ProductTemplateDraftBaseModelRole) {
  const codes = [...row.supplierCodes, ...row.referenceCodes];
  return { id: row.id, variant_name: row.label ?? row.id, display_name: row.displayName ?? row.label ?? "", supplier_price_list_code: codes[0] ?? "", dimension: dimensionText(row.dimensions), price, currency: row.currency ?? undefined, specification: row.specification ?? "", ...(row.importantRequirements?.length ? { importantRequirements: row.importantRequirements } : {}), ...(role ? { role } : {}), is_active: row.isActive !== false, sort_order: index };
}

function mapBaseModelDraftRow(row: ProductTemplateDraftBaseModelRow, index: number, warnings: string[]) {
  const codes = [...row.supplierCodes, ...row.referenceCodes];
  if (codes.length > 1) warnings.push(`Base/Model row '${row.label ?? row.displayName ?? row.id}' contains ${codes.length} supplier codes; only the primary code was applied.`);
  return mapRow(row, row.price, index, row.role);
}

/** Legacy flat Base/Model rows only: rows with a groupId belong to native groups. */
export function mapDraftBaseModelRows(draft: ProductTemplateDraft) {
  const warnings: string[] = [];
  const rows = draftUngroupedBaseModelRows(draft.pricing).map((row, index) => mapBaseModelDraftRow(row, index, warnings));
  return { rows, warnings };
}

/** One persisted BaseModelPricingGroup per native groupId, ordered by first appearance. */
export function mapDraftNativeBaseModelGroups(draft: ProductTemplateDraft, warnings: string[] = []) {
  return draftBaseModelGroupIds(draft.pricing).map((groupId, groupIndex) => ({
    id: groupId,
    pricing_type: BASE_MODEL_GROUP_PRICING_TYPE,
    group_name: draftBaseModelGroupLabel(draft.pricing, groupId),
    is_active: draftBaseModelGroupIsActive(draft.pricing, groupId),
    sort_order: groupIndex,
    items: draftBaseModelGroupRows(draft.pricing, groupId).map((row, index) => mapBaseModelDraftRow(row, index, warnings)),
  }));
}

export function mapDraftBaseModelPricing(draft: ProductTemplateDraft, matrixRouting: Record<string, DraftPriceMatrixRoute["kind"]> = {}) {
  const flat = mapDraftBaseModelRows(draft);
  const warnings = [...flat.warnings];
  const nativeGroups = mapDraftNativeBaseModelGroups(draft, warnings);
  const nativeGroupIds = new Set(nativeGroups.map((group) => group.id));
  const rowIds = new Set([...flat.rows, ...nativeGroups.flatMap((group) => group.items)].map((row) => row.id));
  const matrixGroups = routeDraftPriceMatrices(draft, matrixRouting).routes.flatMap((route, matrixIndex) => {
    if (route.kind !== "base_model") return [];
    if (nativeGroupIds.has(route.matrix.id)) {
      warnings.push(`Matrix '${route.matrix.label ?? route.matrix.id}' was not applied to Base/Model because its group id collides with a native Base/Model group id.`);
      return [];
    }
    const column = route.matrix.columns[0];
    const items = route.matrix.rows.flatMap((row, rowIndex) => {
      if (rowIds.has(row.id)) {
        warnings.push(`Base/Model row '${row.label ?? row.displayName ?? row.id}' was not duplicated from matrix '${route.matrix.label ?? route.matrix.id}' because its stable row ID already exists in baseModelRows.`);
        return [];
      }
      rowIds.add(row.id);
      return [mapRow(row, directMatrixRowPrice(row, column) ?? null, rowIndex)];
    });
    return items.length ? [{ id: route.matrix.id, pricing_type: BASE_MODEL_GROUP_PRICING_TYPE, group_name: route.matrix.label ?? route.matrix.id, is_active: true, sort_order: matrixIndex + nativeGroups.length + (flat.rows.length ? 1 : 0), items }] : [];
  });
  const groups = [...nativeGroups.map((group) => ({ ...group, sort_order: group.sort_order + (flat.rows.length ? 1 : 0) })), ...matrixGroups];
  return { groups, rows: flat.rows, warnings };
}
