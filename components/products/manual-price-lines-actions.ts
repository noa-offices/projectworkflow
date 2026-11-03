"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth";
import { canApproveBrandPrices } from "@/lib/products/brand-price-permissions";
import { latestPassedManualRelease, loadManualPriceState, resolveManualFamilyStatus } from "@/lib/products/manual-price-check";
import { STALE_TEMPLATE_MESSAGE, validateChangesForSave, type ManualPriceLine } from "@/lib/products/manual-price-lines";
import { pricingConflictMessage } from "@/lib/products/pricing-write-version";
import { supplierBrandTargets, supplierBusinessDate, supplierRows, supplierTargetWrite } from "@/lib/products/supplier-price-repository";
import { createClient } from "@/lib/supabase/server";

export type ManualPriceLinesResult = {
  templateName: string; brandName: string; currency: string; pricingVersion: string; canEdit: boolean;
  release: { effectiveFrom: string; note: string } | null;
  lines: ManualPriceLine[];
  /** Set only when the product is checked for the latest release at its current version. */
  checked: { checkedAt: string; checkedByName: string | null } | null;
};

const idText = (value: unknown) => { if (typeof value !== "string" || !value.trim() || value.length > 100) throw Error("Product is required."); return value.trim(); };

async function readLines(client: Awaited<ReturnType<typeof createClient>>, templateId: string) {
  const template = (await supplierRows<{ id: string; brand_id: string }>(client, "product_templates", "id,brand_id", { id: templateId, is_active: true })).at(0);
  if (!template) throw Error("This product is unavailable.");
  const { targets, templates } = await supplierBrandTargets(client, template.brand_id, [templateId]);
  const own = targets.filter((target) => target.template_id === templateId);
  const full = templates.find((item) => item.id === templateId);
  if (!full) throw Error("This product is unavailable.");
  return { brandId: template.brand_id, targets: own, templates, name: String(full.template_name ?? ""), version: String(full.pricing_version), currency: String(full.currency ?? "") };
}

/** Read only. Anyone who can open the product can see the lines; editing is decided by the server again on save. */
export async function loadManualPriceLinesAction(templateId: string): Promise<ManualPriceLinesResult> {
  const id = idText(templateId);
  const { profile } = await requireActiveUser();
  const client = await createClient();
  const data = await readLines(client, id);
  const brand = (await supplierRows<{ id: string; name: string }>(client, "brands", "id,name", { id: data.brandId })).at(0);
  const state = (await loadManualPriceState(client, [data.brandId])).get(data.brandId);
  const release = state ? latestPassedManualRelease(state.releases, supplierBusinessDate()) : null;
  const status = resolveManualFamilyStatus({ state, templateId: id, pricingVersion: data.version, businessDate: supplierBusinessDate() });
  return {
    templateName: data.name, brandName: brand?.name ?? "", currency: data.currency, pricingVersion: data.version,
    canEdit: canApproveBrandPrices(profile?.role, profile?.account_status),
    release: release ? { effectiveFrom: release.effectiveFrom, note: release.note } : null,
    lines: data.targets.map((target) => ({ key: target.key, code: target.raw_code || target.code, label: [target.label, target.dimension_label ?? target.dimension].filter(Boolean).join(" · "), price: target.price, currency: target.currency })),
    checked: status.status === "price_checked" ? { checkedAt: status.checkedAt, checkedByName: status.checkedByName ?? null } : null,
  };
}

/**
 * Saves the changed prices of ONE product in one batch. It uses the existing all-or-nothing price writer with the pricing version
 * the window loaded; if the product changed since, nothing is written. Returns the fresh version for "Mark prices as checked".
 */
export async function saveManualPriceLinesAction(templateId: string, expectedVersion: string, rawChanges: unknown): Promise<{ pricingVersion: string; savedCount: number }> {
  const id = idText(templateId);
  const { profile } = await requireActiveUser();
  if (!canApproveBrandPrices(profile?.role, profile?.account_status)) throw Error("Brand price approver permission required.");
  const client = await createClient();
  const data = await readLines(client, id);
  const lines: ManualPriceLine[] = data.targets.map((target) => ({ key: target.key, code: target.raw_code || target.code, label: target.label, price: target.price, currency: target.currency }));
  const changes = validateChangesForSave(lines, rawChanges, String(expectedVersion), data.version);
  if (!changes.length) return { pricingVersion: data.version, savedCount: 0 };
  const state = (await loadManualPriceState(client, [data.brandId])).get(data.brandId);
  const release = state ? latestPassedManualRelease(state.releases, supplierBusinessDate()) : null;
  const history = { brand_price_list_update_id: null, effective_from: release?.effectiveFrom ?? null, note: "Manual price check: prices typed from the supplier's price list" };
  // Same-product detail targets build on a working copy so each later payload keeps the earlier changes (as in the supplier apply).
  const working = new Map(data.templates.map((template) => [template.id, structuredClone(template)]));
  const operations = changes.map((change) => {
    const current = data.targets.find((target) => target.key === change.key)!;
    const write = supplierTargetWrite(current, working, change.newPrice, current.currency, history);
    if (write.mode === "detail" && current.architecture !== "product_components") working.get(current.template_id)![current.architecture] = write.payload[current.architecture];
    return { template_id: current.template_id, expected_version: current.pricing_version, mode: write.mode, payload: write.payload, history: write.history };
  });
  const { error } = await client.rpc("apply_supplier_shared_price_at_versions", { p_operations: operations });
  if (error) throw Error(error.message.includes(pricingConflictMessage) ? STALE_TEMPLATE_MESSAGE : "Prices could not be saved. Nothing was changed.");
  const fresh = (await supplierRows<{ id: string; pricing_version: number | string }>(client, "product_templates", "id,pricing_version", { id, is_active: true })).at(0);
  if (!fresh) throw Error("Prices were saved, but the product could not be read again. Reload the page.");
  revalidatePath("/products/templates"); revalidatePath("/products/price-updates");
  return { pricingVersion: String(fresh.pricing_version), savedCount: operations.length };
}
