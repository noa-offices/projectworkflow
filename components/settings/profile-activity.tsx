"use client";

import { useState } from "react";
import Link from "next/link";
import { commissionFormulaLabel, commissionStatusLabel } from "@/lib/commissions/types";
import type { ProfileCommissionRow, ProfileProjectRow } from "@/lib/settings/profile-stats-loader";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type ActivityEntry = {
  id: string;
  action: string;
  title: string;
  description: string | null;
  entity_type: string;
  created_at: string;
  actor_name?: string | null;
  actor_role?: string | null;
  quotation_id?: string | null;
  quotation_no?: string | null;
};

type QuotationEntry = {
  id: string;
  quotation_no: string | null;
  title: string | null;
  status: string;
  grand_total: number | null;
  currency: string | null;
  created_at: string;
};

type MonthlyDataPoint = {
  month: string;
  year: number;
  monthKey: string;
  total: number;
  approved: number;
  value: number;
};

type TopClient = {
  clientName: string;
  total: number;
  count: number;
};

type AllQuotationEntry = {
  status: string;
};

type ProfileActivityProps = {
  totalQuotations: number;
  quotationsPrepared: number;
  revisionsPrepared: number;
  optionsPrepared: number;
  personalActivityCount: number;
  approvedQuotations: number;
  totalValue: number;
  currency: string;
  role: string | null;
  recentActivity: ActivityEntry[];
  salesActivity: ActivityEntry[];
  recentQuotations: QuotationEntry[];
  recentPreparedQuotations: QuotationEntry[];
  monthlyData: MonthlyDataPoint[];
  allQuotations?: AllQuotationEntry[];
  topClients?: TopClient[];
  projects: ProfileProjectRow[];
  projectSummary: {
    approvedValue: number;
    averageApprovedValue: number;
    averageQuotedValue: number;
    pendingQuotedValue: number;
    quotedValue: number;
    uniqueClients: number;
    uniqueProjects: number;
  };
  commissions: ProfileCommissionRow[];
};

const PIPELINE_STATUSES: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "ready_to_send", label: "Ready to Send" },
  { key: "sent_to_client", label: "Sent to Client" },
  { key: "client_confirmed_pending", label: "Client Confirmed · Project File Pending" },
  { key: "client_approved", label: "Client Approved" },
  { key: "cancelled", label: "Cancelled" },
];

function dotColor(entityType: string): string {
  if (entityType.startsWith("quotation")) return "bg-emerald-500";
  if (entityType === "profile") return "bg-blue-500";
  if (entityType === "company_settings") return "bg-amber-500";
  return "bg-zinc-400";
}

function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "Just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value));
}

