import type { SmartSetupSupplierCheckResult, SmartSetupSupplierCheckStatus } from "./smart-setup-supplier-check";
import type { SmartSetupPriceCell } from "./smart-setup-supplier-targets";
import { evidenceText, reasonLabels, statusOrder } from "./smart-setup-supplier-verification";
import { conflictingDecisionKeys, decisionForRow, decisionKey, decisionLabels, type DecisionMap } from "./supplier-review-decisions";
import { formatDubaiDateTime } from "../inventory/date-time";
import type { CarryOverRowState } from "./supplier-carry-over";

/** Pure helpers for the full-screen Supplier price review. They only reshape what the check service returned; nothing is matched or recalculated. */
export type ReviewStatus = SmartSetupSupplierCheckStatus;
export const REVIEW_STATUS_CHIPS: ReviewStatus[] = ["NEEDS_REVIEW", "MISMATCH", "NOT_FOUND", "MATCHED"];
export const DEFAULT_REVIEW_STATUSES: ReviewStatus[] = ["NEEDS_REVIEW", "MISMATCH"];
export const reviewStatusLabels: Record<ReviewStatus, string> = { NEEDS_REVIEW: "Needs review", MISMATCH: "Mismatch", NOT_FOUND: "Not found", MATCHED: "Matched" };
export type ReviewSort = "status" | "model" | "difference";
export const reviewSortLabels: Record<ReviewSort, string> = { status: "Status", model: "Model / code", difference: "Difference size" };

export type PriceDifference = { amount: number; percent: number | null };
/** Imported minus supplier. Null when either price is missing; percent is null when the supplier price is zero. */
export function priceDifference(imported: number | null, supplier: number | null): PriceDifference | null {
  if (imported === null || supplier === null || !Number.isFinite(imported) || !Number.isFinite(supplier)) return null;
  const amount = Number((imported - supplier).toFixed(6));
  return { amount, percent: supplier === 0 ? null : Number(((amount / supplier) * 100).toFixed(4)) };
}

export type ReviewRow = { index: number; result: SmartSetupSupplierCheckResult; model: string; category: string; difference: PriceDifference | null };
/** The supplier price counts only where the service established one (Matched or Mismatch), the same rule as the Supplier price column. */
export function buildReviewRows(results: SmartSetupSupplierCheckResult[], cells: SmartSetupPriceCell[]): ReviewRow[] {
  const byLocator = new Map(cells.map((c) => [c.locator, c]));
  return results.map((result, index) => {
    const cell = byLocator.get(result.locator);
    const established = (result.status === "MATCHED" || result.status === "MISMATCH") && result.referencePrice !== null;
    return { index, result, model: cell?.label ?? result.locator, category: cell?.dimensionLabel || result.dimension || result.priceField.replace(/_/g, " "), difference: established ? priceDifference(result.importedPrice, result.referencePrice) : null };
  });
}
export function countReviewStatuses(rows: ReviewRow[]) {
  const counts: Record<ReviewStatus, number> = { NEEDS_REVIEW: 0, MISMATCH: 0, NOT_FOUND: 0, MATCHED: 0 };
  rows.forEach((r) => { counts[r.result.status]++; });
  return counts;
}
export function toggleReviewStatus(active: ReadonlySet<ReviewStatus>, status: ReviewStatus): Set<ReviewStatus> {
  const next = new Set(active);
  if (!next.delete(status)) next.add(status);
  return next;
}
const searchText = (r: ReviewRow) => `${r.model} ${r.result.code} ${r.category} ${r.result.priceField} ${r.result.priceField.replace(/_/g, " ")}`.toLowerCase();
export function filterReviewRows(rows: ReviewRow[], active: ReadonlySet<ReviewStatus>, query: string) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => active.has(r.result.status) && (!q || searchText(r).includes(q)));
}
const byText = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
/** Stable: ties keep the service's order. Difference size is the absolute amount, largest first; rows without a difference go last. */
export function sortReviewRows(rows: ReviewRow[], sort: ReviewSort) {
  const compare: Record<ReviewSort, (a: ReviewRow, b: ReviewRow) => number> = {
    status: (a, b) => statusOrder[a.result.status] - statusOrder[b.result.status],
    model: (a, b) => byText(a.model, b.model) || byText(a.result.code, b.result.code),
    difference: (a, b) => (a.difference && b.difference ? Math.abs(b.difference.amount) - Math.abs(a.difference.amount) : a.difference ? -1 : b.difference ? 1 : 0),
  };
  return [...rows].sort((a, b) => compare[sort](a, b) || a.index - b.index);
}

const CSV_HEADER = ["Model", "Supplier code", "Price field", "Category", "Role", "Currency", "Imported price", "Supplier price", "Difference", "Difference %", "Status", "Reason", "Evidence", "Decision", "My price", "Note", "Decided by", "Decided at", "Source of decision"];
const csvText = (value: string) => {
  const safe = /^[\t\r\n]|^\s*[=+\-@]/.test(value) ? `'${value}` : value; // guard all text, including notes
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csvNumber = (value: number | null) => (value === null ? "" : String(value));
/** UTF-8 with a BOM so Excel opens it correctly. Numbers are written as plain numbers; only text cells are quoted or guarded. */
export function reviewRowsToCsv(rows: ReviewRow[], decisions: DecisionMap = {}, conflicts: ReadonlySet<string> = conflictingDecisionKeys(rows), carryStates: Record<string, CarryOverRowState> = {}, dismissed: ReadonlySet<string> = new Set()) {
  const includeSource = Object.keys(carryStates).length > 0;
  const lines = rows.map((row) => {
    const { result: r, model, category, difference } = row;
    const key = decisionKey(row), saved = decisions[key], state = carryStates[key];
    const carried = state?.kind === "carried_over" ? state.earlier : null;
    const snapshot = saved ?? carried;
    const decision = conflicts.has(key) || dismissed.has(key) ? "" : saved ? decisionForRow(row, saved) : carried?.decision ?? "";
    const source = state?.kind === "saved" ? "Saved" : state?.kind === "carried_over" ? "Carried over" : state?.kind === "price_changed" ? "Price changed" : saved ? "Saved" : "New";
    return [
    csvText(model), csvText(r.code), csvText(r.priceField), csvText(category), csvText(r.role), csvText(r.importedCurrency), csvNumber(r.importedPrice),
    csvNumber(r.status === "MATCHED" || r.status === "MISMATCH" ? r.referencePrice : null), csvNumber(difference?.amount ?? null), csvNumber(difference?.percent ?? null),
    csvText(reviewStatusLabels[r.status]), csvText(reasonLabels[r.reason]), csvText(evidenceText(r)),
    csvText(decision ? decisionLabels[decision] : "Not decided"), csvNumber(decision === "set_custom" ? snapshot?.custom_price ?? null : null),
    csvText(decision ? snapshot?.note ?? "" : ""), csvText(decision ? snapshot?.decided_by_name || "Team member" : ""), csvText(decision && snapshot ? formatDubaiDateTime(snapshot.decided_at) : ""),
    ...(includeSource ? [csvText(source)] : []),
  ].join(","); });
  return `\uFEFF${[(includeSource ? CSV_HEADER : CSV_HEADER.slice(0,-1)).map(csvText).join(","), ...lines].join("\r\n")}\r\n`;
}
