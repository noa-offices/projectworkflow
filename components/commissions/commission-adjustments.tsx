import { changeCommissionAdjustment } from "@/app/commissions/adjustment-actions";
import { approvedAdjustmentTotal, type CommissionAdjustmentRow } from "@/lib/commissions/adjustments";
import { commissionStatusLabel, type SalesCommissionRow } from "@/lib/commissions/types";
import { formatMoney } from "@/lib/currencies";

function Action({ row, label, target, reason = false, regenerate = false }: {
  row: CommissionAdjustmentRow; label: string; target?: string; reason?: boolean; regenerate?: boolean;
}) {
  return <form action={changeCommissionAdjustment} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="commission_id" value={row.commission_id} />
    <input type="hidden" name="adjustment_id" value={row.id} />
    {regenerate ? <input type="hidden" name="variation_id" value={row.variation_id} /> : <input type="hidden" name="target_status" value={target} />}
    {reason ? <input aria-label={`${label} reason for V${row.variation_no}`} name="reason" required placeholder="Required reason" className="rounded border px-2 py-1 text-sm" /> : null}
    <button className="rounded border border-zinc-300 px-3 py-1 text-sm font-semibold">{label}</button>
  </form>;
}

export function CommissionAdjustments({ parent, rows, unavailable, userId, isOwner, otherOwnerCount }: {
  parent: SalesCommissionRow; rows: CommissionAdjustmentRow[]; unavailable: boolean;
  userId: string; isOwner: boolean; otherOwnerCount: number;
}) {
  const total = approvedAdjustmentTotal(rows);
  return <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
    <h2 className="font-semibold text-zinc-950">Variation adjustments</h2>
    {unavailable ? <p className="mt-3 text-sm text-amber-900">Adjustments are unavailable. Net commission cannot be confirmed until the adjustment ledger is available.</p> : <>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div><dt className="text-sm text-zinc-500">Original commission</dt><dd>{formatMoney(parent.currency, Number(parent.final_commission_amount))}</dd></div>
        <div><dt className="text-sm text-zinc-500">Adjustments (approved and paid)</dt><dd>{formatMoney(parent.currency,total)}</dd></div>
        <div><dt className="text-sm text-zinc-500">Net commission</dt><dd className="font-semibold">{formatMoney(parent.currency,Number(parent.final_commission_amount)+total)}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-zinc-500">Drafts need approval before they count. Cancelled and reversed adjustments are excluded. The original commission keeps its own status.</p>
      {!rows.length ? <p className="mt-4 text-sm text-zinc-500">No variation adjustments recorded.</p> : <ul className="mt-4 divide-y divide-zinc-100">{rows.map((row) => <li key={row.id} className="space-y-3 py-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-semibold">V{row.variation_no} · {commissionStatusLabel(row.status)}</span><span>{row.adjustment_amount === null ? "Awaiting review" : `${Number(row.adjustment_amount)>0 ? "+" : ""}${formatMoney(row.currency,Number(row.adjustment_amount))}`}</span></div>
        {Number(row.adjustment_amount) < 0 && parent.status === "paid" ? <p className="text-sm font-semibold text-amber-900">Amount to recover: {formatMoney(row.currency,-Number(row.adjustment_amount))}{!["approved","paid"].includes(row.status) ? " (subject to approval)" : ""}</p> : null}
        {row.review_reason ? <p className="text-sm text-amber-900">{row.review_reason}</p> : null}
        <div className="flex flex-wrap gap-3">
          {row.status === "draft" && row.recalculated_by !== userId ? <Action row={row} label="Submit for Approval" target="pending_approval" /> : null}
          {isOwner && row.status === "requires_review" ? <Action row={row} label="Recheck copied rule and bases" regenerate /> : null}
          {isOwner && ["draft","pending_approval"].includes(row.status) ? <Action row={row} label="Cancel" target="cancelled" reason /> : null}
          {isOwner && row.status === "pending_approval" ? <Action row={row} label="Return to Draft" target="draft" reason /> : null}
          {isOwner && row.status === "pending_approval" && row.submitted_by !== userId && row.recalculated_by !== userId && otherOwnerCount > 0 ? <Action row={row} label="Approve" target="approved" /> : null}
          {isOwner && row.status === "approved" ? <Action row={row} label="Mark paid" target="paid" /> : null}
          {isOwner && ["approved","paid"].includes(row.status) ? <Action row={row} label="Reverse" target="reversed" reason /> : null}
        </div>
      </li>)}</ul>}
    </>}
  </section>;
}
