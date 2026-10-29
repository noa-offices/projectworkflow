import { draftBaseModelGroupLabel, draftBaseModelGroupRows, draftBaseModelGroupIds } from "./base-model-draft-groups";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import type { ProductTemplateDraft, ProductTemplateDraftBaseModelRow, ProductTemplateDraftOptionGroup } from "./product-template-draft";
import type { SmartReviewDestination, SmartReviewRoute } from "./smart-product-review-routing";

/**
 * Narrow, data-shape-driven Smart Setup destination conversions:
 *   option group      -> Base / Model group
 *   Base / Model group -> Accessory option group
 * Eligibility depends only on the actual fields of the source group (roles, prices, selection rules,
 * review status, relationship dependencies) - never on names, brands or supplier codes. Anything that
 * would lose data is rejected with a reason instead of being flattened.
 */
export type SmartRouteConversionCheck = { ok: true } | { ok: false; reason: string };
const blocked = (reason: string): SmartRouteConversionCheck => ({ ok: false, reason });
const OK: SmartRouteConversionCheck = { ok: true };

/** The only conversion a route may offer beyond its supportedDestinations, or null. */
export function smartRouteConversionDestination(route: Pick<SmartReviewRoute, "sourceKind">): SmartReviewDestination | null {
  return route.sourceKind === "option" ? "base_model" : route.sourceKind === "base_model_group" ? "accessory" : null;
}

type Target = { kind?: string; group_id?: string };
function dependentTargets(draft: ProductTemplateDraft): Target[] {
  return draft.optionGroups.flatMap((group) => [
    ...(group.conditionalConfiguration?.applicability ?? []).flatMap((rule) => rule.target ? [rule.target as Target] : [{ kind: "base_model", group_id: rule.base_model_group_id }]),
    ...group.items.flatMap((item) => (item.compatibleTargets ?? []) as Target[]),
  ]);
}

/** Changes whenever anything the reviewer saw (items, prices, codes, review state, selection) changes. */
export function optionGroupConversionFingerprint(group: ProductTemplateDraftOptionGroup) {
  return JSON.stringify({ selection: group.selection, items: group.items });
}

export function optionGroupToBaseModelCheck(draft: ProductTemplateDraft, groupId: string, expectedFingerprint?: string | null): SmartRouteConversionCheck {
  const group = draft.optionGroups.find((item) => item.id === groupId);
  const name = group?.label ?? groupId;
  if (!group) return blocked(`${name}: the source option group no longer exists.`);
  if (!group.items.length) return blocked(`${name} has no items to convert.`);
  if (group.conditionalConfiguration) return blocked(`${name} has conditional / companion configuration, which Base / Model Pricing cannot represent.`);
  if (group.priceCategories?.length) return blocked(`${name} has price categories, which Base / Model Pricing cannot represent.`);
  if (group.selection.defaultItemIds.length) return blocked(`${name} has default selections, which Base / Model Pricing cannot represent.`);
  if (group.items.some((item) => item.role && item.role !== "normal")) return blocked(`${name} has companion or structural-support items, which Base / Model Pricing cannot represent.`);
  if (group.items.some((item) => Object.keys(item.prices ?? {}).length || item.unavailablePriceCategoryIds?.length)) return blocked(`${name} has per-category prices, which Base / Model Pricing cannot represent.`);
  if (group.items.some((item) => item.compatibleTargets?.length)) return blocked(`${name} has compatible-target metadata, which Base / Model Pricing cannot represent.`);
  if (group.items.some((item) => item.reviewStatus === "needs_review")) return blocked(`${name} has items marked Needs Review. Confirm each item first; confirmation is your acknowledgement, not manufacturer verification.`);
  if (groupId === LEGACY_BASE_MODEL_GROUP_ID || draftBaseModelGroupIds(draft.pricing).includes(groupId)) return blocked(`${name} uses the same group id as an existing Base / Model group.`);
  const rowIds = new Set(draft.pricing.baseModelRows.map((row) => row.id));
  if (group.items.some((item) => rowIds.has(item.id))) return blocked(`${name} has an item id that already exists in Base / Model Pricing.`);
  if (dependentTargets(draft).some((target) => target.kind === "option_item" && target.group_id === groupId)) return blocked(`${name} is referenced by other groups' companion rules.`);
  if (expectedFingerprint !== undefined && expectedFingerprint !== optionGroupConversionFingerprint(group)) return blocked(`${name} changed after the destination was selected. Re-select Base / Model Pricing to review again.`);
  return OK;
}

export function baseModelGroupToOptionGroupCheck(draft: ProductTemplateDraft, groupId: string): SmartRouteConversionCheck {
  const name = draftBaseModelGroupLabel(draft.pricing, groupId);
  const rows = draftBaseModelGroupRows(draft.pricing, groupId);
  if (!rows.length) return blocked(`${name} has no models to convert.`);
  if (rows.some((row) => row.role)) return blocked(`${name} has System / Base rows, which Accessory Pricing cannot represent.`);
  if (draft.optionGroups.some((group) => group.id === groupId)) return blocked(`${name} uses the same group id as an existing Accessory group.`);
  const itemIds = new Set(draft.optionGroups.flatMap((group) => group.items.map((item) => item.id)));
  if (rows.some((row) => itemIds.has(row.id))) return blocked(`${name} has a model id that already exists in an Accessory group.`);
  if (dependentTargets(draft).some((target) => target.kind?.startsWith("base_model") && target.group_id === groupId)) return blocked(`${name} is referenced by other groups' companion or compatibility rules.`);
  return OK;
}

/** Eligibility of a route's one extra destination against the current draft; routes without one are not convertible. */
export function smartRouteConversionCheck(draft: ProductTemplateDraft, route: Pick<SmartReviewRoute, "sourceKind" | "sourceId">, destination: SmartReviewDestination, expectedFingerprint?: string | null): SmartRouteConversionCheck {
  if (smartRouteConversionDestination(route) !== destination) return blocked("This destination is not supported for this group.");
  return route.sourceKind === "option" ? optionGroupToBaseModelCheck(draft, route.sourceId, expectedFingerprint) : baseModelGroupToOptionGroupCheck(draft, route.sourceId);
}

/** Shared priced fields move untouched; only option-only review metadata is removed (it never reaches saved templates). */
export function optionGroupToBaseModelRows(group: ProductTemplateDraftOptionGroup, groupLabel: string): ProductTemplateDraftBaseModelRow[] {
  return group.items.map((item) => {
    const { role: _role, prices: _prices, unavailablePriceCategoryIds: _unavailable, compatibleTargets: _targets, reviewStatus: _status, reviewReason: _reason, ...shared } = item;
    return { ...shared, groupId: group.id, groupLabel, ...(group.isActive === false ? { groupIsActive: false } : {}) };
  });
}

export function baseModelGroupToOptionGroup(draft: ProductTemplateDraft, groupId: string, label: string): ProductTemplateDraftOptionGroup {
  const rows = draftBaseModelGroupRows(draft.pricing, groupId);
  return {
    id: groupId,
    label,
    ...(rows.every((row) => row.groupIsActive === false) ? { isActive: false } : {}),
    selection: { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] },
    items: rows.map((row) => { const { groupId: _groupId, groupLabel: _groupLabel, groupIsActive: _groupIsActive, role: _role, ...shared } = row; return shared; }),
  };
}