function statusBadge(status: string): string {
  if (status === "client_confirmed") return "bg-emerald-100 text-emerald-800";
  if (status === "sent_to_client" || status === "ready_to_send") return "bg-blue-100 text-blue-800";
  if (status === "draft") return "bg-zinc-100 text-zinc-600";
  return "bg-amber-100 text-amber-800";
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function roleLabel(role: string | null | undefined) {
  if (role === "sales_designer") return "Sales Manager";
  if (role === "sales_coordinator") return "Sales Coordinator";
  return role ? role.replaceAll("_", " ") : "User";
}

function activityTitle(entry: ActivityEntry) {
  return entry.action === "quotation_created" ? "Quotation prepared" : entry.title;
}

function ActivityFeed({
  description,
  recentActivity,
  showActor = false,
  title,
}: {
  description: string;
  recentActivity: ActivityEntry[];
  showActor?: boolean;
  title: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
      <p className="mt-1 text-xs text-zinc-500">{description}</p>
      {recentActivity.length === 0 ? (
        <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-500">No activity recorded for this period.</p>
      ) : (
        <div className="mt-3 divide-y divide-zinc-100">
          {recentActivity.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 py-3">
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotColor(entry.entity_type)}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-950">{activityTitle(entry)}</p>
                {entry.description ? (
                  <p className="mt-0.5 text-xs text-zinc-500">{entry.description}</p>
                ) : null}
                {entry.quotation_no && entry.quotation_id ? (
                  <Link href={`/quotations/${entry.quotation_id}`} className="mt-0.5 block font-mono text-xs text-emerald-800 hover:underline">
                    {entry.quotation_no}
                  </Link>
                ) : null}
                {showActor ? (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    By {entry.actor_name ?? "Unknown user"} — {roleLabel(entry.actor_role)}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 text-xs text-zinc-400">{relativeTime(entry.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuotationsTable({
  recentQuotations,
  currency,
  showValue = true,
  title,
}: {
  recentQuotations: QuotationEntry[];
  currency: string;
  showValue?: boolean;
  title: string;
}) {
  if (recentQuotations.length === 0) return null;
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead>
            <tr className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3">No.</th>
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Status</th>
              {showValue ? <th className="px-5 py-3">Value</th> : null}
              <th className="px-5 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {recentQuotations.map((q) => (
              <tr key={q.id} className="hover:bg-zinc-50">
                <td className="px-5 py-3 font-mono text-xs text-zinc-600">
                  <Link href={`/quotations/${q.id}`} className="hover:underline">
                    {q.quotation_no ?? "—"}
                  </Link>
                </td>
                <td className="px-5 py-3 text-zinc-800">
                  <Link href={`/quotations/${q.id}`} className="hover:underline">
                    {q.title ?? "—"}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(q.status)}`}
                  >
                    {statusLabel(q.status)}
                  </span>
                </td>
                {showValue ? <td className="px-5 py-3 text-zinc-700">
                  {q.currency ?? currency}{" "}
                  {new Intl.NumberFormat("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  }).format(q.grand_total ?? 0)}
                </td> : null}
                <td className="px-5 py-3 text-zinc-500">
                  {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
                    new Date(q.created_at),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthlyChart({
  monthlyData,
  title,
  currency,
  totalValue,
}: {
  monthlyData: MonthlyDataPoint[];
  title: string;
  currency: string;
  totalValue: number;
}) {
  const formattedTotal = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(totalValue);

  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Light green = created · Dark green = client approved
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-zinc-500">Total Value</p>
          <p className="mt-0.5 text-sm font-semibold text-zinc-950">
            {currency} {formattedTotal}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 11, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#71717a" }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e4e4e7" }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => [
                value,
                name === "total" ? "Commercially Owned" : "Approved",
              ]}
            />
            <Bar dataKey="total" fill="#d1fae5" radius={[4, 4, 0, 0]} name="total" />
            <Bar dataKey="approved" fill="#059669" radius={[4, 4, 0, 0]} name="approved" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PipelineBreakdown({ allQuotations }: { allQuotations: AllQuotationEntry[] }) {
  const counts: Record<string, number> = {};
  for (const q of allQuotations) {
    counts[q.status] = (counts[q.status] ?? 0) + 1;
  }

  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-950">Pipeline Breakdown</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {PIPELINE_STATUSES.map(({ key, label }) => {
          const count = counts[key] ?? 0;
          return (
            <div
              key={key}
              className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs"
            >
              <span className="text-zinc-600">{label}</span>
              <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-xs font-semibold text-zinc-800">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopClientsTable({
  topClients,
  currency,
}: {
  topClients: TopClient[];
  currency: string;
}) {
  if (topClients.length === 0) return null;
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-950">Top Clients by Value</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead>
            <tr className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 w-8">#</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3 text-right">Quotes</th>
              <th className="px-5 py-3 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {topClients.map((client, index) => (
              <tr key={client.clientName} className="hover:bg-zinc-50">
                <td className="px-5 py-3 text-xs font-medium text-zinc-400">{index + 1}</td>
                <td className="px-5 py-3 font-medium text-zinc-950">{client.clientName}</td>
                <td className="px-5 py-3 text-right text-zinc-700">{client.count}</td>
                <td className="px-5 py-3 text-right font-medium text-zinc-950">
                  {currency}{" "}
                  {new Intl.NumberFormat("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  }).format(client.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function compactMoney(currency: string, value: number) {
  return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-2 text-xl font-semibold text-zinc-950">{value}</p></div>;
}

function ProjectsTable({ projects, title }: { projects: ProfileProjectRow[]; title: string }) {
  if (!projects.length) return <p className="text-sm text-zinc-500">No project-wise commercial data available.</p>;
  return (
    <div className="overflow-x-auto">
      <h2 className="mb-3 text-sm font-semibold text-zinc-950">{title}</h2>
      <table className="min-w-[1100px] w-full divide-y divide-zinc-200 text-sm">
        <thead><tr className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500"><th className="px-3 py-2">Project / Enquiry</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Folder Number</th><th className="px-3 py-2">Latest Quotation</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Quoted Value</th><th className="px-3 py-2">Approved Value</th><th className="px-3 py-2">Sales Manager</th><th className="px-3 py-2">Prepared By</th><th className="px-3 py-2">Last Updated</th></tr></thead>
        <tbody className="divide-y divide-zinc-100">{projects.map((project) => <tr key={project.folderKey}><td className="px-3 py-3 font-medium"><Link className="text-emerald-900 hover:underline" href={`/quotations/${project.id}`}>{project.projectName}</Link></td><td className="px-3 py-3">{project.clientName}</td><td className="px-3 py-3 font-mono text-xs">{project.folderKey}</td><td className="px-3 py-3 font-mono text-xs">{project.latestQuotation}</td><td className="px-3 py-3 capitalize">{statusLabel(project.status)}</td><td className="px-3 py-3">{compactMoney(project.currency, project.quotedValue)}</td><td className="px-3 py-3">{project.approvedValue > 0 ? compactMoney(project.currency, project.approvedValue) : "—"}</td><td className="px-3 py-3">{project.salesManager}</td><td className="px-3 py-3">{project.preparedBy}</td><td className="px-3 py-3">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(project.lastUpdated))}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function CommissionPanel({ commissions }: { commissions: ProfileCommissionRow[] }) {
  if (!commissions.length) return <p className="text-sm text-zinc-500">No commission records in this period.</p>;
  const count = (status: ProfileCommissionRow["status"]) => commissions.filter((row) => row.status === status).length;
  const totals = (rows: ProfileCommissionRow[]) => Array.from(rows.reduce((map, row) => map.set(row.currency, (map.get(row.currency) ?? 0) + Number(row.final_commission_amount)), new Map<string, number>())).map(([currency, value]) => compactMoney(currency, value)).join(" · ");
  const earned = totals(commissions.filter((row) => !["cancelled", "reversed"].includes(row.status)));
  const paid = totals(commissions.filter((row) => row.status === "paid"));
  const approvedNotPaid = totals(commissions.filter((row) => row.status === "approved"));
  return <div><h2 className="text-sm font-semibold text-zinc-950">Commission Summary</h2><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Requires Review" value={count("requires_review")} /><MetricCard label="Draft" value={count("draft")} /><MetricCard label="Pending Approval" value={count("pending_approval")} /><MetricCard label="Approved" value={count("approved")} /><MetricCard label="Paid" value={count("paid")} /><MetricCard label="Reversed" value={count("reversed")} /><MetricCard label="Total Earned" value={earned || "—"} /><MetricCard label="Total Paid" value={paid || "—"} /><MetricCard label="Approved Not Paid" value={approvedNotPaid || "—"} /></div><div className="mt-5 overflow-x-auto"><table className="min-w-[950px] w-full divide-y divide-zinc-200 text-sm"><thead><tr className="bg-zinc-50 text-left text-xs uppercase text-zinc-500"><th className="px-3 py-2">Quotation / Project</th><th className="px-3 py-2">Approved Value</th><th className="px-3 py-2">Formula</th><th className="px-3 py-2">Original Commission</th><th className="px-3 py-2">Final Commission</th><th className="px-3 py-2">Currency</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Earned Date</th><th className="px-3 py-2">Paid Date</th><th className="px-3 py-2">View</th></tr></thead><tbody className="divide-y divide-zinc-100">{commissions.map((row) => <tr key={row.id}><td className="px-3 py-3 font-mono text-xs">{row.quotation_folder_key}</td><td className="px-3 py-3">{compactMoney(row.currency, Number(row.approved_total_including_vat))}</td><td className="px-3 py-3">{commissionFormulaLabel(row.formula_type_snapshot)}</td><td className="px-3 py-3">{compactMoney(row.currency, Number(row.original_calculated_amount))}</td><td className="px-3 py-3 font-semibold">{compactMoney(row.currency, Number(row.final_commission_amount))}</td><td className="px-3 py-3">{row.currency}</td><td className="px-3 py-3">{commissionStatusLabel(row.status)}</td><td className="px-3 py-3">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(row.earned_at))}</td><td className="px-3 py-3">{row.paid_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(row.paid_at)) : "—"}</td><td className="px-3 py-3"><Link className="font-semibold text-emerald-900 hover:underline" href={`/commissions/${row.id}`}>View</Link></td></tr>)}</tbody></table></div></div>;
}

export function ProfileActivity({
  totalQuotations,
  quotationsPrepared,
  revisionsPrepared,
  optionsPrepared,
  personalActivityCount,
  approvedQuotations,
  totalValue,
  currency,
  role,
  recentActivity,
  salesActivity,
  recentQuotations,
  recentPreparedQuotations,
  monthlyData,
  allQuotations = [],
  topClients = [],
  projects,
  projectSummary,
  commissions,
}: ProfileActivityProps) {
  const winRate =
    totalQuotations > 0
      ? Math.round((approvedQuotations / totalQuotations) * 100) + "%"
      : "—";

  const isSalesDesigner = role === "sales_designer";
  const [activeTab, setActiveTab] = useState("overview");
  const tabs = isSalesDesigner
    ? [["overview", "Overview"], ["projects", "Projects"], ["pipeline", "Pipeline"], ["sales_activity", "Activity on My Sales"], ["commission", "Commission"], ["personal_activity", "Personal Activity"]]
    : [["overview", "Overview"], ["quotations", "Quotations"], ["projects", "Projects Worked On"], ["products", "Products"], ["documents", "Documents"], ["activity", "Activity"]];
  const workQuotations = isSalesDesigner ? recentQuotations : recentPreparedQuotations;
  const productActivity = recentActivity.filter((entry) =>
    entry.entity_type === "brand" || entry.entity_type.startsWith("product_template") || entry.entity_type === "brand_price_list_update"
  );
  const documentActions = new Set(["document_setup_updated", "project_file_created", "confirmed_order_project_created"]);
  const documentActivity = recentActivity.filter((entry) => documentActions.has(entry.action));

  return (
    <>
      {/* Section 0 — Date Range Selector */}
      {/* Section 1 — Stats Grid (all roles) */}
      {activeTab === "overview" ? <details open className="mt-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <summary className="cursor-pointer text-base font-semibold text-zinc-950">Sales Performance</summary>
        <p className="mt-1 text-sm text-zinc-500">
          {isSalesDesigner
            ? "Commercial ownership, approvals, pipeline, and quoted value."
            : "Your quotation preparation contribution. Commercial values belong to the assigned Sales Manager."}
        </p>
      <div className={`mt-4 grid gap-4 sm:grid-cols-2 ${isSalesDesigner ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {isSalesDesigner ? "Quotations Owned" : "Quotations Prepared"}
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{isSalesDesigner ? totalQuotations : quotationsPrepared}</p>
        </div>
        {isSalesDesigner ? <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Client Approved
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{approvedQuotations}</p>
        </div> : <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Revisions Prepared</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{revisionsPrepared}</p>
        </div>}
        {isSalesDesigner ? <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Win Rate</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{winRate}</p>
        </div> : <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Personal Activity</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{personalActivityCount}</p>
        </div>}
        {isSalesDesigner ? <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Total Quoted Value</p>
          <p className="mt-1 text-xs font-medium text-zinc-400">{currency}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-950">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(projectSummary.quotedValue)}</p>
        </div> : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {isSalesDesigner ? <><MetricCard label="Unique Projects / Enquiries" value={projectSummary.uniqueProjects} /><MetricCard label="Unique Clients" value={projectSummary.uniqueClients} /><MetricCard label="Approved Value" value={compactMoney(currency, projectSummary.approvedValue)} /><MetricCard label="Pending Quoted Value" value={compactMoney(currency, projectSummary.pendingQuotedValue)} /><MetricCard label="Approval Rate" value={winRate} /><MetricCard label="Average Quotation Value" value={compactMoney(currency, projectSummary.averageQuotedValue)} /><MetricCard label="Average Approved Value" value={compactMoney(currency, projectSummary.averageApprovedValue)} /></> : <><MetricCard label="Unique Projects Worked On" value={projectSummary.uniqueProjects} /><MetricCard label="Options Prepared" value={optionsPrepared} /><MetricCard label="Prepared Quoted Value" value={compactMoney(currency, projectSummary.quotedValue)} />{projectSummary.approvedValue > 0 ? <MetricCard label="Approved value of quotations you prepared" value={compactMoney(currency, projectSummary.approvedValue)} /> : null}</>}
      </div>
      {!isSalesDesigner ? <p className="mt-3 text-xs text-zinc-500">Prepared values show the value of unique quotation folders you worked on. They do not represent sales ownership or commission. Commercial ownership and commission remain with the assigned Sales Manager.</p> : <p className="mt-3 text-xs text-zinc-500">Commercial values and commission are based on assigned and approved Sales Manager ownership.</p>}

      {/* Section 2 — Pipeline Breakdown (sales_designer + system_owner) */}
      {/* Section 3A — Sales Designer view */}
      {isSalesDesigner ? (
        <>
          <MonthlyChart
            monthlyData={monthlyData}
            title="My Commercially Owned Quotations"
            currency={currency}
            totalValue={totalValue}
          />
          <TopClientsTable topClients={topClients} currency={currency} />
        </>
      ) : null}

      {/* Section 3B — Management view (system_owner or admin_manager) */}
      {/* Viewer / unknown role — stats + activity only */}
      </details> : null}

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 p-2">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setActiveTab(key)} className={`rounded-md px-3 py-2 text-sm font-semibold ${activeTab === key ? "bg-emerald-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="p-5">
          {activeTab === "quotations" ? (
            workQuotations.length > 0
              ? <QuotationsTable recentQuotations={workQuotations} currency={currency} showValue={isSalesDesigner} title={isSalesDesigner ? "My Recently Owned Quotations" : "My Recently Prepared Quotations"} />
              : <p className="text-sm text-zinc-500">No attributed quotations for this period.</p>
          ) : null}
          {activeTab === "projects" ? <ProjectsTable projects={projects} title={isSalesDesigner ? "Commercial Ownership" : "Projects I Worked On"} /> : null}
          {activeTab === "pipeline" ? <PipelineBreakdown allQuotations={allQuotations} /> : null}
          {activeTab === "sales_activity" ? <ActivityFeed title="Activity on My Sales" description="Work by any team member on quotations you commercially own." recentActivity={salesActivity} showActor /> : null}
          {activeTab === "commission" ? <CommissionPanel commissions={commissions} /> : null}
          {activeTab === "personal_activity" ? <ActivityFeed title="My Personal Activity" description="Audit activity performed by you, regardless of commercial ownership." recentActivity={recentActivity} /> : null}
          {activeTab === "products" ? <ActivityFeed title="Product and material contribution" description="Reliable product, brand, price, and material audit events performed by you." recentActivity={productActivity} /> : null}
          {activeTab === "documents" ? <ActivityFeed title="Document contribution" description="Document setup and project-file audit events performed by you." recentActivity={documentActivity} /> : null}
          {activeTab === "activity" ? (
            <div className="grid gap-6 2xl:grid-cols-2">
              {isSalesDesigner ? <ActivityFeed title="Activity on My Sales" description="Work by any team member on quotations you commercially own." recentActivity={salesActivity} showActor /> : null}
              <ActivityFeed title="My Operational Activity" description="Audit activity performed by you, regardless of commercial ownership." recentActivity={recentActivity} />
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
