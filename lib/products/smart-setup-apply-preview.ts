import type { ProductTemplateDraft } from "./product-template-draft";
import { mapDraftWorkstationPricing } from "./product-template-draft-workstation-adapter";
import { mapDraftBaseModelPricing } from "./product-template-draft-base-model-adapter";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter";
import { mapDraftModularPricing } from "./product-template-draft-modular-adapter";
import { mapDraftOptionGroupsToAccessories } from "./product-template-draft-accessory-adapter";
import { PricingColumnIdentityError } from "./pricing-category-columns";
import { draftForSmartSetupReviewApply, smartReviewMatrixOverrides, type SmartSetupReviewRoutingPlan } from "./smart-product-review-routing";

type WorkstationSubgroups = Parameters<typeof mapDraftWorkstationPricing>[1];
export type SmartSetupApplySubgroups = Array<{ pricingType: string; subgroups?: WorkstationSubgroups }>;

/** The one mapping Apply runs. It only reads its inputs and may throw; nothing is changed until it has fully succeeded. */
export function mapSmartDraftForApply(draft: ProductTemplateDraft, routingPlan?: SmartSetupReviewRoutingPlan, subgroupAssignments: SmartSetupApplySubgroups = []) {
  const applyDraft = routingPlan ? draftForSmartSetupReviewApply(draft, routingPlan) : draft;
  const matrixRouting = routingPlan ? smartReviewMatrixOverrides(routingPlan) : undefined;
  return {
    applyDraft,
    matrixRouting,
    workstation: mapDraftWorkstationPricing(applyDraft, subgroupAssignments.find((entry) => entry.pricingType === "workstation")?.subgroups),
    baseModel: mapDraftBaseModelPricing(applyDraft, matrixRouting),
    categoryResult: mapDraftPriceMatricesToCategoryGroups(applyDraft, matrixRouting),
    modularResult: mapDraftModularPricing(applyDraft),
    accessoryResult: mapDraftOptionGroupsToAccessories(applyDraft, routingPlan),
  };
}

export type SmartSetupApplyProblem = { message: string; details: string };

/** Plain-English message plus the technical text for a small "Details" part. */
export function describeSmartSetupApplyError(error: unknown): SmartSetupApplyProblem {
  const details = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error.";
  const looksReadable = /^[^\n]*"[^"]+"/.test(details) && !/\bat\s.+:\d+/.test(details);
  return { message: looksReadable ? details : "Something went wrong while applying the imported data. Nothing was changed.", details };
}

/** Dry run of Apply. Returns null when the mapping works, otherwise the reason Apply would fail. */
export function previewSmartSetupApply(draft: ProductTemplateDraft, routingPlan?: SmartSetupReviewRoutingPlan, subgroupAssignments: SmartSetupApplySubgroups = []): SmartSetupApplyProblem | null {
  try { mapSmartDraftForApply(draft, routingPlan, subgroupAssignments); return null; }
  catch (error) { return describeSmartSetupApplyError(error); }
}

/** Runs an Apply handler body. Any error becomes a message for the screen instead of an uncaught crash. */
export function runGuardedSmartSetupApply<T>(action: () => T): { ok: true; value: T } | { ok: false; problem: SmartSetupApplyProblem } {
  try { return { ok: true, value: action() }; }
  catch (error) { return { ok: false, problem: describeSmartSetupApplyError(error) }; }
}
