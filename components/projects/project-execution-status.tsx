function badgeClassName(status: string) {
  if (status === "Completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "Cancelled" || status === "On hold") return "border-red-200 bg-red-50 text-red-800";
  if (status === "Logistics in progress" || status === "Handover pending") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "Installation in progress") return "border-teal-200 bg-teal-50 text-teal-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

type Props = {
  canEdit: boolean;
  orderNo: string;
  quotationId: string;
  storedStatus: string;
  suggestedStatus: string;
};

export function ProjectExecutionStatus({ canEdit, storedStatus, suggestedStatus }: Props) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 xl:p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Overall Project Status</p>
      <dl className="mt-3 grid gap-3 text-xs">
        <div>
          <dt className="font-semibold text-zinc-500">Stored status</dt>
          <dd className="mt-1"><span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-semibold text-zinc-800">{storedStatus}</span></dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-500">Suggested from vendor progress</dt>
          <dd className="mt-1"><span className={`inline-flex rounded-full border px-2.5 py-1 font-semibold ${badgeClassName(suggestedStatus)}`}>{suggestedStatus}</span></dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">The suggestion is read-only and does not change Procurement or the stored project status.</p>
      <p className="mt-1 text-[11px] text-zinc-400">{canEdit ? "A persistent manual execution-status field is not available in the current data model." : "Only Admin Manager and System Owner may change project status when persistent status editing is available."}</p>
    </div>
  );
}
