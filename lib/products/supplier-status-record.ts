/**
 * The Supplier status of a Product is computed once when the Local Builder page loads and lives on the template record.
 * A save returns a fresh template from the server that does not carry it, so these helpers keep it. Without them the Product
 * would fall back to the old price check text ("No current price list") right after a save.
 */
export const supplierStatusKeys = ["supplier_family_price_presentation", "supplier_family_price_load_state", "supplier_family_price_loading"] as const;

/** The updated record, with the Supplier status of the record it replaces. */
export function keepSupplierStatus<T extends object>(next: T, previous: object | undefined): T {
  if (!previous) return next;
  const copy = { ...next } as Record<string, unknown>, before = previous as Record<string, unknown>;
  for (const key of supplierStatusKeys) if (key in before) copy[key] = before[key];
  return copy as T;
}

/**
 * A new record has no Supplier status yet. In a page that computes it (any existing record has a load state) it is marked unavailable,
 * so the old price check text is not shown for it; in pages that never compute it, nothing changes.
 */
export function newRecordSupplierStatus<T extends object>(next: T, existing: object[]): T {
  const computed = existing.some((record) => (record as Record<string, unknown>).supplier_family_price_load_state !== undefined);
  return computed && !("supplier_family_price_load_state" in next) ? { ...next, supplier_family_price_load_state: "unavailable" } : next;
}

/** The record with a freshly computed Supplier status (for example right after a product was marked as checked), no page reload needed. */
export function withSupplierStatus<T extends object>(record: T, presentation: object | null | undefined): T {
  return { ...record, supplier_family_price_presentation: presentation ?? undefined, supplier_family_price_load_state: "loaded", supplier_family_price_loading: false };
}
