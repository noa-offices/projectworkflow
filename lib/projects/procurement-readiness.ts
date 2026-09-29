export type ProcurementReadiness = {
  totalVendors: number;
  confirmedCount: number;
  receivedCount: number;
  unconfirmedCount: number;
  notReceivedCount: number;
  ready: boolean;
  applicable: boolean;
};

// Computed on the Project server page from its order-scoped vendor-progress read.
// No milestone, date, document, payment or quotation-item inference belongs in readiness v1.
export function computeProcurementReadiness(rows: ReadonlyArray<{
  vendor_key: string;
  supplier_confirmed_at: string | null;
  receiving_status: string | null;
}>): ProcurementReadiness {
  const totalVendors = rows.length;
  const confirmedCount = rows.filter((row) => row.supplier_confirmed_at !== null).length;
  const receivedCount = rows.filter((row) => row.receiving_status === "received").length;
  return {
    totalVendors, confirmedCount, receivedCount,
    unconfirmedCount: totalVendors - confirmedCount,
    notReceivedCount: totalVendors - receivedCount,
    ready: confirmedCount === totalVendors && receivedCount === totalVendors,
    applicable: totalVendors > 0,
  };
}

export function procurementCompletionWarning(readiness: ProcurementReadiness | null | undefined): string | null {
  if (readiness === null) return "Procurement readiness is unavailable. Completion is still possible.";
  if (!readiness?.applicable || readiness.ready) return null;
  const parts: string[] = [];
  if (readiness.unconfirmedCount) parts.push(`${readiness.unconfirmedCount} vendor${readiness.unconfirmedCount === 1 ? "" : "s"} not confirmed`);
  if (readiness.notReceivedCount) parts.push(`${readiness.notReceivedCount} vendor${readiness.notReceivedCount === 1 ? "" : "s"} not received`);
  return `Procurement is not ready: ${parts.join(" · ")}.`;
}
