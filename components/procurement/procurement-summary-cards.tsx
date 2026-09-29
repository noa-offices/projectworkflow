import type { ProcurementSummary } from "@/lib/procurement/procurement-summary";

function SummaryCard({
  label,
  value,
  attention,
}: {
  label: string;
  value: number;
  attention?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${attention && value > 0 ? "text-amber-700" : "text-zinc-950"}`}>
        {value}
      </p>
    </div>
  );
}

export function ProcurementSummaryCards({ summary }: { summary: ProcurementSummary }) {
  const hasActivity = summary.vendorCount > 0 || summary.openPoCount > 0;

  if (!hasActivity) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3 text-center text-sm text-zinc-500">
        No active procurement orders.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <SummaryCard label="Open Supplier POs" value={summary.openPoCount} />
      <SummaryCard label="Awaiting Confirmation" value={summary.awaitingConfirmationCount} attention />
      <SummaryCard label="In Transit" value={summary.inTransitCount} />
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Receiving</p>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-sm font-medium text-zinc-500">
            Pending <span className="text-base font-bold text-zinc-950">{summary.receiving.pending}</span>
          </span>
          <span className="text-sm font-medium text-zinc-500">
            Partial <span className="text-base font-bold text-zinc-950">{summary.receiving.partial}</span>
          </span>
          <span className="text-sm font-medium text-zinc-500">
            Received <span className="text-base font-bold text-emerald-700">{summary.receiving.received}</span>
          </span>
        </div>
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Missing ETA / ETD</p>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-sm font-medium text-zinc-500">
            ETA <span className={`text-base font-bold ${summary.missingEtaCount > 0 ? "text-amber-700" : "text-zinc-950"}`}>{summary.missingEtaCount}</span>
          </span>
          <span className="text-sm font-medium text-zinc-500">
            ETD <span className={`text-base font-bold ${summary.missingEtdCount > 0 ? "text-amber-700" : "text-zinc-950"}`}>{summary.missingEtdCount}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
