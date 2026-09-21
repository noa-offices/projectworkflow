import type { ProductTemplateDraft, ProductTemplateDraftBaseModelRole, ProductTemplateDraftBaseModelRow } from "./product-template-draft";

/** Smart Setup route key for a native Base/Model group. Flat ungrouped rows keep "base_model:rows". */
export const baseModelGroupRouteKey = (groupId: string) => `base_model_group:${groupId}`;

type DraftBaseModelRows = Pick<ProductTemplateDraft["pricing"], "baseModelRows">;

/** Distinct native group ids in first-appearance order. */
export function draftBaseModelGroupIds(pricing: DraftBaseModelRows) {
  return [...new Set(pricing.baseModelRows.flatMap((row) => row.groupId ? [row.groupId] : []))];
}

/** Rows that belong to exactly this native group (never falls back to all rows). */
export function draftBaseModelGroupRows(pricing: DraftBaseModelRows, groupId: string): ProductTemplateDraftBaseModelRow[] {
  return pricing.baseModelRows.filter((row) => row.groupId === groupId);
}

/** Rows without a groupId; these stay in the legacy flat Base/Model group. */
export function draftUngroupedBaseModelRows(pricing: DraftBaseModelRows): ProductTemplateDraftBaseModelRow[] {
  return pricing.baseModelRows.filter((row) => !row.groupId);
}

/**
 * Replaces ONE scope's rows (a native group, or the ungrouped flat rows when groupId is null) inside the
 * full baseModelRows list, leaving every other group's rows and their order untouched. Replacement rows
 * are retagged to the scope so a newly added row can never leak into another group.
 */
export function replaceDraftBaseModelScopeRows(all: ProductTemplateDraftBaseModelRow[], groupId: string | null, next: ProductTemplateDraftBaseModelRow[]) {
  const inScope = (row: ProductTemplateDraftBaseModelRow) => groupId ? row.groupId === groupId : !row.groupId;
  const label = groupId ? all.find((row) => row.groupId === groupId && row.groupLabel)?.groupLabel : undefined;
  const retagged = next.map((row) => {
    const item: ProductTemplateDraftBaseModelRow = { ...row };
    delete item.groupId;
    delete item.groupLabel;
    if (groupId) { item.groupId = groupId; if (label) item.groupLabel = label; }
    return item;
  });
  const at = all.findIndex(inScope);
  const outside = all.filter((row) => !inScope(row));
  return at === -1 ? [...outside, ...retagged] : [...all.slice(0, at), ...retagged, ...outside.slice(at)];
}

/** Role toggle changes ONLY role: Main Product omits it, System / Base sets "system_base". */
export function withDraftBaseModelRole(row: ProductTemplateDraftBaseModelRow, role: ProductTemplateDraftBaseModelRole | null): ProductTemplateDraftBaseModelRow {
  const next: ProductTemplateDraftBaseModelRow = { ...row };
  if (role) next.role = role; else delete next.role;
  return next;
}

/** First non-empty label wins; falls back to the group id. */
export function draftBaseModelGroupLabel(pricing: DraftBaseModelRows, groupId: string) {
  return draftBaseModelGroupRows(pricing, groupId).find((row) => row.groupLabel)?.groupLabel ?? groupId;
}

/** System / Base rows (role "system_base") and Main Product rows (everything else) of one native group. */
export function splitNativeGroupRows<TRow extends { role?: string }>(rows: readonly TRow[]) {
  return { systemRows: rows.filter((row) => row.role === "system_base"), mainRows: rows.filter((row) => row.role !== "system_base") };
}

type ReviewSubgroupLike = { id: string; is_active?: boolean; row_ids: string[] };

/** Counts for the native System group header: system rows are never counted as Main models. */
export function nativeSystemGroupSummary(rows: readonly { id: string; role?: string }[], subgroups: readonly ReviewSubgroupLike[]) {
  const { systemRows, mainRows } = splitNativeGroupRows(rows);
  const mainIds = new Set(mainRows.map((row) => row.id));
  const familyCount = subgroups.filter((subgroup) => subgroup.is_active !== false && subgroup.row_ids.some((id) => mainIds.has(id))).length;
  return { systemCount: systemRows.length, mainCount: mainRows.length, familyCount };
}

/** A row that becomes System / Base can never stay in a Main Product family: drop it from every subgroup, touching nothing else. */
export function removeRowFromReviewSubgroups<TSubgroup extends { row_ids: string[] }>(subgroups: readonly TSubgroup[], rowId: string): TSubgroup[] {
  return subgroups.map((subgroup) => ({ ...subgroup, row_ids: subgroup.row_ids.filter((id) => id !== rowId) }));
}
