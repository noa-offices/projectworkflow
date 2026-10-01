// Cross-order Procurement aggregate summary. Not a Server Action — this is a plain
// server-side helper, only ever called from the already role-gated /procurement/orders
// page component, so it does not re-check authorization itself (see that page's
// canAccessProcurement redirect, reused as-is rather than duplicated here).
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { VENDOR_STEP_LABELS, RECEIVING_STATUSES, type VendorReceivingStatus } from "@/lib/procurement/vendor-steps";

// Dashboard Attention drill-down: a bounded identifier only - orderNo + vendorKey, never prices,
// notes, contacts, document URLs, or the items_snapshot. Enrichment into a display label/href
// happens one layer up (lib/dashboard/actions.ts), which already has the active-order list with
// client/reference names in memory - never a second query here.
export type ProcurementAttentionItemRow = {
  orderNo: string;
  vendorKey: string;
};

// Dashboard Attention drill-down refinement: the bound now applies to distinct affected
// Projects (order_no), not raw vendor rows - a Project with 3 flagged vendors still counts as
// one group. `XGroupCount` is the true number of distinct Projects matched (before bounding),
// used by the dashboard to decide whether more groups exist beyond the first
// MAX_ATTENTION_GROUPS_PER_CATEGORY - independent of `XCount`, which stays the full vendor-issue
// tally (unchanged badge semantics).
const MAX_ATTENTION_GROUPS_PER_CATEGORY = 5;

export type ProcurementSummary = {
  openPoCount: number;
  vendorCount: number;
  awaitingConfirmationCount: number;
  inTransitCount: number;
  receiving: {
    pending: number;
    partial: number;
    received: number;
  };
  missingEtaCount: number;
  missingEtdCount: number;
  deliveredNotReceivedCount: number;
  awaitingConfirmationItems: ProcurementAttentionItemRow[];
  awaitingConfirmationGroupCount: number;
  missingEtaItems: ProcurementAttentionItemRow[];
  missingEtaGroupCount: number;
  missingEtdItems: ProcurementAttentionItemRow[];
  missingEtdGroupCount: number;
  deliveredNotReceivedItems: ProcurementAttentionItemRow[];
  deliveredNotReceivedGroupCount: number;
};

const IN_TRANSIT_STEP = VENDOR_STEP_LABELS.findIndex((step) => step.key === "in_transit");
// Dashboard Attention Summary: the same canonical step index the delivered-vs-received
// consistency rule already uses in lib/noa/noa-attention-capability.server.ts - never a second
// Attention engine, just the same deterministic comparison exposed as a plain aggregate count.
const DELIVERED_INSTALLED_STEP = VENDOR_STEP_LABELS.findIndex((step) => step.key === "delivered_installed");

const EMPTY_SUMMARY: ProcurementSummary = {
  openPoCount: 0,
  vendorCount: 0,
  awaitingConfirmationCount: 0,
  inTransitCount: 0,
  receiving: { pending: 0, partial: 0, received: 0 },
  missingEtaCount: 0,
  missingEtdCount: 0,
  deliveredNotReceivedCount: 0,
  awaitingConfirmationItems: [],
  awaitingConfirmationGroupCount: 0,
  missingEtaItems: [],
  missingEtaGroupCount: 0,
  missingEtdItems: [],
  missingEtdGroupCount: 0,
  deliveredNotReceivedItems: [],
  deliveredNotReceivedGroupCount: 0,
};

type VendorProgressRow = {
  order_no: string;
  vendor_key: string;
  active_step: number;
  supplier_confirmed_at: string | null;
  receiving_status: VendorReceivingStatus;
  eta: string | null;
  etd: string | null;
};

// Bounds to the first MAX_ATTENTION_GROUPS_PER_CATEGORY distinct order_no values (in first-seen
// order), then returns ALL vendor rows belonging to those - never a partial vendor list for an
// already-included Project. groupCount is the true distinct-order total before bounding.
function toGroupedItemRows(rows: VendorProgressRow[]): { items: ProcurementAttentionItemRow[]; groupCount: number } {
  const seenOrderNos = new Set<string>();
  const orderedOrderNos: string[] = [];
  for (const row of rows) {
    if (!seenOrderNos.has(row.order_no)) {
      seenOrderNos.add(row.order_no);
      orderedOrderNos.push(row.order_no);
    }
  }
  const boundedOrderNos = new Set(orderedOrderNos.slice(0, MAX_ATTENTION_GROUPS_PER_CATEGORY));
  return {
    items: rows.filter((row) => boundedOrderNos.has(row.order_no)).map((row) => ({ orderNo: row.order_no, vendorKey: row.vendor_key })),
    groupCount: orderedOrderNos.length,
  };
}

// Takes the caller's already-resolved active order-number list (the same dedup/exclusion
// logic /procurement/orders already applies for its table) so this helper never re-derives
// "active" itself - it only aggregates the two shallow-column queries below.
export async function loadProcurementSummary(activeOrderNos: string[]): Promise<ProcurementSummary> {
  if (activeOrderNos.length === 0) {
    return EMPTY_SUMMARY;
  }

  const supabase = await createSupabaseClient();

  const [poResult, progressResult] = await Promise.all([
    supabase
      .from("project_purchase_orders")
      .select("id", { count: "exact", head: true })
      .in("order_no", activeOrderNos),
    supabase
      .from("procurement_vendor_progress")
      .select("order_no, vendor_key, active_step, supplier_confirmed_at, receiving_status, eta, etd")
      .in("order_no", activeOrderNos)
      .returns<VendorProgressRow[]>(),
  ]);

  const rows = progressResult.data ?? [];

  const receiving = { pending: 0, partial: 0, received: 0 };
  for (const status of RECEIVING_STATUSES) {
    receiving[status] = rows.filter((row) => row.receiving_status === status).length;
  }

  const awaitingConfirmationRows = rows.filter((row) => !row.supplier_confirmed_at);
  const missingEtaRows = rows.filter((row) => !row.eta);
  const missingEtdRows = rows.filter((row) => !row.etd);
  const deliveredNotReceivedRows = rows.filter(
    (row) => row.active_step === DELIVERED_INSTALLED_STEP && row.receiving_status !== "received",
  );

  const awaitingConfirmationGrouped = toGroupedItemRows(awaitingConfirmationRows);
  const missingEtaGrouped = toGroupedItemRows(missingEtaRows);
  const missingEtdGrouped = toGroupedItemRows(missingEtdRows);
  const deliveredNotReceivedGrouped = toGroupedItemRows(deliveredNotReceivedRows);

  return {
    openPoCount: poResult.count ?? 0,
    vendorCount: rows.length,
    awaitingConfirmationCount: awaitingConfirmationRows.length,
    inTransitCount: rows.filter((row) => row.active_step === IN_TRANSIT_STEP).length,
    receiving,
    missingEtaCount: missingEtaRows.length,
    missingEtdCount: missingEtdRows.length,
    deliveredNotReceivedCount: deliveredNotReceivedRows.length,
    awaitingConfirmationItems: awaitingConfirmationGrouped.items,
    awaitingConfirmationGroupCount: awaitingConfirmationGrouped.groupCount,
    missingEtaItems: missingEtaGrouped.items,
    missingEtaGroupCount: missingEtaGrouped.groupCount,
    missingEtdItems: missingEtdGrouped.items,
    missingEtdGroupCount: missingEtdGrouped.groupCount,
    deliveredNotReceivedItems: deliveredNotReceivedGrouped.items,
    deliveredNotReceivedGroupCount: deliveredNotReceivedGrouped.groupCount,
  };
}
