"use server";

import { requireActiveUser } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { loadSupplierFamilyPriceStatusMap } from "@/lib/products/supplier-family-price-status-loader";
import { supplierFamilyStatusPresentation, type SupplierFamilyStatusPresentation } from "@/lib/products/supplier-family-status";
import { supplierRows } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";

/**
 * Read only. The Supplier status of ONE product as the status engine computes it now, in the same wording as the page uses, so the
 * open Product Library can update its badge without a page reload. Same rule as the page: a brand with no Supplier price list gets none.
 */
export async function supplierTemplateStatusPresentation(templateId: string): Promise<SupplierFamilyStatusPresentation | null> {
  if (typeof templateId !== "string" || !templateId) throw Error("Choose the product.");
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  const client = await createClient();
  const template = (await supplierRows<{ id: string; brand_id: string; pricing_version: number | string }>(client, "product_templates", "id,brand_id,pricing_version", { id: templateId, is_active: true })).at(0);
  if (!template) throw Error("This product is unavailable.");
  const status = (await loadSupplierFamilyPriceStatusMap(client, [template])).get(templateId);
  if (!status || (status.status === "legacy_manual" && !status.brandHasCurrentSource)) return null;
  return supplierFamilyStatusPresentation(status);
}
