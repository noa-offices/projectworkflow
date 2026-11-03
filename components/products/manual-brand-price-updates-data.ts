import type { SupabaseClient } from "@supabase/supabase-js";
import { latestPassedManualRelease, type ManualBrandState } from "@/lib/products/manual-price-check";
import { buildManualProductRows, MANUAL_PRODUCT_LIMIT, type ManualProductInput, type ManualProductRow } from "@/lib/products/manual-brand-products";
import { supplierBusinessDate, supplierRows } from "@/lib/products/supplier-price-repository";

export type ManualBrandScreenData = {
  rows: ManualProductRow[]; truncated: boolean; today: string;
  releases: Array<{ id: string; effectiveFrom: string; note: string; createdByName?: string }>;
  latest: { effectiveFrom: string; note: string } | null;
};

/**
 * Everything the manual Brand screen needs in two reads: the Brand's products and its categories (the manual state is loaded by the
 * caller). No per-product queries. The first MANUAL_PRODUCT_LIMIT products by name are shown.
 */
export async function loadManualBrandScreenData(client: SupabaseClient, brandId: string, state: ManualBrandState): Promise<ManualBrandScreenData> {
  const [products, categories] = await Promise.all([
    supplierRows<ManualProductInput>(client, "product_templates", "id,brand_id,template_name,internal_selection_name,pricing_version,main_category_id,sub_category_id", { brand_id: brandId, is_active: true }, "template_name"),
    supplierRows<{ id: string; name: string }>(client, "product_categories", "id,name", { brand_id: brandId }, "name"),
  ]);
  const today = supplierBusinessDate();
  const shown = products.slice(0, MANUAL_PRODUCT_LIMIT);
  const latest = latestPassedManualRelease(state.releases, today);
  return {
    rows: buildManualProductRows(shown, new Map(categories.map((category) => [category.id, category.name])), new Map([[brandId, state]]), today),
    truncated: products.length > shown.length, today,
    releases: [...state.releases].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt)).map((release) => ({ id: release.id, effectiveFrom: release.effectiveFrom, note: release.note, ...(release.createdByName ? { createdByName: release.createdByName } : {}) })),
    latest: latest ? { effectiveFrom: latest.effectiveFrom, note: latest.note } : null,
  };
}
