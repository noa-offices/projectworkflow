import { quotationFolderNumberFromQuotationNumber } from "@/lib/projectworkflow-numbering";
import { quotationStatusLabel } from "@/lib/quotation-status";
import { quotationApprovalDisplay } from "@/lib/quotations/approval-display";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { clientApprovalDraftFromLayoutSettings } from "@/lib/quotations/client-approval-draft";
import { minimizedRows, type ReadRow } from "./types";

export type SummaryQuotation = {
  id: string; client_id: string; project_id: string | null; quotation_no: string | null;
  title: string; legacy_reference: string | null; quotation_date: string; status: string;
  currency: string; grand_total: number; is_active: boolean; approved_salesperson_id: string | null;
  layout_settings: Record<string, unknown> | null;
};
export function quotationGroupKey(row: Pick<SummaryQuotation, "quotation_no" | "project_id" | "id">) {
  return quotationFolderNumberFromQuotationNumber(row.quotation_no) ?? (row.project_id ? "project:" + row.project_id : "legacy:" + row.id);
}
export function quotationGroupCondition(row: Pick<SummaryQuotation, "quotation_no" | "project_id" | "id">) {
  const folder = quotationFolderNumberFromQuotationNumber(row.quotation_no);
  if (folder) return "quotation_no.ilike." + folder.replace("QF-", "QN-") + "*";
  return row.project_id ? "project_id.eq." + row.project_id : "id.eq." + row.id;
}
export function quotationSummaries(rows: SummaryQuotation[], clients: Map<string, string>, projects: Map<string, { project_name: string; project_year: number | null }>) {
  const groups = new Map<string, SummaryQuotation[]>();
  for (const row of rows) {
    const key = quotationGroupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const result: ReadRow[] = [...groups.entries()].map(([key, group]) => {
    const active = group.filter(r => r.is_active);
    const latest = (active.length ? active : group).reduce((a, b) => new Date(b.quotation_date).getTime() > new Date(a.quotation_date).getTime() ? b : a);
    const counts = new Map<string, number>();
    for (const r of group) {
      const status = r.is_active ? quotationApprovalDisplay(r)?.label ?? quotationStatusLabel(r.status) : "Archived";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    const project = latest.project_id ? projects.get(latest.project_id) : undefined;
    return {
      id: key, title: latest.title,
      code: group.map(r => quotationFolderNumberFromQuotationNumber(r.quotation_no)).find(Boolean) ?? latest.quotation_no ?? "",
      subtitle: [clients.get(latest.client_id) ?? "Unknown client", project?.project_name ?? latest.legacy_reference ?? "Opportunity reference"].join(" / "),
      status: [...counts].map(([s, n]) => n > 1 ? s + " x" + n : s).join(", "),
      href: "/quotations/" + latest.id, date: latest.quotation_date,
      currency: latest.currency, total: Number(latest.grand_total), clientId: latest.client_id,
      projectId: latest.project_id ?? "", year: String(project?.project_year ?? new Date(latest.quotation_date).getFullYear()),
      archived: group.some(r => typeof r.layout_settings?.folderArchivedAt === "string"), count: group.length,
    };
  }).sort((a, b) => new Date(b.date ?? "").getTime() - new Date(a.date ?? "").getTime());
  return minimizedRows("quotations", result);
}
export function projectSummaries(rows: Array<{ id: string; layout_settings: unknown }>, clients: Map<string, string>, completed: boolean) {
  const seen = new Set<string>();
  const result: ReadRow[] = [];
  for (const row of rows) {
    const settings = row.layout_settings as Record<string, unknown> | null;
    const completedAt = typeof settings?.projectCompletedAt === "string" ? settings.projectCompletedAt : null;
    if (completed ? !completedAt : completedAt || typeof settings?.projectCancelledAt === "string") continue;
    const order = projectFileFromLayoutSettings(settings) ?? clientApprovalDraftFromLayoutSettings(settings)?.confirmedOrder;
    if (!order || seen.has(order.orderNo)) continue;
    seen.add(order.orderNo);
    result.push({
      id: order.orderNo, code: order.orderNo, title: order.reference,
      subtitle: clients.get(order.clientId) ?? order.clientName, status: completed ? "Completed" : "Confirmed",
      href: "/projects/orders/" + encodeURIComponent(order.orderNo),
      date: completedAt ?? order.createdAt, year: String(new Date(order.createdAt).getFullYear()),
      currency: order.currency, total: order.total, clientId: order.clientId,
    });
  }
  return minimizedRows(completed ? "completed" : "projects", result.sort((a, b) => new Date(b.date ?? "").getTime() - new Date(a.date ?? "").getTime()));
}
