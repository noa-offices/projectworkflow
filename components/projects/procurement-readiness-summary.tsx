import type { ProcurementReadiness } from "@/lib/projects/procurement-readiness";

export function ProcurementReadinessSummary({ readiness }: { readiness: ProcurementReadiness | null }) {
  const status = !readiness ? "Procurement readiness unavailable"
    : !readiness.applicable ? "Procurement not applicable"
    : readiness.ready ? "Procurement ready for completion" : "Procurement not ready for completion";
  const color = readiness?.applicable ? readiness.ready ? "text-emerald-800" : "text-amber-800" : "text-zinc-500";
  return (
    <div className="mt-3 border-t border-zinc-100 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Procurement readiness</h3>
      {readiness?.applicable ? (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <div><dt className="text-zinc-500">Vendor groups</dt><dd className="mt-1 font-medium text-zinc-800">{readiness.totalVendors}</dd></div>
          <div><dt className="text-zinc-500">Supplier confirmed</dt><dd className="mt-1 font-medium text-zinc-800">{readiness.confirmedCount} / {readiness.totalVendors}</dd></div>
          <div><dt className="text-zinc-500">Received</dt><dd className="mt-1 font-medium text-zinc-800">{readiness.receivedCount} / {readiness.totalVendors}</dd></div>
        </dl>
      ) : null}
      <p className={`mt-2 text-xs font-medium ${color}`}>{status}</p>
    </div>
  );
}
