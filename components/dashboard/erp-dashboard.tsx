"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  FileText,
  Library,
  PackageSearch,
  Plus,
  ReceiptText,
  Users,
  Wallet,
} from "lucide-react";
import type { DashboardAlert } from "@/components/dashboard/alerts-panel";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { KPIWidget } from "@/components/dashboard/kpi-widget";
import { MonthlyBarChart } from "@/components/dashboard/dashboard-charts";
import type { AppRole } from "@/lib/supabase/types";
import {
  getProjectRecentActivity,
  type ActivityEntry,
  type DashboardAttentionItem,
  type DashboardProcurementAttention,
  type DashboardProject,
  type DashboardSalesData,
  type DashboardStats,
  type MonthlyTotal,
  type UpcomingDelivery,
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

// ETA is a date-only business value (no timezone conversion) - parsing with an explicit midnight
// offset avoids any UTC-vs-local day shift when reading back a plain YYYY-MM-DD string.
function formatEtaDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const day = String(date.getDate()).padStart(2, "0");
  const month = date.toLocaleDateString("en", { month: "short" });
  return date.getFullYear() === new Date().getFullYear() ? `${day} ${month}` : `${day} ${month} ${date.getFullYear()}`;
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

// ─── Attention drill-down ─────────────────────────────────────────────────────

type AttentionCategory = {
  key: string;
  label: string;
  // Full tally shown on the badge - vendor-issue count for grouped Procurement categories, folder
  // count for pending quotations. Never used to decide "View all" (see totalCount).
  count: number;
  // Distinct entries `items` represents before the 5-row bound (e.g. distinct affected Projects
  // for a grouped Procurement category). Equals `count` for ungrouped categories.
  totalCount: number;
  items: DashboardAttentionItem[];
  tone: string;
  // Broad existing destination, used only for "View all N" when more records exist than are
  // shown, and as a safe fallback link if `items` is unexpectedly empty for a count > 0.
  fallbackHref: string;
};

// Inline expand/collapse row (Part 7/8/9): a plain button toggles visibility - never navigates -
// and each child record keeps its own exact link. One category open at a time (via the parent's
// single `expandedKey` state) keeps this the smallest implementation, no state library involved.
function AttentionCategoryRow({
  category,
  isExpanded,
  onToggle,
}: {
  category: AttentionCategory;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const hasMore = category.totalCount > category.items.length;
  return (
    <div>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
      >
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${category.tone}`}>{category.count}</span>
        <span className="flex-1 text-sm font-medium text-zinc-800">{category.label}</span>
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      </button>
      {isExpanded && (
        <div className="divide-y divide-zinc-100 bg-zinc-50/70 pl-4">
          {category.items.length === 0 ? (
            <p className="px-4 py-2 text-xs text-zinc-400">Details unavailable.</p>
          ) : (
            category.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="flex items-center gap-2 py-2 pr-4 transition hover:text-emerald-800"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-zinc-800">{item.primary}</span>
                  {item.secondary && (
                    <span className="block truncate text-[11px] text-zinc-500">{item.secondary}</span>
                  )}
                  {item.clientName && (
                    <span className="block truncate text-[11px] text-zinc-400">{item.clientName}</span>
                  )}
                  {item.tertiary && (
                    <span className="block truncate text-[10px] text-zinc-400">{item.tertiary}</span>
                  )}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
              </Link>
            ))
          )}
          {hasMore && (
            <Link
              href={category.fallbackHref}
              className="block py-2 pr-4 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900"
            >
              View all {category.totalCount} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
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
  procurementAttention: DashboardProcurementAttention | null;
  upcomingDeliveries: UpcomingDelivery[];
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
  procurementAttention,
  upcomingDeliveries,
}: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrderNo, setExpandedOrderNo] = useState<string | null>(null);
  const [expandedActivity, setExpandedActivity] = useState<ActivityEntry[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [expandedAttentionKey, setExpandedAttentionKey] = useState<string | null>(null);

  function handleAttentionNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    window.requestAnimationFrame(() => {
      const target = document.getElementById("attention-required");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
  }

  // ── KPI sparkline data ───────────────────────────────────────────────────
  const attentionCount = stats.pendingQuotations.count + (hrAlerts?.length ?? 0);
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
      value: String(stats.pendingQuotations.count),
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
      description: `From ${salesData.dealCount} client-confirmed quotation${salesData.dealCount !== 1 ? "s" : ""}.`,
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

  const projectValueKpis = [
    {
      label: "Active Project Value",
      value: formatAED(stats.activeProjectValue),
      description: `From ${stats.activeProjects} active project${stats.activeProjects !== 1 ? "s" : ""}.`,
      trend: "Confirmed project file value",
      href: "/projects/orders",
      icon: Wallet,
      accent: "bg-emerald-100 text-emerald-700",
      cardBg: "bg-emerald-50",
    },
    {
      label: "Completed Project Value",
      value: formatAED(stats.completedProjectValue),
      description: `From ${stats.completedProjects} completed project${stats.completedProjects !== 1 ? "s" : ""}.`,
      trend: "Confirmed project file value",
      href: "/procurement/completed",
      icon: CheckCircle2,
      accent: "bg-zinc-100 text-zinc-700",
      cardBg: "bg-zinc-50",
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
    { label: "Client Approvals", href: "/sales/approvals", icon: ReceiptText, visible: true },
  ].filter((action) => action.visible);
  // Management Dashboard Attention drill-down: categories sourced from the existing, already-
  // bounded aggregates (getDashboardStats()'s pendingQuotations group, and
  // getDashboardProcurementAttention() -> loadProcurementSummary) - never a second Attention
  // engine. Zero-count categories are omitted entirely, matching the panel's existing "nothing
  // urgent" convention below. Procurement categories only exist at all when `procurementAttention`
  // is non-null (the page only fetches it behind canAccessProcurement) - unauthorized roles never
  // see these rows or their child records.
  const procurementAttentionCategories: AttentionCategory[] = procurementAttention
    ? [
        procurementAttention.awaitingSupplierConfirmation.count > 0
          ? {
              key: "procurement-awaiting-confirmation",
              label: "Suppliers awaiting confirmation",
              count: procurementAttention.awaitingSupplierConfirmation.count,
              totalCount: procurementAttention.awaitingSupplierConfirmation.totalCount,
              items: procurementAttention.awaitingSupplierConfirmation.items,
              tone: "bg-amber-50 text-amber-700",
              fallbackHref: "/procurement/orders",
            }
          : null,
        procurementAttention.missingEta.count > 0
          ? {
              key: "procurement-missing-eta",
              label: "Vendors missing ETA",
              count: procurementAttention.missingEta.count,
              totalCount: procurementAttention.missingEta.totalCount,
              items: procurementAttention.missingEta.items,
              tone: "bg-amber-50 text-amber-700",
              fallbackHref: "/procurement/orders",
            }
          : null,
        procurementAttention.missingEtd.count > 0
          ? {
              key: "procurement-missing-etd",
              label: "Vendors missing ETD",
              count: procurementAttention.missingEtd.count,
              totalCount: procurementAttention.missingEtd.totalCount,
              items: procurementAttention.missingEtd.items,
              tone: "bg-amber-50 text-amber-700",
              fallbackHref: "/procurement/orders",
            }
          : null,
        procurementAttention.deliveredNotReceived.count > 0
          ? {
              key: "procurement-delivered-not-received",
              label: "Delivered, not yet received",
              count: procurementAttention.deliveredNotReceived.count,
              totalCount: procurementAttention.deliveredNotReceived.totalCount,
              items: procurementAttention.deliveredNotReceived.items,
              tone: "bg-amber-50 text-amber-700",
              fallbackHref: "/procurement/orders",
            }
          : null,
      ].filter((category): category is AttentionCategory => category !== null)
    : [];
  const attentionCategories: AttentionCategory[] = [
    stats.pendingQuotations.count > 0
      ? {
          key: "pending-quotations",
          label: "Quotation folders awaiting completion",
          totalCount: stats.pendingQuotations.totalCount,
          count: stats.pendingQuotations.count,
          items: stats.pendingQuotations.items,
          tone: "bg-amber-50 text-amber-700",
          fallbackHref: "/sales/quotations",
        }
      : null,
    ...procurementAttentionCategories,
  ].filter((category): category is AttentionCategory => category !== null);
  // HR alerts intentionally keep their prior simple navigate-on-click behavior (Part 5/10: "keep
  // HR alerts where they already belong") - this task's drill-down is scoped to Quotation/
  // Procurement categories only.
  const hrAttentionItem =
    hrAlerts && hrAlerts.length > 0
      ? { label: "HR and worker documents nearing expiry", count: hrAlerts.length, href: "/hr", tone: "bg-red-50 text-red-700" }
      : null;
  const workflowStages = [
    { label: "Draft", count: stats.quotationWorkflow.draft, status: "draft" },
    { label: "Ready to Send", count: stats.quotationWorkflow.readyToSend, status: "ready_to_send" },
    { label: "Sent to Client", count: stats.quotationWorkflow.sentToClient, status: "sent_to_client" },
    { label: "Client Confirmed · Project File Pending", count: stats.quotationWorkflow.clientConfirmedPending, status: "client_confirmed" },
    { label: "Client Approved · Owner Attribution Pending", count: stats.quotationWorkflow.ownerAttributionPending, status: "client_confirmed" },
    { label: "Client Approved", count: stats.quotationWorkflow.clientApproved, status: "client_confirmed" },
  ];

  return (
    <div className="grid gap-5 px-4 py-5 sm:px-6 lg:px-8">

      {/* ── KPI Row ─────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className="group"
            onClick={kpi.href === "#attention-required" ? handleAttentionNavigation : undefined}
          >
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

      {/* ── Project Value ───────────────────────────────────────────────── */}
      <section>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Project Value</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {projectValueKpis.map((kpi) => (
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
        </div>
      </section>

      <section
        id="attention-required"
        tabIndex={-1}
        className="scroll-mt-5 grid gap-4 rounded-lg outline-none transition target:ring-2 target:ring-amber-400 target:ring-offset-2 lg:grid-cols-2"
      >
        <DashboardCard className="overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-950">Attention Required</p>
            <p className="mt-0.5 text-xs text-zinc-500">Verified items that need follow-up.</p>
          </div>
          {attentionCategories.length || hrAttentionItem ? (
            <div className="divide-y divide-zinc-100">
              {attentionCategories.map((category) => (
                <AttentionCategoryRow
                  key={category.key}
                  category={category}
                  isExpanded={expandedAttentionKey === category.key}
                  onToggle={() =>
                    setExpandedAttentionKey((prev) => (prev === category.key ? null : category.key))
                  }
                />
              ))}
              {hrAttentionItem && (
                <Link
                  href={hrAttentionItem.href}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
                >
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${hrAttentionItem.tone}`}>
                    {hrAttentionItem.count}
                  </span>
                  <span className="flex-1 text-sm font-medium text-zinc-800">{hrAttentionItem.label}</span>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </Link>
              )}
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
          <div className="grid grid-cols-1 divide-y divide-zinc-100 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
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
      {/* Columns start together at `lg` (1024px) - the previous `2xl` (1536px) breakpoint meant
          the two columns stacked full-width on virtually every standard laptop screen, which is
          what produced the dead space below Quick Actions: the right rail never sat beside it. */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">

        <div className="grid gap-5">

          {/* ── Module shortcuts ──────────────────────────────────────────── */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Quick Actions</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-emerald-300 hover:text-emerald-800 sm:justify-start"
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
            <div className="flex flex-col items-stretch gap-3 border-b border-zinc-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
                className="h-8 w-full rounded-md border border-zinc-200 bg-white px-3 text-xs text-zinc-900 placeholder-zinc-400 focus:border-emerald-600 focus:outline-none sm:w-40"
              />
            </div>

            <div className="sm:max-h-[320px] sm:overflow-auto">
              {filteredProjects.length === 0 ? (
                <p className="px-4 py-5 text-center text-sm text-zinc-400">
                  {searchQuery ? "No projects match the filter." : "No active projects."}
                </p>
              ) : (
                <>
                  <div className="divide-y divide-zinc-100 sm:hidden">
                    {filteredProjects.map((project) => {
                      const isExpanded = expandedOrderNo === project.orderNo;
                      return (
                        <button
                          key={project.orderNo}
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => handleRowClick(project.orderNo)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                            isExpanded ? "bg-emerald-50" : "hover:bg-zinc-50"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-zinc-950">{project.orderNo}</span>
                            <span className="mt-0.5 block truncate text-xs text-zinc-500">{project.clientName}</span>
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <table className="hidden w-full min-w-[480px] table-fixed border-collapse text-left text-sm sm:table">
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
                </>
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
        <aside className="grid gap-4 lg:content-start">
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

          {/* Upcoming Deliveries - Part 14: hidden entirely (not just empty) for roles without
              Procurement access, same gate as the Attention drill-down's Procurement categories. */}
          {canAccessProcurement && (
            <DashboardCard className="overflow-hidden">
              <div className="border-b border-zinc-100 px-4 py-3">
                <p className="text-sm font-semibold text-zinc-950">Upcoming Deliveries</p>
                <p className="mt-0.5 text-xs text-zinc-500">Next vendor arrivals for active Projects.</p>
              </div>
              {upcomingDeliveries.length === 0 ? (
                <p className="px-4 py-5 text-sm text-zinc-500">No upcoming deliveries recorded.</p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {upcomingDeliveries.map((delivery) => (
                    <li key={`${delivery.orderNo}:${delivery.vendorLabel}`}>
                      <Link
                        href={delivery.href}
                        className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600"
                      >
                        <span className="w-14 shrink-0 text-xs font-semibold text-zinc-800">
                          {formatEtaDate(delivery.eta)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-zinc-800">{delivery.vendorLabel}</span>
                          <span className="block truncate text-[11px] text-zinc-500">
                            {delivery.projectName}
                            {delivery.clientName && ` · ${delivery.clientName}`}
                          </span>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
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
              From {salesData.dealCount} client-confirmed quotation{salesData.dealCount !== 1 ? "s" : ""}
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
