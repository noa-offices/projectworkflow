"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Building2,
  Cloud,
  Database,
  FileText,
  Library,
  PackageSearch,
  ReceiptText,
  Truck,
  Wifi,
} from "lucide-react";
import { AlertsPanel } from "@/components/dashboard/alerts-panel";
import type { DashboardAlert } from "@/components/dashboard/alerts-panel";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { KPIWidget } from "@/components/dashboard/kpi-widget";
import { KpiSparkline, MonthlyBarChart } from "@/components/dashboard/dashboard-charts";
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

const MODULE_SHORTCUTS = [
  {
    title: "Quotation Builder",
    description: "Create, price, and save client quotation workspaces.",
    href: "/quotations",
    icon: FileText,
  },
  {
    title: "Product Library",
    description: "Maintain templates, finishes, product images, and source pricing.",
    href: "/products",
    icon: Library,
  },
  {
    title: "Procurement",
    description: "Review supplier RFQs and purchasing work in progress.",
    href: "/procurement",
    icon: PackageSearch,
  },
  {
    title: "Order Confirmation",
    description: "Prepare client approval documents and order handoff details.",
    href: "/quotations",
    icon: ReceiptText,
  },
];

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  stats: DashboardStats;
  projects: DashboardProject[];
  salesData: DashboardSalesData;
  monthlyData: MonthlyTotal[];
  fetchedAt: string;
  hrAlerts?: DashboardAlert[];
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ERPDashboard({
  stats,
  projects,
  salesData,
  monthlyData,
  fetchedAt,
  hrAlerts,
}: Props) {
  const [online, setOnline] = useState(() =>
    typeof window === "undefined" ? true : window.navigator.onLine,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrderNo, setExpandedOrderNo] = useState<string | null>(null);
  const [expandedActivity, setExpandedActivity] = useState<ActivityEntry[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ── KPI sparkline data ───────────────────────────────────────────────────
  // Placeholder trend arrays — no historical time-series is stored.
  // Shape rises from 0 to currentValue over 4 points as an illustrative curve.
  function sparkData(v: number): number[] {
    return [0, Math.round(v / 3), Math.round((v * 2) / 3), v];
  }

  const kpis = [
    {
      label: "Active Projects",
      value: String(stats.activeProjects),
      description: "Currently in-progress projects.",
      trend: "From confirmed project files",
      icon: Building2,
      accent: "bg-emerald-100 text-emerald-700",
      cardBg: "bg-emerald-50",
      sparkColor: "#10b981",
      gradientId: "spark-active",
      sparkData: sparkData(stats.activeProjects),
    },
    {
      label: "Completed Projects",
      value: String(stats.completedProjects),
      description: "Successfully closed projects.",
      trend: "From confirmed project files",
      icon: Truck,
      accent: "bg-blue-100 text-blue-700",
      cardBg: "bg-blue-50",
      sparkColor: "#3b82f6",
      gradientId: "spark-completed",
      sparkData: sparkData(stats.completedProjects),
    },
    {
      label: "Pending Quotations",
      value: String(stats.pendingQuotations),
      description: "Quotations awaiting client approval.",
      trend: "Excludes confirmed and archived",
      icon: FileText,
      accent: "bg-indigo-100 text-indigo-700",
      cardBg: "bg-indigo-50",
      sparkColor: "#6366f1",
      gradientId: "spark-pending",
      sparkData: sparkData(stats.pendingQuotations),
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

  return (
    <div className="grid gap-5 px-4 py-5 sm:px-6 lg:px-8">

      {/* ── KPI Row ─────────────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-3">
        {kpis.map((kpi) => (
          <KPIWidget
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            description={kpi.description}
            trend={kpi.trend}
            icon={kpi.icon}
            accent={kpi.accent}
            cardBg={kpi.cardBg}
            sparkline={
              <KpiSparkline
                data={kpi.sparkData}
                color={kpi.sparkColor}
                gradientId={kpi.gradientId}
              />
            }
          />
        ))}
      </section>

      {/* ── Main content + sidebar ────────────────────────────────────────── */}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">

        <div className="grid gap-5">

          {/* ── Module shortcuts ──────────────────────────────────────────── */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {MODULE_SHORTCUTS.map((shortcut) => {
              const Icon = shortcut.icon;
              return (
                <Link key={shortcut.title} href={shortcut.href} className="group">
                  <DashboardCard className="h-full p-4 transition-shadow group-hover:shadow-md">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 transition-colors group-hover:bg-emerald-50 group-hover:text-emerald-800">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-sm font-semibold text-zinc-950">{shortcut.title}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{shortcut.description}</p>
                  </DashboardCard>
                </Link>
              );
            })}
          </section>

          {/* ── Active Project Pipeline ──────────────────────────────────── */}
          <DashboardCard className="overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-zinc-950">Active Project Pipeline</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {projects.length} active project{projects.length !== 1 ? "s" : ""}
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
                <p className="px-4 py-8 text-center text-sm text-zinc-400">
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

          {/* HR & Document Expiry Alerts */}
          {hrAlerts && hrAlerts.length > 0 ? (
            <AlertsPanel alerts={hrAlerts} />
          ) : null}

          {/* System Status */}
          <DashboardCard className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-950">System Status</p>
                <p className="mt-0.5 text-xs text-zinc-500">Connection state and data refresh.</p>
              </div>
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-md ${
                  online ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                <Database className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <dl className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-xs">
                <dt className="flex items-center gap-2 text-zinc-500">
                  <Wifi className="h-3.5 w-3.5" />
                  Status
                </dt>
                <dd className={`font-semibold ${online ? "text-emerald-700" : "text-amber-700"}`}>
                  {online ? "Online" : "Offline"}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-xs">
                <dt className="flex items-center gap-2 text-zinc-500">
                  <Cloud className="h-3.5 w-3.5" />
                  Last Refresh
                </dt>
                <dd className="font-semibold text-zinc-950">{relativeTime(fetchedAt)}</dd>
              </div>
            </dl>
          </DashboardCard>

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
