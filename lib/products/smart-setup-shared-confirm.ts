import type { SmartSetupSupplierCheckResult } from "./smart-setup-supplier-check";
import { comparisonCode } from "./supplier-price-matching";

/**
 * "Confirm shared" for Smart Setup. A code used by several draft rows is "shared" in the supplier list, and the check cannot tell
 * whether the one supplier price is meant for all of them. When every row has the same price field and the same price as the supplier,
 * the user may confirm the code. This is local to the review window: nothing is saved, and the draft is never changed.
 */
export const sharedCodeKey = (code: string) => comparisonCode(code);
export const sharedDiffersText = "A row price differs from the supplier price, so it cannot be confirmed.";

export type SharedCodeGroup = { key: string; code: string; locators: string[]; price: number | null; currency: string | null; canConfirm: boolean; differs: boolean };

const isShared = (r: SmartSetupSupplierCheckResult) => r.status === "NEEDS_REVIEW" && r.reason === "shared_price_unconfirmed";

/** Groups of unconfirmed shared rows by code. `canConfirm` is true only when the rule below holds for the whole group. */
export function sharedCodeGroups(results: SmartSetupSupplierCheckResult[]): Map<string, SharedCodeGroup> {
  const rows = new Map<string, SmartSetupSupplierCheckResult[]>();
  for (const r of results) if (isShared(r)) rows.set(sharedCodeKey(r.code), [...(rows.get(sharedCodeKey(r.code)) ?? []), r]);
  const groups = new Map<string, SharedCodeGroup>();
  for (const [key, list] of rows) {
    const supplier = list[0].sharedCandidate ?? null;
    const sameField = new Set(list.map((r) => r.priceField)).size === 1;
    const usable = list.every((r) => r.sharedCandidate && supplier && r.sharedCandidate.price === supplier.price && r.sharedCandidate.currency === supplier.currency);
    const equal = Boolean(supplier) && list.every((r) => r.importedPrice !== null && r.importedPrice === supplier!.price && r.importedCurrency === supplier!.currency);
    groups.set(key, { key, code: list[0].code, locators: list.map((r) => r.locator), price: supplier?.price ?? null, currency: supplier?.currency ?? null,
      canConfirm: list.length >= 2 && sameField && usable && equal, differs: list.length >= 2 && sameField && usable && !equal });
  }
  return groups;
}

/** Confirmed codes turn their rows into Matched with the supplier price. Anything that no longer qualifies is left as it was. */
export function applySharedConfirmations(results: SmartSetupSupplierCheckResult[], confirmed: ReadonlySet<string>): SmartSetupSupplierCheckResult[] {
  if (!confirmed.size) return results;
  const groups = sharedCodeGroups(results);
  return results.map((r) => {
    const group = isShared(r) ? groups.get(sharedCodeKey(r.code)) : undefined;
    if (!group || !group.canConfirm || !confirmed.has(group.key)) return r;
    return { ...r, status: "MATCHED", reason: "same_price", referencePrice: group.price, referenceCurrency: group.currency };
  });
}
