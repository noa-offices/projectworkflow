import type { ReviewDecision, SavedReviewDecision } from "./supplier-review-decisions";

export type CurrentReviewPrice = { model_code: string; price_field: string; supplier_price: number | null; currency: string | null; usable_supplier_price?: boolean };
export type CarryOverDecision = {
  model_code: string; price_field: string; category: string | null; decision: ReviewDecision; custom_price: number | null;
  note: string | null; imported_price: number | null; supplier_price: number | null; currency: string | null;
  decided_at: string; decided_by_name: string; from_source_id: string; from_label: string;
};
export type CarryOverRowState =
  | { kind: "saved"; saved: SavedReviewDecision }
  | { kind: "carried_over"; earlier: CarryOverDecision }
  | { kind: "price_changed"; earlier: CarryOverDecision }
  | { kind: "new" };

export const carryOverKey = (row: { model_code: string; price_field: string }) => JSON.stringify([row.model_code, row.price_field]);
const samePrice = (left: number | null, right: number | null) => {
  if (left === null || right === null) return left === right;
  const a = Number(left), b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 10000) === Math.round(b * 10000);
};

/** The source RPC has one result per key; choosing the newest here keeps the pure helper safe with duplicate input. */
export function classifyCarryOverRows(current: readonly CurrentReviewPrice[], saved: readonly SavedReviewDecision[], older: readonly CarryOverDecision[]): CarryOverRowState[] {
  const savedByKey = new Map(saved.map((decision) => [carryOverKey(decision), decision]));
  const olderByKey = new Map<string, CarryOverDecision>();
  for (const candidate of older) {
    const key = carryOverKey(candidate), previous = olderByKey.get(key);
    if (!previous || Date.parse(candidate.decided_at) >= Date.parse(previous.decided_at)) olderByKey.set(key, candidate);
  }
  return current.map((row) => {
    const key = carryOverKey(row), own = savedByKey.get(key), candidate = olderByKey.get(key);
    if (own) return { kind: "saved", saved: own };
    if (!candidate) return { kind: "new" };
    const usable = row.usable_supplier_price ?? (row.supplier_price !== null && Number.isFinite(Number(row.supplier_price)) && Number(row.supplier_price) >= 0);
    return samePrice(row.supplier_price, candidate.supplier_price) && row.currency === candidate.currency && (candidate.decision !== "use_supplier" || usable)
      ? { kind: "carried_over", earlier: candidate }
      : { kind: "price_changed", earlier: candidate };
  });
}
