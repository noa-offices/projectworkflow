"use server";

import { requireActiveUser } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { supplierSourceDefinitionsForBrand } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";

/** Read-only. The write itself is assignFamilyToSupplierSource, which enforces the same role again on the server. */
export async function supplierCoveragePopupAccess(): Promise<boolean> {
  const { profile } = await requireActiveUser();
  return canApproveBrandPrices(profile?.role, profile?.account_status);
}

export async function supplierCoverageDefinitions(brandId: string) {
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  return supplierSourceDefinitionsForBrand(await createClient(), brandId);
}
