"use server";

import { requireActiveUser, requireBrandPriceReviewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runSmartSetupSupplierCheck, type SmartSetupSupplierCheckInput } from "@/lib/products/smart-setup-supplier-check";
import { listSmartSetupSupplierSources } from "@/lib/products/smart-setup-supplier-sources";

/** Read-only Smart Setup supplier price cross-check. Same authenticated reviewer gate as Supplier Pricing; performs no writes. */
export async function checkSmartSetupSupplierPrices(input: SmartSetupSupplierCheckInput) {
  return runSmartSetupSupplierCheck({ requireReviewer: requireBrandPriceReviewer, getClient: createClient }, input);
}

/** Eligible Supplier sources for the Smart Setup verification section. Returns "unauthorized" instead of redirecting, so Smart Setup keeps working for non-reviewers. */
export async function listSmartSetupSupplierSourcesAction(brandId: string) {
  return listSmartSetupSupplierSources({ getProfile: async () => (await requireActiveUser()).profile, getClient: createClient }, brandId);
}
