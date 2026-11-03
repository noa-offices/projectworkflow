import type { ManualPriceState } from "./manual-price-check";
import { resolveSupplierFamilyPriceStatus, supplierFamilyStatusLabels, supplierFamilyStatusPresentation, type SupplierFamilyPriceStatusKey, type SupplierFamilyStatusPresentation } from "./supplier-family-status";

// The product list of a manual price check Brand (Price Updates page). The status always comes from the shared resolver; nothing here decides status.
export type ManualProductInput = { id: string; brand_id: string; template_name: string; internal_selection_name?: string | null; pricing_version: number | string | null; main_category_id?: string | null; sub_category_id?: string | null };
export type ManualStatusKey = Extract<SupplierFamilyPriceStatusKey, "price_update_due" | "price_checked" | "edited_since_check" | "legacy_manual">;
export type ManualProductRow = { id: string; name: string; category: string; mainCategory: string; status: ManualStatusKey; label: string; tone: SupplierFamilyStatusPresentation["tone"]; detail: string };
export type ManualStatusFilter = "all" | "due" | "checked" | "edited";
export const MANUAL_PRODUCT_LIMIT = 1000;

const manualKeys: ManualStatusKey[] = ["price_update_due", "price_checked", "edited_since_check", "legacy_manual"];
const isManualKey = (key: string): key is ManualStatusKey => (manualKeys as string[]).includes(key);

/** Row for one product from a resolved status. Used for the first load and when the window reports a fresh badge. */
export function manualRowFromPresentation(base: Pick<ManualProductRow, "id" | "name" | "category" | "mainCategory">, status: ManualStatusKey, presentation: SupplierFamilyStatusPresentation): ManualProductRow {
  return { ...base, status, label: presentation.label, tone: presentation.tone, detail: presentation.detail };
}

/** The status key behind a label from supplierFamilyStatusPresentation (labels are unique). Null for anything that is not a manual status. */
export function manualStatusFromLabel(label: string): ManualStatusKey | null {
  const key = (Object.keys(supplierFamilyStatusLabels) as SupplierFamilyPriceStatusKey[]).find((item) => supplierFamilyStatusLabels[item] === label);
  return key && isManualKey(key) ? key : null;
}

export function buildManualProductRows(products: ManualProductInput[], categoryNames: Map<string, string>, manual: ManualPriceState, businessDate: string): ManualProductRow[] {
  const statuses = new Map(resolveSupplierFamilyPriceStatus({
    businessDate, manual, responsibilities: [], facts: [], legacyDetail: () => "No price list released yet",
    families: products.map((product) => ({ templateId: product.id, brandId: product.brand_id, pricingVersion: product.pricing_version === null ? null : String(product.pricing_version) })),
  }).map((status) => [status.familyId, status]));
  return products.flatMap((product) => {
    const status = statuses.get(product.id);
    if (!status || !isManualKey(status.status)) return [];
    const main = (product.main_category_id && categoryNames.get(product.main_category_id)) || "", sub = (product.sub_category_id && categoryNames.get(product.sub_category_id)) || "";
    return [manualRowFromPresentation({ id: product.id, name: product.internal_selection_name?.trim() || product.template_name, mainCategory: main, category: [main, sub].filter(Boolean).join(" / ") }, status.status, supplierFamilyStatusPresentation(status))];
  });
}

export type ManualCounts = { due: number; checked: number; edited: number; neutral: number };
export function manualStatusCounts(rows: ManualProductRow[]): ManualCounts {
  const counts: ManualCounts = { due: 0, checked: 0, edited: 0, neutral: 0 };
  for (const row of rows) {
    if (row.status === "price_update_due") counts.due += 1; else if (row.status === "price_checked") counts.checked += 1; else if (row.status === "edited_since_check") counts.edited += 1; else counts.neutral += 1;
  }
  return counts;
}

/** "12 due · 30 checked · 2 edited since check". Zero counts are left out; with no release every product is neutral. */
export function manualProgressText(counts: ManualCounts, hasRelease: boolean): string {
  if (!hasRelease) return "No price list released yet.";
  const parts = [[counts.due, "due"], [counts.checked, "checked"], [counts.edited, "edited since check"]] as const;
  return parts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(" · ") || "No products.";
}

const statusMatches: Record<ManualStatusFilter, (row: ManualProductRow) => boolean> = {
  all: () => true, due: (row) => row.status === "price_update_due", checked: (row) => row.status === "price_checked", edited: (row) => row.status === "edited_since_check",
};
export function filterManualRows(rows: ManualProductRow[], filters: { category?: string; status?: ManualStatusFilter; search?: string }): ManualProductRow[] {
  const search = (filters.search ?? "").trim().toLowerCase(), category = filters.category ?? "";
  return rows.filter((row) => statusMatches[filters.status ?? "all"](row) && (!category || row.mainCategory === category) && (!search || row.name.toLowerCase().includes(search)));
}

const sortRank: Record<ManualStatusKey, number> = { price_update_due: 0, edited_since_check: 1, legacy_manual: 2, price_checked: 3 };
/** Due first, then edited since check, then the rest, then checked; by name inside each group. */
export function sortManualRows(rows: ManualProductRow[]): ManualProductRow[] {
  return [...rows].sort((a, b) => sortRank[a.status] - sortRank[b.status] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const manualCategories = (rows: ManualProductRow[]) => [...new Set(rows.map((row) => row.mainCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** Badge colours, the same as the Product Library badge. */
export function manualBadgeClass(tone: SupplierFamilyStatusPresentation["tone"]): string {
  const base = "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ";
  return base + (tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : tone === "info" ? "border-sky-200 bg-sky-50 text-sky-900"
      : tone === "neutral" ? "border-zinc-200 bg-zinc-50 text-zinc-700"
        : tone === "danger" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900");
}
