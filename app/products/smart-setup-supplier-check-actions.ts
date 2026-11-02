"use server";

import { requireActiveUser, requireBrandPriceReviewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadApplicableVersion, runSmartSetupSupplierCheck, type SmartSetupSupplierCheckInput } from "@/lib/products/smart-setup-supplier-check";
import { loadSmartSetupFamilyState, type SmartSetupSupplierFamilyState } from "@/lib/products/smart-setup-supplier-families";
import { listSmartSetupSupplierSources } from "@/lib/products/smart-setup-supplier-sources";
import { canManageReviewDecisions } from "@/lib/products/supplier-review-decisions";

/** Read-only Smart Setup supplier price cross-check. Same authenticated reviewer gate as Supplier Pricing; performs no writes. */
export async function checkSmartSetupSupplierPrices(input: SmartSetupSupplierCheckInput) {
  return runSmartSetupSupplierCheck({ requireReviewer: requireBrandPriceReviewer, getClient: createClient }, input);
}

/** Eligible Supplier sources for the Smart Setup verification section. Returns "unauthorized" instead of redirecting, so Smart Setup keeps working for non-reviewers. */
export async function listSmartSetupSupplierSourcesAction(brandId: string) {
  const { profile } = await requireActiveUser();
  const list = await listSmartSetupSupplierSources({ getProfile: async () => profile, getClient: createClient }, brandId);
  return { ...list, canManageDecisions: canManageReviewDecisions(profile?.role, profile?.account_status) };
}

/** Read-only: the families of the selected price list and, for a saved product, the ones saved for it. Same reviewer gate and ownership checks as the price check. */
export async function loadSmartSetupSupplierFamilies(input: { brandId: string; definitionId: string; sourceVersionId: string; templateId?: string | null }): Promise<SmartSetupSupplierFamilyState> {
  await requireBrandPriceReviewer();
  if ([input?.brandId, input?.definitionId, input?.sourceVersionId].some((value) => typeof value !== "string" || !value.trim() || value.length > 100)) throw Error("Choose a Brand and a Supplier price list.");
  const client = await createClient();
  const version = await loadApplicableVersion(client, input.brandId, input.definitionId, input.sourceVersionId);
  return loadSmartSetupFamilyState(client, { definitionId: input.definitionId, versionId: version.id, templateId: typeof input.templateId === "string" && input.templateId.trim() ? input.templateId.trim() : null });
}
