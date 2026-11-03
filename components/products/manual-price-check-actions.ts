"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { addManualPriceRelease, latestPassedManualRelease, loadManualPriceState, markManualPriceChecked, setBrandPriceCheckMode, type PriceCheckMode } from "@/lib/products/manual-price-check";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { supplierBusinessDate, supplierRows } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";

// Manual price check Brands. Authorization is checked here and again by the database functions; the browser only sends ids and text.
async function approver() {
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  return createClient();
}
const refresh = () => { revalidatePath("/products/price-updates"); revalidatePath("/products/templates"); };
const idText = (value: unknown, what: string) => { if (typeof value !== "string" || !value.trim() || value.length > 100) throw Error(`${what} is required.`); return value.trim(); };

export async function setPriceCheckModeAction(brandId: string, mode: PriceCheckMode): Promise<void> {
  if (mode !== "manual" && mode !== "supplier_codes") throw Error("Choose a price check mode.");
  const client = await approver();
  await setBrandPriceCheckMode(client, idText(brandId, "Brand"), mode);
  refresh();
}

export async function releaseManualPriceListAction(brandId: string, effectiveFrom: string, note: string): Promise<void> {
  if (typeof effectiveFrom !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(`${effectiveFrom}T00:00:00Z`))) throw Error("Choose the date the new price list starts.");
  if (typeof note !== "string" || note.trim().length > 200) throw Error("The note is too long (200 characters at most).");
  const client = await approver();
  await addManualPriceRelease(client, { brandId: idText(brandId, "Brand"), effectiveFrom, note: note.trim() });
  refresh();
}

/** Marks ONE product as checked for the Brand's latest released price list. The server picks the release; the browser sends only the product. */
export async function markManualPriceCheckedAction(templateId: string, expectedPricingVersion?: string): Promise<{ message: string }> {
  const id = idText(templateId, "Product");
  const client = await approver();
  const template = (await supplierRows<{ id: string; brand_id: string; pricing_version: number | string }>(client, "product_templates", "id,brand_id,pricing_version", { id, is_active: true })).at(0);
  if (!template) throw Error("This product is unavailable.");
  const release = latestPassedManualRelease((await loadManualPriceState(client, [template.brand_id])).get(template.brand_id)?.releases ?? [], supplierBusinessDate());
  if (!release) throw Error("No price list has been released for this Brand yet.");
  // The window passes the version it just saved, so a product edited in between is refused instead of being marked as checked.
  if (expectedPricingVersion !== undefined && String(template.pricing_version) !== expectedPricingVersion) throw Error("This Product Template changed. Reload before saving.");
  await markManualPriceChecked(client, { templateId: id, releaseId: release.id, expectedPricingVersion: String(template.pricing_version) });
  refresh();
  return { message: "The product is marked as price checked." };
}
