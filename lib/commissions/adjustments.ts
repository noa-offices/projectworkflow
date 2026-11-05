import type { CommissionStatus } from "./types";

export type CommissionAdjustmentRow = {
  id: string;
  commission_id: string;
  variation_id: string;
  variation_no: number;
  currency: string;
  previous_base: number | null;
  new_base: number | null;
  previous_entitlement: number | null;
  new_entitlement: number | null;
  adjustment_amount: number | null;
  status: CommissionStatus;
  review_reason: string | null;
  submitted_by: string | null;
  recalculated_by: string | null;
  created_at: string;
  paid_at: string | null;
};

export function approvedAdjustmentTotal(rows: readonly CommissionAdjustmentRow[]) {
  return Math.round(rows.reduce((sum, row) => sum + (
    row.status === "approved" || row.status === "paid" ? Number(row.adjustment_amount ?? 0) : 0
  ), 0) * 100) / 100;
}

export function commissionSummaryTotals(
  originals: readonly { status: CommissionStatus; currency: string; final_commission_amount: number }[],
  adjustments: readonly CommissionAdjustmentRow[], group: "earned" | "paid" | "approved",
) {
  const entries = [
    ...originals.filter((row) => group === "earned" ? !["cancelled","reversed"].includes(row.status) : row.status === group)
      .map((row) => ({ currency: row.currency, amount: Number(row.final_commission_amount) })),
    ...adjustments.filter((row) => group === "earned" ? ["approved","paid"].includes(row.status) : row.status === group)
      .map((row) => ({ currency: row.currency, amount: Number(row.adjustment_amount ?? 0) })),
  ];
  const totals = new Map<string, number>();
  for (const row of entries) totals.set(row.currency, Math.round(((totals.get(row.currency) ?? 0) + row.amount) * 100) / 100);
  return totals;
}

type AdjustmentClient = {
  from(name: string): { select(columns: string): {
    in(column: string, values: string[]): { order(column: string): PromiseLike<{
      data: CommissionAdjustmentRow[] | null; error: unknown;
    }> };
  } };
};

/** Scoped client only. Missing migration/read failures are visible to the caller. */
export async function loadCommissionAdjustments(client: object, commissionIds: readonly string[]) {
  const ids = [...new Set(commissionIds)];
  const batches = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));
  const results = await Promise.all(batches.map((batch) => (client as AdjustmentClient)
    .from("sales_commission_adjustments")
    .select("id,commission_id,variation_id,variation_no,currency,previous_base,new_base,previous_entitlement,new_entitlement,adjustment_amount,status,review_reason,submitted_by,recalculated_by,created_at,paid_at")
    .in("commission_id", batch).order("variation_no")));
  return { rows: results.flatMap((result) => result.data ?? []), unavailable: results.some((result) => !!result.error) };
}
