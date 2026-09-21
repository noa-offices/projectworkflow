import type { ProductTemplateGroupReferenceType } from "./product-template-group-references";
import { draftModularRows, type ProductTemplateDraft } from "./product-template-draft";
import type { SmartReviewDestination, SmartReviewRoute, SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";
import type { BaseModelPricingSubgroup } from "./base-model-pricing-groups";
import { LEGACY_BASE_MODEL_GROUP_ID } from "./base-model-pricing-groups";
import { draftBaseModelGroupRows, draftUngroupedBaseModelRows } from "./base-model-draft-groups";
import { LEGACY_WORKSTATION_GROUP_ID } from "./workstation-pricing-groups";

export type StagedReviewedRowImage<TFile = File> = { file: TFile; previewUrl: string; sourceKey: string; sourceRowId: string };
export type PendingProductTemplateRowImage<TFile = File> = { file: TFile; previewUrl: string; pricingType: ProductTemplateGroupReferenceType; rowId: string };
export type SmartReviewedPricingSubgroup = BaseModelPricingSubgroup;
export type SmartReviewedPricingSubgroups = Record<string, SmartReviewedPricingSubgroup[]>;
export type PendingProductTemplateSubgroupImage<TFile = File> = { file: TFile; previewUrl: string; pricingType: ProductTemplateGroupReferenceType; groupId: string; subgroupId: string };
export type SmartAppliedPricingSubgroups = { sourceKey: string; sourceId: string; pricingType: ProductTemplateGroupReferenceType; groupId: string; subgroups: BaseModelPricingSubgroup[] };

export function reviewedRowImageKey(sourceKey: string, rowId: string) { return `${sourceKey}\u0000${rowId}`; }
export function pendingRowImageKey(pricingType: ProductTemplateGroupReferenceType, rowId: string) { return `${pricingType}\u0000${rowId}`; }
export function reviewedSubgroupImageKey(sourceKey: string, subgroupId: string) { return reviewedRowImageKey(`subgroup:${sourceKey}`, subgroupId); }
export function pendingSubgroupImageKey(pricingType: ProductTemplateGroupReferenceType, groupId: string, subgroupId: string) { return `${pricingType}\u0000${groupId}\u0000${subgroupId}`; }

export function updateStagedReviewedRowImage<TFile>(current: Readonly<Record<string, StagedReviewedRowImage<TFile>>>, sourceKey: string, rowId: string, image: StagedReviewedRowImage<TFile> | null, revokePreview: (previewUrl: string) => void) {
  const key = reviewedRowImageKey(sourceKey, rowId); const previous = current[key];
  if (previous && previous.previewUrl !== image?.previewUrl) revokePreview(previous.previewUrl);
  const next = { ...current }; if (image) next[key] = image; else delete next[key]; return next;
}

export function disposeStagedReviewedRowImages<TFile>(images: Readonly<Record<string, StagedReviewedRowImage<TFile>>>, revokePreview: (previewUrl: string) => void) { Object.values(images).forEach((image) => revokePreview(image.previewUrl)); }

function destinationPricingType(destination: SmartReviewDestination): ProductTemplateGroupReferenceType | null {
  if (destination === "category_matrix") return "finish_category";
  if (destination === "base_model" || destination === "workstation" || destination === "modular" || destination === "accessory") return destination;
  return null;
}

function routeRowIds(draft: ProductTemplateDraft, route: SmartReviewRoute) {
  if (route.sourceKind === "workstation") return draft.pricing.workstationRows.map((row) => row.id);
  if (route.sourceKind === "base_model") return draftUngroupedBaseModelRows(draft.pricing).map((row) => row.id);
  if (route.sourceKind === "base_model_group") return draftBaseModelGroupRows(draft.pricing, route.sourceId).map((row) => row.id);
  if (route.sourceKind === "matrix") return draft.pricing.priceMatrices.find((matrix) => matrix.id === route.sourceId)?.rows.map((row) => row.id) ?? [];
  if (route.sourceKind === "modular") return draft.pricing.modularGroups.filter((group) => group.id === route.sourceId).flatMap((group) => draftModularRows(group).map((row) => row.id));
  return draft.optionGroups.find((group) => group.id === route.sourceId)?.items.map((row) => row.id) ?? [];
}

export function pendingRowImagesForSmartSetupApply<TFile>(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, staged: Readonly<Record<string, StagedReviewedRowImage<TFile>>>) {
  return plan.routes.flatMap((route) => {
    const pricingType = destinationPricingType(route.destination);
    if (!pricingType) return [];
    return routeRowIds(draft, route).flatMap((rowId) => {
      const image = staged[reviewedRowImageKey(route.key, rowId)];
      return image ? [{ file: image.file, previewUrl: image.previewUrl, pricingType, rowId } satisfies PendingProductTemplateRowImage<TFile>] : [];
    });
  });
}

function destinationGroupId(route: SmartReviewRoute) {
  if (route.key === "base_model:rows") return LEGACY_BASE_MODEL_GROUP_ID;
  if (route.key === "workstation:rows") return LEGACY_WORKSTATION_GROUP_ID;
  return route.sourceId;
}

export function canonicalSubgroupsForSmartSetupApply(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, reviewed: SmartReviewedPricingSubgroups): SmartAppliedPricingSubgroups[] {
  return plan.routes.flatMap((route) => {
    const pricingType = destinationPricingType(route.destination);
    if (!pricingType) return [];
    // system_base rows are never Main Product subgroup members; drop them here without reassigning.
    const isBaseModelRoute = route.sourceKind === "base_model" || route.sourceKind === "base_model_group";
    const systemRowIds = new Set(isBaseModelRoute ? draft.pricing.baseModelRows.flatMap((row) => row.role === "system_base" ? [row.id] : []) : []);
    const availableRows = new Set(routeRowIds(draft, route).filter((rowId) => !systemRowIds.has(rowId)));
    const assigned = new Set<string>();
    const subgroups = (reviewed[route.key] ?? []).map((subgroup) => ({
      ...subgroup,
      row_ids: subgroup.row_ids.filter((rowId) => {
        if (!availableRows.has(rowId) || assigned.has(rowId)) return false;
        assigned.add(rowId);
        return true;
      }),
    }));
    return subgroups.length ? [{ sourceKey: route.key, sourceId: route.sourceId, pricingType, groupId: destinationGroupId(route), subgroups }] : [];
  });
}

export function baseModelSubgroupsForSmartSetupApply(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, reviewed: SmartReviewedPricingSubgroups) {
  return canonicalSubgroupsForSmartSetupApply(draft, plan, reviewed).filter((entry) => entry.pricingType === "base_model");
}

export function pendingSubgroupImagesForSmartSetupApply<TFile>(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, reviewed: SmartReviewedPricingSubgroups, staged: Readonly<Record<string, StagedReviewedRowImage<TFile>>>) {
  return canonicalSubgroupsForSmartSetupApply(draft, plan, reviewed).flatMap(({ sourceKey, pricingType, groupId, subgroups }) => subgroups.flatMap((subgroup) => {
    const image = staged[reviewedSubgroupImageKey(sourceKey, subgroup.id)];
    return image ? [{ file: image.file, previewUrl: image.previewUrl, pricingType, groupId, subgroupId: subgroup.id }] : [];
  }));
}

export async function uploadPendingRowImagesAfterSave<TEntry, TIdentity>({ entries, resolveIdentity, templateSaved, upload }: { entries: readonly TEntry[]; resolveIdentity: (entry: TEntry) => TIdentity | null; templateSaved: boolean; upload: (entry: TEntry, identity: TIdentity) => Promise<void> }) {
  if (!templateSaved) return { attempted: 0, failed: 0 };
  let attempted = 0; let failed = 0;
  for (const entry of entries) {
    const identity = resolveIdentity(entry);
    if (!identity) continue;
    attempted += 1;
    try { await upload(entry, identity); } catch { failed += 1; }
  }
  return { attempted, failed };
}
