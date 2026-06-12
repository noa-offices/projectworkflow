export const quotationStatuses = [
  ["draft", "Draft"],
  ["internal_review", "Internal Review"],
  ["revision_required", "Revision Requested"],
  ["ready_to_send", "Ready to Send"],
  ["sent_to_client", "Sent to Client"],
  ["client_confirmed", "Client Approved"],
  ["on_hold", "On Hold"],
  ["cancelled", "Rejected / Lost"],
  ["archived", "Archived"],
] as const;

export const quotationStatusLabels = new Map<string, string>(quotationStatuses);

export const allowedQuotationStatuses = new Set<string>(
  quotationStatuses.map(([value]) => value),
);

export function quotationStatusLabel(status: string | null | undefined) {
  return quotationStatusLabels.get(status ?? "") ?? status ?? "Unknown";
}

export function quotationStatusBadgeClassName(status: string | null | undefined) {
  switch (status) {
    case "internal_review":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "revision_required":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "ready_to_send":
      return "border-cyan-200 bg-cyan-50 text-cyan-800";
    case "sent_to_client":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "client_confirmed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "on_hold":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "cancelled":
      return "border-red-200 bg-red-50 text-red-800";
    case "archived":
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
    case "draft":
    default:
      return "border-zinc-200 bg-white text-zinc-600";
  }
}
