"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Building2,
  ChevronRight,
  FileText,
  Library,
  PackageSearch,
  Plus,
  ReceiptText,
  Users,
} from "lucide-react";
import type { DashboardAlert } from "@/components/dashboard/alerts-panel";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { KPIWidget } from "@/components/dashboard/kpi-widget";
import { MonthlyBarChart } from "@/components/dashboard/dashboard-charts";
import type { AppRole } from "@/lib/supabase/types";
import {
  getProjectRecentActivity,
  type ActivityEntry,
  type DashboardProject,
  type DashboardSalesData,
  type DashboardStats,
  type MonthlyTotal,
} from "@/lib/dashboard/actions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAED(amount: number): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(amount);
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Module shortcuts ─────────────────────────────────────────────────────────

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  stats: DashboardStats;
  projects: DashboardProject[];
  salesData: DashboardSalesData;
  monthlyData: MonthlyTotal[];
  hrAlerts?: DashboardAlert[];
  role: AppRole | null;
  canAccessProcurement: boolean;
  canManageProducts: boolean;
  canSendNotifications: boolean;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ERPDashboard({
  stats,
  projects,
  salesData,
  monthlyData,
  hrAlerts,
  role,
  canAccessProcurement,
  canManageProducts,
  canSendNotifications,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrderNo, setExpandedOrderNo] = useState<string | null>(null);
  const [expandedActivity, setExpandedActivity] = useState<ActivityEntry[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // ── KPI sparkline data ───────────────────────────────────────────────────
  const attentionCount = stats.pendingQuotations + (hrAlerts?.length ?? 0);
  const kpis = [
    {
      label: "Active Projects",
      value: String(stats.activeProjects),
      description: "Currently in-progress projects.",
      trend: "From confirmed project files",
      href: "/projects/orders",
      icon: Building2,
      accent: "bg-emerald-100 text-emerald-700",
      cardBg: "bg-emerald-50",
    },
    {
      label: "Pending Quotations",
      value: String(stats.pendingQuotations),
      description: "Active folders awaiting completion.",
      trend: "Counts each quotation folder once",
      href: "/sales/quotations",
      icon: FileText,
      accent: "bg-indigo-100 text-indigo-700",
      cardBg: "bg-indigo-50",
    },
    {
      label: "Confirmed Value",
      value: formatAED(salesData.yearlyTurnover),
      description: `From ${salesData.dealCount} confirmed project${salesData.dealCount !== 1 ? "s" : ""}.`,
      trend: `Calendar year ${new Date().getFullYear()}`,
      href: "/sales/approvals",
      icon: BadgeCheck,
      accent: "bg-blue-100 text-blue-700",
      cardBg: "bg-blue-50",
    },
    {
      label: "Attention Items",
      value: String(attentionCount),
      description: "Verified items requiring follow-up.",
      trend: attentionCount ? "Review the list below" : "Nothing urgent right now",
      href: "#attention-required",
      icon: AlertTriangle,
      accent: "bg-amber-100 text-amber-700",
      cardBg: "bg-amber-50",
    },
  ];

  // ── Pipeline filter ───────────────────────────────────────────────────────
  const filteredProjects = projects.filter(
    (p) =>
      !searchQuery ||
      p.orderNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.reference.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  async function handleRowClick(orderNo: string) {
    if (expandedOrderNo === orderNo) {
      setExpandedOrderNo(null);
      setExpandedActivity(null);
      return;
    }
    setExpandedOrderNo(orderNo);
    setExpandedActivity(null);
    setActivityLoading(true);
    const activity = await getProjectRecentActivity(orderNo);
    setExpandedActivity(activity);
    setActivityLoading(false);
  }

  // ── Sales performance — max total for progress bar scaling ────────────────
  const attributed = salesData.salesByPerson.filter((p) => p.salesperson_id !== null);
  const maxTotal = attributed[0]?.total ?? salesData.salesByPerson[0]?.total ?? 1;
  const quickActions = [
    { label: "New Quotation", href: "/sales/quotations", icon: Plus, visible: role !== null && role !== "viewer" },
    { label: "Add Product", href: "/products/manage", icon: Library, visible: canManageProducts },
    { label: "Clients", href: "/sales/clients", icon: Users, visible: true },
    { label: "Procurement", href: "/procurement/orders", icon: PackageSearch, visible: canAccessProcurement },
    { label: "Send Notification", href: "/notifications", icon: Bell, visible: canSendNotifications },
    { label: "Approved Quotations", href: "/sales/approvals", icon: ReceiptText, visible: true },
  ].filter((action) => action.visible);
  const attentionItems = [
    stats.pendingQuotations > 0
      ? {
          label: "Quotation folders awaiting completion",
          count: stats.pendingQuotations,
          href: "/sales/quotations",
          tone: "bg-amber-50 text-amber-700",
        }
      : null,
    hrAlerts && hrAlerts.length > 0
      ? {
          label: "HR and worker documents nearing expiry",
          count: hrAlerts.length,
          href: "/hr",
          tone: "bg-red-50 text-red-700",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);
  const workflowStages = [
    { label: "Draft", count: stats.quotationWorkflow.draft, status: "draft" },
    { label: "Ready to Send", count: stats.quotationWorkflow.readyToSend, status: "ready_to_send" },
    { label: "Sent to Client", count: stats.quotationWorkflow.sentToClient, status: "sent_to_client" },
    { label: "Client Approved", count: stats.quotationWorkflow.clientConfirmed, status: "client_confirmed" },
  ];

  return (
    <div className="grid gap-5 px-4 py-5 sm:px-6 lg:px-8">

      {/* ── KPI Row ─────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Link key={kpi.label} href={kpi.href} className="group">
            <KPIWidget
              label={kpi.label}
              value={kpi.value}
              description={kpi.description}
              trend={kpi.trend}
              icon={kpi.icon}
              accent={kpi.accent}
              cardBg={kpi.cardBg}
            />
          </Link>
        ))}
      </section>

      <section id="attention-required" className="grid gap-4 lg:grid-cols-2">
        <DashboardCard className="overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-950">Attention Required</p>
            <p className="mt-0.5 text-xs text-zinc-500">Verified items that need follow-up.</p>
          </div>
          {attentionItems.length ? (
            <div className="divide-y divide-zinc-100">
              {attentionItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-zinc-50"
                >
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${item.tone}`}>
                    {item.count}
                  </span>
                  <span className="flex-1 text-sm font-medium text-zinc-800">{item.label}</span>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="px-4 py-5 text-sm text-zinc-500">No urgent items requiring attention.</p>
          )}
        </DashboardCard>

        <DashboardCard className="overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-950">Quotation Workflow</p>
            <p className="mt-0.5 text-xs text-zinc-500">Latest active quotation in each folder.</p>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 sm:grid-cols-4 sm:divide-y-0">
            {workflowStages.map((stage) => (
              <Link
                key={stage.status}
                href={`/sales/quotations?status=${stage.status}`}
                className="px-3 py-3 transition hover:bg-zinc-50"
              >
                <p className="text-xl font-bold text-zinc-950">{stage.count}</p>
                <p className="mt-1 text-xs text-zinc-500">{stage.label}</p>
              </Link>
            ))}
          </div>
        </DashboardCard>
      </section>

      {/* ── Main content + sidebar ────────────────────────────────────────── */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">

        <div className="grid gap-5">

          {/* ── Module shortcuts ──────────────────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Quick Actions</p>
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800"
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {action.label}
                  </Link>
                );
              })}
            </div>
          </section>

          {/* ── Active Project Pipeline ──────────────────────────────────── */}
          <DashboardCard className="overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-zinc-950">Recent Work</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {projects.length} active project handoff{projects.length !== 1 ? "s" : ""}
                  {" — click a row to see recent activity"}
                </p>
              </div>
              <input
                type="text"
                placeholder="Filter orders…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-40 rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none"
              />
            </div>

            <div className="max-h-[320px] overflow-auto">
              {filteredProjects.length === 0 ? (
                <p className="px-4 py-5 text-center text-sm text-zinc-400">
                  {searchQuery ? "No projects match the filter." : "No active projects."}
                </p>
              ) : (
                <table className="w-full min-w-[480px] table-fixed border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-zinc-50 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    <tr>
                      <th className="w-[46%] border-b border-zinc-100 px-4 py-2.5">Project ID</th>
                      <th className="w-[14%] border-b border-zinc-100 px-4 py-2.5">Type</th>
                      <th className="w-[40%] border-b border-zinc-100 px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProjects.map((project) => {
                      const isExpanded = expandedOrderNo === project.orderNo;
                      return (
                        <tr
                          key={project.orderNo}
                          onClick={() => handleRowClick(project.orderNo)}
                          className={`cursor-pointer border-b border-zinc-50 transition-colors last:border-0 ${
                            isExpanded ? "bg-emerald-50" : "hover:bg-zinc-50"
                          }`}
                        >
                          <td className="px-4 py-3 align-top">
                            <p className="font-semibold text-zinc-950">{project.orderNo}</p>
                            <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                              {project.clientName}
                            </p>
                          </td>
                          <td className="px-4 py-3 align-top text-zinc-400">—</td>
                          <td className="px-4 py-3 align-top">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </DashboardCard>

          {expandedOrderNo && (
            <DashboardCard className="overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
                <p className="text-sm font-semibold text-zinc-950">
                  {expandedOrderNo} — Recent Activity
                </p>
                <Link
                  href={`/projects/orders/${encodeURIComponent(expandedOrderNo)}`}
                  className="shrink-0 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900"
                >
                  View Project →
                </Link>
              </div>
              <div className="px-4 py-3">
                {activityLoading && expandedActivity === null ? (
                  <p className="text-xs text-zinc-400">Loading…</p>
                ) : expandedActivity !== null && expandedActivity.length === 0 ? (
                  <p className="text-sm text-zinc-400">No activity logged yet.</p>
                ) : (
                  <div className="divide-y divide-zinc-100">
                    {(expandedActivity ?? []).map((entry) => (
                      <div key={entry.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug text-zinc-800">{entry.title}</p>
                          <time className="shrink-0 text-[11px] text-zinc-400">{relativeTime(entry.created_at)}</time>
                        </div>
                        {entry.description && (
                          <p className="mt-0.5 text-xs leading-snug text-zinc-500">{entry.description}</p>
                        )}
                        <p className="mt-1 text-[11px] text-zinc-400">by {entry.actorName ?? "System"}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DashboardCard>
          )}

        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <aside className="grid gap-4 xl:content-start">
          {canAccessProcurement ? (
            <Link href="/procurement/orders">
              <DashboardCard className="p-4 transition hover:border-blue-200 hover:shadow-md">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                    <PackageSearch className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-950">Procurement Workspace</p>
                    <p className="mt-0.5 text-xs text-zinc-500">Review purchasing and vendor progress.</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </div>
              </DashboardCard>
            </Link>
          ) : (
            <DashboardCard className="p-4">
              <p className="text-sm font-semibold text-zinc-950">Project Summary</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link href="/projects/orders" className="rounded-md bg-emerald-50 px-3 py-2">
                  <p className="text-lg font-bold text-emerald-800">{stats.activeProjects}</p>
                  <p className="text-xs text-emerald-700">Active</p>
                </Link>
                <Link href="/projects/completed" className="rounded-md bg-zinc-50 px-3 py-2">
                  <p className="text-lg font-bold text-zinc-800">{stats.completedProjects}</p>
                  <p className="text-xs text-zinc-500">Completed</p>
                </Link>
              </div>
            </DashboardCard>
          )}

          {/* Yearly Turnover */}
          <DashboardCard className="overflow-hidden p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Yearly Turnover ({new Date().getFullYear()})
            </p>
            <p className="mt-1.5 text-2xl font-bold text-zinc-950">
              {formatAED(salesData.yearlyTurnover)}
            </p>
            <div className="mt-3 -mx-4">
              <MonthlyBarChart data={monthlyData} color="#10b981" />
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              From {salesData.dealCount} confirmed project{salesData.dealCount !== 1 ? "s" : ""}
            </p>
          </DashboardCard>

          {/* Sales Performance */}
          <DashboardCard className="overflow-hidden">
            <div className="border-b border-zinc-100 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-950">Sales Performance</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Confirmed quotations this year, by salesperson
              </p>
            </div>

            {salesData.salesByPerson.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-zinc-400">
                No confirmed quotations this year yet.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-50 px-4 py-1">
                {salesData.salesByPerson.map((person) => {
                  const isUnattributed = person.salesperson_id === null;
                  const initials = person.full_name
                    .trim()
                    .split(" ")
                    .map((w) => w.charAt(0).toUpperCase())
                    .slice(0, 2)
                    .join("");
                  const barPct = maxTotal > 0 ? (person.total / maxTotal) * 100 : 0;

                  return (
                    <li
                      key={person.salesperson_id ?? "__unattributed__"}
                      className={`py-3 ${isUnattributed ? "opacity-70" : ""}`}
                    >
                      <div className="flex items-center gap-2.5">
                        {/* Avatar bubble */}
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            isUnattributed
                              ? "border border-dashed border-zinc-300 bg-zinc-100 text-zinc-400"
                              : "bg-emerald-700 text-white"
                          }`}
                        >
                          {isUnattributed ? "—" : initials || "?"}
                        </span>

                        {/* Name + deal count */}
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-xs font-medium ${
                              isUnattributed ? "italic text-zinc-400" : "text-zinc-800"
                            }`}
                          >
                            {person.full_name}
                          </p>
                          <p className="text-[10px] text-zinc-400">
                            {person.deal_count} deal{person.deal_count !== 1 ? "s" : ""}
                          </p>
                        </div>

                        {/* Total */}
                        <p className="shrink-0 text-xs font-semibold text-zinc-700">
                          {formatAED(person.total)}
                        </p>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                        <div
                          className={`h-1 rounded-full transition-all ${
                            isUnattributed ? "bg-zinc-300" : "bg-emerald-500"
                          }`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashboardCard>
        </aside>
      </section>
    </div>
  );
}
