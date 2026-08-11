import type { ProductTemplateGroupReferenceType } from "./product-template-group-references";
import type { ProductTemplateDraft } from "./product-template-draft";
import type { SmartReviewDestination, SmartReviewRoute, SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";
import type { BaseModelPricingSubgroup } from "./base-model-pricing-groups";

export type StagedReviewedRowImage<TFile = File> = { file: TFile; previewUrl: string; sourceKey: string; sourceRowId: string };
export type PendingProductTemplateRowImage<TFile = File> = { file: TFile; previewUrl: string; pricingType: ProductTemplateGroupReferenceType; rowId: string };
export type SmartReviewedPricingSubgroup = BaseModelPricingSubgroup;
export type SmartReviewedPricingSubgroups = Record<string, SmartReviewedPricingSubgroup[]>;
export type PendingProductTemplateSubgroupImage<TFile = File> = { file: TFile; previewUrl: string; pricingType: "base_model"; subgroupId: string };

export function reviewedRowImageKey(sourceKey: string, rowId: string) { return `${sourceKey}\u0000${rowId}`; }
export function pendingRowImageKey(pricingType: ProductTemplateGroupReferenceType, rowId: string) { return `${pricingType}\u0000${rowId}`; }
export function reviewedSubgroupImageKey(sourceKey: string, subgroupId: string) { return reviewedRowImageKey(`subgroup:${sourceKey}`, subgroupId); }
export function pendingSubgroupImageKey(pricingType: ProductTemplateGroupReferenceType, subgroupId: string) { return `${pricingType}\u0000${subgroupId}`; }

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
  if (route.sourceKind === "base_model") return draft.pricing.baseModelRows.map((row) => row.id);
  if (route.sourceKind === "matrix") return draft.pricing.priceMatrices.find((matrix) => matrix.id === route.sourceId)?.rows.map((row) => row.id) ?? [];
  if (route.sourceKind === "modular") return draft.pricing.modularGroups.find((group) => group.id === route.sourceId)?.matrix.rows.map((row) => row.id) ?? [];
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

export function baseModelSubgroupsForSmartSetupApply(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, reviewed: SmartReviewedPricingSubgroups) {
  return plan.routes.flatMap((route) => {
    if (route.destination !== "base_model") return [];
    const availableRows = new Set(routeRowIds(draft, route));
    const assigned = new Set<string>();
    const subgroups = (reviewed[route.key] ?? []).map((subgroup) => ({
      ...subgroup,
      row_ids: subgroup.row_ids.filter((rowId) => {
        if (!availableRows.has(rowId) || assigned.has(rowId)) return false;
        assigned.add(rowId);
        return true;
      }),
    }));
    return subgroups.length ? [{ sourceKey: route.key, sourceId: route.sourceId, subgroups }] : [];
  });
}

export function pendingSubgroupImagesForSmartSetupApply<TFile>(draft: ProductTemplateDraft, plan: SmartSetupReviewRoutingPlan, reviewed: SmartReviewedPricingSubgroups, staged: Readonly<Record<string, StagedReviewedRowImage<TFile>>>) {
  return baseModelSubgroupsForSmartSetupApply(draft, plan, reviewed).flatMap(({ sourceKey, subgroups }) => subgroups.flatMap((subgroup) => {
    const image = staged[reviewedSubgroupImageKey(sourceKey, subgroup.id)];
    return image ? [{ file: image.file, previewUrl: image.previewUrl, pricingType: "base_model" as const, subgroupId: subgroup.id }] : [];
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
