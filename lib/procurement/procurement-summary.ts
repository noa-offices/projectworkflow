// Cross-order Procurement aggregate summary. Not a Server Action — this is a plain
// server-side helper, only ever called from the already role-gated /procurement/orders
// page component, so it does not re-check authorization itself (see that page's
// canAccessProcurement redirect, reused as-is rather than duplicated here).
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { VENDOR_STEP_LABELS, RECEIVING_STATUSES, type VendorReceivingStatus } from "@/lib/procurement/vendor-steps";

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
};

type VendorProgressRow = {
  active_step: number;
  supplier_confirmed_at: string | null;
  receiving_status: VendorReceivingStatus;
  eta: string | null;
  etd: string | null;
};

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
      .select("active_step, supplier_confirmed_at, receiving_status, eta, etd")
      .in("order_no", activeOrderNos)
      .returns<VendorProgressRow[]>(),
  ]);

  const rows = progressResult.data ?? [];

  const receiving = { pending: 0, partial: 0, received: 0 };
  for (const status of RECEIVING_STATUSES) {
    receiving[status] = rows.filter((row) => row.receiving_status === status).length;
  }

  return {
    openPoCount: poResult.count ?? 0,
    vendorCount: rows.length,
    awaitingConfirmationCount: rows.filter((row) => !row.supplier_confirmed_at).length,
    inTransitCount: rows.filter((row) => row.active_step === IN_TRANSIT_STEP).length,
    receiving,
    missingEtaCount: rows.filter((row) => !row.eta).length,
    missingEtdCount: rows.filter((row) => !row.etd).length,
    deliveredNotReceivedCount: rows.filter(
      (row) => row.active_step === DELIVERED_INSTALLED_STEP && row.receiving_status !== "received",
    ).length,
  };
}
