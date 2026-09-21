import type { ProductTemplateDraft } from "./product-template-draft";
import { LEGACY_WORKSTATION_GROUP_ID, LEGACY_WORKSTATION_GROUP_NAME, WORKSTATION_GROUP_PRICING_TYPE } from "./workstation-pricing-groups";

export function mapDraftWorkstationRows(draft: ProductTemplateDraft) {
  const warnings: string[] = [];
  const rows = draft.pricing.workstationRows.map((row, index) => {
    const codes = [...row.supplierCodes, ...row.referenceCodes];
    if (codes.length > 1) warnings.push(`Workstation row '${row.label ?? row.id}' contains additional supplier codes that were not mapped automatically. Review manually.`);
    const dimension = row.dimensions;
    const text = dimension?.rawText ?? [dimension?.width, dimension?.depth, dimension?.height].filter((value) => value !== null && value !== undefined).join(" × ") + (dimension?.unit ? ` ${dimension.unit}` : "");
    return { id: row.id, label: row.label ?? row.displayName ?? row.id, supplier_price_list_code: codes[0] ?? "", base_supplier_price_list_code: codes[0] ?? "", length: dimension?.width ?? 0, depth: dimension?.depth ?? 0, height: dimension?.height ?? 0, dimension_unit: dimension?.unit ?? "cm", default_dimension: text, default_price: row.price, additional_price: row.additionalPrice, currency: row.currency ?? undefined, specification: row.specification ?? "", ...(row.importantRequirements?.length ? { importantRequirements: row.importantRequirements } : {}), is_active: row.isActive !== false, sort_order: index };
  });
  return { rows, warnings };
}

type ReviewSubgroup = { id: string; subgroup_name: string; sort_order: number; is_active: boolean; row_ids: string[] };

/**
 * Saved-template round trip: when reopened rows carry a workstation groupId, the saved groups are rebuilt as
 * separate groups (never merged). Ungrouped rows use the legacy group. Returns undefined pricing for the usual
 * flat case so the existing flat replacement path is unchanged. Subgroups are distributed to the group that
 * owns their rows.
 */
export function mapDraftWorkstationPricing(draft: ProductTemplateDraft, subgroups?: ReviewSubgroup[]) {
  const flat = mapDraftWorkstationRows(draft);
  const source = draft.pricing.workstationRows;
  if (!source.some((row) => row.groupId)) return { ...flat, pricing: undefined as undefined | Array<Record<string, unknown>> };
  const order: Array<string | null> = [];
  source.forEach((row) => { const key = row.groupId ?? null; if (!order.includes(key)) order.push(key); });
  const pricing = order.map((groupKey, groupIndex) => {
    const indexes = source.flatMap((row, index) => (row.groupId ?? null) === groupKey ? [index] : []);
    const rowIds = new Set(indexes.map((index) => flat.rows[index].id));
    const ownSubgroups = (subgroups ?? []).flatMap((subgroup) => { const ids = subgroup.row_ids.filter((id) => rowIds.has(id)); return ids.length ? [{ ...subgroup, row_ids: ids }] : []; });
    return {
      id: groupKey ?? LEGACY_WORKSTATION_GROUP_ID,
      pricing_type: WORKSTATION_GROUP_PRICING_TYPE,
      group_name: groupKey ? source[indexes[0]].groupLabel ?? groupKey : LEGACY_WORKSTATION_GROUP_NAME,
      is_active: true,
      sort_order: groupIndex,
      items: indexes.map((index, itemIndex) => ({ ...flat.rows[index], sort_order: itemIndex })),
      ...(ownSubgroups.length ? { subgroups: ownSubgroups } : {}),
    };
  });
  return { ...flat, pricing };
}
