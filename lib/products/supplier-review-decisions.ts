import { canSeeCosts } from "../inventory/access";
import type { ReviewRow } from "./smart-setup-supplier-review";

export const decisionLabels = { use_supplier: "Use supplier price", keep_imported: "Keep imported price", set_custom: "Set my price", check_later: "Check later", ignore: "Ignore" } as const;
export type ReviewDecision = keyof typeof decisionLabels;
export type DecisionInput = {
  supplier_source_id: string; supplier_price_list_label: string; model_code: string; price_field: string;
  category: string | null; imported_price: number | null; supplier_price: number | null; currency: string | null;
  decision: ReviewDecision; custom_price: number | null; note: string | null; status: "open" | "cancelled";
};
export type SavedReviewDecision = Omit<DecisionInput, "status"> & { id: string; status: "open" | "applied" | "cancelled"; decided_by: string; decided_at: string; updated_by: string; updated_at: string; decided_by_name: string };
export type DecisionDraft = { decision: ReviewDecision | ""; customPrice: string; note: string; confirmed?: boolean };
export type DecisionMap = Record<string, SavedReviewDecision>;
export const canManageReviewDecisions = (role: string | null | undefined, status: string | null | undefined) => status === "active" && canSeeCosts(role);
export const isSourceId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const decisionKey = (row: ReviewRow) => JSON.stringify([row.result.code, row.result.priceField]);
export const savedDecisionKey = (row: SavedReviewDecision) => JSON.stringify([row.model_code, row.price_field]);
export const mapDecisions = (rows: SavedReviewDecision[]): DecisionMap => Object.fromEntries(rows.map((r) => [savedDecisionKey(r), r]));
export function usableSupplierPrice(row: ReviewRow): number | null {
  const r = row.result;
  return (r.status === "MATCHED" || r.status === "MISMATCH") && r.referencePrice !== null && Number.isFinite(r.referencePrice) && r.referencePrice >= 0 ? r.referencePrice : null;
}
export function supplierPriceChanged(row: ReviewRow, saved?: SavedReviewDecision): boolean {
  return !!saved && saved.status !== "cancelled" && (saved.supplier_price !== usableSupplierPrice(row) || saved.currency !== row.result.importedCurrency);
}
export function decisionForRow(row: ReviewRow, saved?: SavedReviewDecision): ReviewDecision | "" {
  return saved && saved.status === "open" && !supplierPriceChanged(row, saved) ? saved.decision : "";
}
export function decisionWithDraft(row: ReviewRow, saved?: SavedReviewDecision, draft?: DecisionDraft): ReviewDecision | "" {
  if (!draft) return decisionForRow(row, saved);
  return supplierPriceChanged(row, saved) && !draft.confirmed ? "" : draft.decision;
}
export function draftForRow(row: ReviewRow, saved?: SavedReviewDecision): DecisionDraft {
  const decision = saved?.status === "open" ? saved.decision : "";
  return { decision, customPrice: decision === "set_custom" && saved?.custom_price !== null ? String(saved?.custom_price ?? "") : "", note: saved?.note ?? "" };
}
export const sameDraft = (a: DecisionDraft, b: DecisionDraft) => a.decision === b.decision && a.customPrice === b.customPrice && a.note === b.note;

/** The database key deliberately excludes category. Never silently overwrite a different row's snapshot. */
export function conflictingDecisionKeys(rows: ReviewRow[]): Set<string> {
  const snapshots = new Map<string, string>(); const conflicts = new Set<string>();
  for (const row of rows) {
    const key = decisionKey(row), snapshot = JSON.stringify([row.category, row.result.importedPrice, usableSupplierPrice(row), row.result.importedCurrency]);
    if (snapshots.has(key) && snapshots.get(key) !== snapshot) conflicts.add(key);
    snapshots.set(key, snapshot);
  }
  return conflicts;
}

/** Reject unexpected keys (including client-supplied audit fields) and preserve SQL's nullable values. */
export function validateDecisionInput(value: unknown): DecisionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Choose a valid decision.");
  const v = value as Record<string, unknown>;
  const keys = ["supplier_source_id", "supplier_price_list_label", "model_code", "price_field", "category", "imported_price", "supplier_price", "currency", "decision", "custom_price", "note", "status"];
  if (Object.keys(v).some((k) => !keys.includes(k))) throw Error("The decision contains an unsupported field.");
  if (!isSourceId(v.supplier_source_id)) throw Error("Choose a valid supplier price list.");
  for (const [key, max] of [["supplier_price_list_label", 500], ["model_code", 200]] as const) if (typeof v[key] !== "string" || !v[key].trim() || v[key].length > max || v[key] !== v[key].trim()) throw Error("Enter a valid price list label and model code.");
  if (!["unit_price", "default_price", "additional_price"].includes(v.price_field as string)) throw Error("Choose a valid price field.");
  for (const key of ["category", "note"]) if (v[key] !== null && (typeof v[key] !== "string" || Array.from(v[key] as string).length > 500)) throw Error("Notes and categories must be 500 characters or fewer.");
  for (const key of ["imported_price", "supplier_price", "custom_price"]) if (v[key] !== null && (typeof v[key] !== "number" || !Number.isFinite(v[key]) || (v[key] as number) < 0 || (v[key] as number) > 1e15)) throw Error("Enter a price from 0 to 1,000,000,000,000,000.");
  if (v.currency !== null && !["AED", "EUR", "USD"].includes(v.currency as string)) throw Error("Choose a supported currency.");
  if (typeof v.decision !== "string" || !Object.hasOwn(decisionLabels, v.decision)) throw Error("Choose a valid decision.");
  if (v.decision === "set_custom" ? v.custom_price === null : v.custom_price !== null) throw Error("Set my price needs a custom price; other decisions cannot have one.");
  if (v.decision === "use_supplier" && v.supplier_price === null) throw Error("This row has no usable supplier price.");
  if (v.status !== "open" && v.status !== "cancelled") throw Error("Choose an open or cancelled decision.");
  return v as DecisionInput;
}
export function inputForRow(row: ReviewRow, draft: DecisionDraft, saved?: SavedReviewDecision): DecisionInput | null {
  if (!draft.decision) {
    if (!saved || saved.status === "cancelled") return null;
    return validateDecisionInput({ supplier_source_id: saved.supplier_source_id, supplier_price_list_label: saved.supplier_price_list_label, model_code: saved.model_code, price_field: saved.price_field, category: saved.category, imported_price: saved.imported_price, supplier_price: saved.supplier_price, currency: saved.currency, decision: saved.decision, custom_price: saved.custom_price, note: draft.note || null, status: "cancelled" });
  }
  if (draft.decision === "set_custom" && !draft.customPrice.trim()) throw Error(`${row.result.code}: enter your price.`);
  if (supplierPriceChanged(row, saved) && !draft.confirmed) throw Error(`${row.result.code}: confirm or change the action before saving.`);
  return validateDecisionInput({ supplier_source_id: row.result.source.versionId, supplier_price_list_label: row.result.source.title, model_code: row.result.code, price_field: row.result.priceField, category: row.category || null, imported_price: row.result.importedPrice, supplier_price: usableSupplierPrice(row), currency: row.result.importedCurrency, decision: draft.decision, custom_price: draft.decision === "set_custom" ? Number(draft.customPrice) : null, note: draft.note || null, status: "open" });
}
