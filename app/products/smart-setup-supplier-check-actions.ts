"use server";

import { requireBrandPriceReviewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runSmartSetupSupplierCheck, type SmartSetupSupplierCheckInput } from "@/lib/products/smart-setup-supplier-check";

/** Read-only Smart Setup supplier price cross-check. Same authenticated reviewer gate as Supplier Pricing; performs no writes. */
export async function checkSmartSetupSupplierPrices(input: SmartSetupSupplierCheckInput) {
  return runSmartSetupSupplierCheck({ requireReviewer: requireBrandPriceReviewer, getClient: createClient }, input);
}
