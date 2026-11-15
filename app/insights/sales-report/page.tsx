import Link from "next/link";
import type { ReactNode } from "react";
import { loadProjectContractTotals, projectContractQuotationIds, projectContractValue } from "@/lib/projects/project-contract-total";
import { projectWiseApprovedRows, type ProjectWiseRow } from "@/lib/projects/project-wise-approved";
import { Suspense } from "react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ListPageSkeleton } from "@/components/layout/list-page-skeleton";
import { AmountModeToggle } from "@/components/insights/amount-mode-toggle";
import { DateRangeSelector } from "@/components/insights/date-range-selector";
import { TeamMemberDialog } from "@/components/insights/team-member-dialog";
import { TeamMemberEmptyState } from "@/components/insights/team-member-states";
import { teamMemberNeighbours } from "@/lib/insights/team-member-dialog";
import { SalesPerformanceCharts } from "@/components/insights/sales-performance-charts";
import { SalesRepSparkline } from "@/components/insights/sales-rep-sparkline";
import { ResolvedAvatar } from "@/components/ui/resolved-avatar";
import { requireActiveUser } from "@/lib/auth";
import {
  actualApprovedQuotationsByFolder,
  latestPrimaryQuotationsByFolder,
  quotationSalesFolderKey,
} from "@/lib/quotations/sales-attribution";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTeamStats, loadProfileStatsForUser } from "@/lib/settings/profile-stats-loader";
import type { TeamMemberStat } from "@/lib/settings/profile-stats-loader";
import type { AggMonthPoint, RepSeriesData } from "@/components/insights/sales-performance-charts";
import { DATE_RANGE_OPTIONS, getRangeStart, resolveDateRange } from "@/lib/insights/date-ranges";
import { formatSalesReportAED, type AmountMode } from "@/lib/insights/sales-report-money";

export const dynamic = "force-dynamic";

// ─── Row types ────────────────────────────────────────────────────────────────

type QuotationRow = {
  id: string;
  quotation_no: string | null;
  option_no: number | null;
  revision_no: number | null;
  approved_salesperson_id: string | null;
  salesperson_id: string | null;
  status: string;
  grand_total: number;
  currency: string;
  created_at: string;
  status_updated_at: string | null;
  layout_settings: unknown;
};

type SalespersonProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

// ─── Date range helpers ───────────────────────────────────────────────────────


function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(
    new Date(year, month - 1, 1),
  );
}

// All month keys (YYYY-MM strings) inclusive between from and to
function getMonthKeys(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (d <= end) {
    keys.push(monthKey(d));
    d.setMonth(d.getMonth() + 1);
  }
  return keys;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function roleLabel(role: string | null): string {
  switch (role) {
    case "system_owner": return "System Owner";
    case "admin_manager": return "Admin Manager";
    case "procurement_manager": return "Procurement Manager";
    case "sales_designer": return "Sales Manager";
    case "sales_coordinator": return "Sales Coordinator";
    case "designer": return "Designer";
    case "viewer": return "Viewer";
    case "warehouse_staff": return "Warehouse Staff";
    default: return "Unknown";
  }
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

function statusBadgeClass(status: string): string {
  if (status === "client_confirmed") return "bg-emerald-100 text-emerald-800";
  if (status === "sent_to_client" || status === "ready_to_send") return "bg-blue-100 text-blue-800";
  if (status === "draft") return "bg-zinc-100 text-zinc-600";
  return "bg-amber-100 text-amber-800";
}

// ─── Inline server components ─────────────────────────────────────────────────

const KPI_ICONS = {
  quotes: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  quoted: "M12 3v18M16 7.5c0-1.4-1.8-2.5-4-2.5s-4 1.1-4 2.5S9.8 10 12 10s4 1.1 4 2.5S14.2 15 12 15s-4-1.1-4-2.5",
  approved: "M5 12.5l4.5 4.5L19 7.5",
  conversion: "M4 19l5-6 4 3 7-9M15 7h5v5",
} as const;

function KpiCard({
  label,
  icon,
  footer,
  children,
}: {
  label: string;
  icon: keyof typeof KPI_ICONS;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition duration-200 hover:border-emerald-200 hover:shadow-md motion-safe:hover:-translate-y-0.5">
      <div className="p-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-800">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={KPI_ICONS[icon]} />
            </svg>
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
        </div>
        {children}
      </div>
      {footer ? <div className="mt-auto">{footer}</div> : null}
    </div>
  );
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const positive = value >= 0;
  return (
    <span
      className={`mt-1.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        positive
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-red-700"
      }`}
    >
      {positive ? "▲" : "▼"} {fmtPct(value)}
    </span>
  );
}

type LeaderboardRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  totalQuotes: number;
  totalQuotedAmount: number;
  approvedCount: number;
  approvedAmount: number;
  approvalRate: number;
  currentRank: number;
  priorRank: number | null;
};

const REP_COLORS = ["#14532d", "#5b21b6", "#b45309", "#075985", "#9f1239", "#0f766e"];

function SalesLeaderboard({
  rangeLabel,
  rows,
  amountMode,
}: {
  rangeLabel: string;
  rows: LeaderboardRow[];
  amountMode: AmountMode;
}) {
  const maxAmount = rows[0]?.approvedAmount ?? 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Top Sales Performers
        </h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">{rangeLabel}</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-400">
          No Client Approved deals in this period.
        </p>
      ) : (
        <div className="divide-y divide-zinc-50">
          {rows.map((row, i) => {
            const barPct = Math.min(
              100,
              Math.max(0, maxAmount > 0 ? (row.approvedAmount / maxAmount) * 100 : 0),
            );
            const color = REP_COLORS[i % REP_COLORS.length];
            const initial = row.name.trim().charAt(0).toUpperCase() || "?";

            // Rank trend: positive = moved up (improved), negative = moved down
            const rankTrend =
              row.priorRank !== null ? row.priorRank - row.currentRank : null;

            return (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {/* Rank number */}
                  <span className="w-4 shrink-0 text-right text-[10px] font-semibold text-zinc-400">
                    {row.currentRank}
                  </span>

                  {/* Avatar */}
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    <ResolvedAvatar
                      path={row.avatarUrl}
                      alt={row.name}
                      className="h-full w-full object-cover"
                      fallback={initial}
                    />
                  </div>

                  {/* Name + conversion rate */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-800">{row.name}</p>
                    <p className="text-[10px] text-zinc-400">
                      {(row.approvalRate * 100).toFixed(0)}% conversion
                    </p>
                  </div>

                  {/* Approved amount */}
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-semibold text-zinc-700">
                      {formatSalesReportAED(row.approvedAmount, amountMode)}
                    </p>
                    {/* Rank trend */}
                    <p className="text-[10px]">
                      {rankTrend === null || rankTrend === 0 ? (
                        <span className="text-zinc-400">—</span>
                      ) : rankTrend > 0 ? (
                        <span className="font-semibold text-emerald-600">▲{rankTrend}</span>
                      ) : (
                        <span className="font-semibold text-red-600">▼{Math.abs(rankTrend)}</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-2 ml-6 h-1 w-[calc(100%_-_1.5rem)] max-w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-1 max-w-full rounded-full transition-all"
                    style={{ width: `${barPct}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function aedFull(value: number, amountMode: AmountMode = "millions") {
  // Default keeps the existing two-decimal contract values; Full AED shows whole numbers.
  if (amountMode === "full") return formatSalesReportAED(value, "full", { includeCurrency: false });
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ProjectWiseApprovedTable({ rows, salespersonName, rangeLabel, amountMode }: { rows: ProjectWiseRow[]; salespersonName: (id: string | null) => string; rangeLabel: string; amountMode: AmountMode }) {
  const total = rows.reduce((sum, row) => sum + row.currentContract, 0);
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Project-wise approved value</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{rangeLabel} · One row per Project File. Current contract value includes variations.</p>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-zinc-400">No approved Projects in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project no</th>
                <th className="px-3 py-2.5 font-medium">Folder</th>
                <th className="px-3 py-2.5 font-medium">Client</th>
                <th className="px-3 py-2.5 font-medium">Reference</th>
                <th className="px-3 py-2.5 font-medium">Salesperson</th>
                <th className="px-3 py-2.5 text-right font-medium">Quoted</th>
                <th className="px-3 py-2.5 text-right font-medium">Original contract</th>
                <th className="px-3 py-2.5 text-right font-medium">Variations</th>
                <th className="px-3 py-2.5 text-right font-medium">Current contract value</th>
                <th className="px-3 py-2.5 font-medium">Approved date</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.quotationId}>
                  <td className="px-4 py-3 font-medium text-zinc-950">{row.projectNo}</td>
                  <td className="px-3 py-3 text-zinc-600">{row.folder}</td>
                  <td className="px-3 py-3 text-zinc-800">{row.client}</td>
                  <td className="px-3 py-3 text-zinc-600">{row.reference}</td>
                  <td className="px-3 py-3 text-zinc-800">{salespersonName(row.salespersonId)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{aedFull(row.quoted, amountMode)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{aedFull(row.originalContract, amountMode)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{row.variations === null ? "" : `${row.variations > 0 ? "+" : ""}${aedFull(row.variations, amountMode)}`}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums text-zinc-950">{aedFull(row.currentContract, amountMode)}</td>
                  <td className="px-3 py-3 text-zinc-600">{row.approvedDate.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-zinc-800">{row.status}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-50 text-sm font-semibold text-zinc-950">
              <tr>
                <td className="px-4 py-3" colSpan={8}>Total (AED)</td>
                <td className="px-3 py-3 text-right tabular-nums">{aedFull(total, amountMode)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function SalesTeamPerformanceTable({
  rows,
  rangeLabel,
  canOpenDetails,
  hrefForUser,
  amountMode,
}: {
  rows: LeaderboardRow[];
  rangeLabel: string;
  canOpenDetails: boolean;
  hrefForUser: (userId: string) => string;
  amountMode: AmountMode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Sales Team Performance</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            {rangeLabel}
            {canOpenDetails ? " · Select a sales person to view their activity profile." : ""}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-zinc-400">No sales activity in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Sales person</th>
                <th className="px-3 py-2.5 text-right font-medium">Quotes</th>
                <th className="px-3 py-2.5 text-right font-medium">Quoted</th>
                <th className="px-3 py-2.5 text-right font-medium">Client Approved</th>
                <th className="px-3 py-2.5 text-right font-medium">Client Approved value</th>
                <th className="px-4 py-2.5 text-right font-medium">Conversion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row, index) => (
                <tr key={row.id} className={canOpenDetails ? "hover:bg-emerald-50/50" : undefined}>
                  <td className="px-4 py-3">
                    {canOpenDetails ? (
                      <Link
                        className="flex items-center gap-2.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                        href={hrefForUser(row.id)}
                      >
                        <span className="w-5 text-center text-xs font-semibold text-zinc-400">
                          {index + 1}
                        </span>
                        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">
                          <ResolvedAvatar
                            path={row.avatarUrl}
                            alt={row.name}
                            className="h-full w-full object-cover"
                            fallback={row.name.trim().charAt(0).toUpperCase() || "?"}
                          />
                        </span>
                        <span className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                          {row.name}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 text-center text-xs font-semibold text-zinc-400">
                          {index + 1}
                        </span>
                        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600">
                          <ResolvedAvatar
                            path={row.avatarUrl}
                            alt={row.name}
                            className="h-full w-full object-cover"
                            fallback={row.name.trim().charAt(0).toUpperCase() || "?"}
                          />
                        </span>
                        <span className="font-medium text-zinc-900">{row.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-700">{row.totalQuotes}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-700">
                    {formatSalesReportAED(row.totalQuotedAmount, amountMode)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-700">{row.approvedCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium text-zinc-900">
                    {formatSalesReportAED(row.approvedAmount, amountMode)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
                    {(row.approvalRate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const STAFF_DETAIL_TABS = ["quotations", "products", "clients", "documents"] as const;
type StaffDetailTab = (typeof STAFF_DETAIL_TABS)[number];

type StaffActivityEntry = {
  id: string;
  action: string;
  title: string;
  description: string | null;
  entity_type: string;
  created_at: string;
};

function StaffActivityList({
  emptyMessage,
  entries,
}: {
  emptyMessage: string;
  entries: StaffActivityEntry[];
}) {
  if (entries.length === 0) {
    return <p className="py-5 text-center text-xs text-zinc-400">{emptyMessage}</p>;
  }

  return (
    <div className="divide-y divide-zinc-100">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 py-2.5">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-zinc-950">{entry.title}</p>
            {entry.description ? (
              <p className="mt-0.5 text-[11px] text-zinc-400">{entry.description}</p>
            ) : null}
          </div>
          <p className="shrink-0 text-[11px] text-zinc-400">
            {relativeTime(entry.created_at)}
          </p>
        </div>
      ))}
    </div>
  );
}

function activityCount(value: number | null) {
  return value === null ? "Unavailable" : value.toLocaleString("en-US");
}

type PageProps = {
  searchParams?: Promise<{
    detailTab?: string;
    from?: string;
    amount?: string;
    range?: string;
    teamView?: string;
    to?: string;
    user?: string;
  }>;
};

export default async function SalesReportPage({ searchParams }: PageProps) {
  // Auth, status checks and redirects run here, before the Suspense boundary.
  const auth = await requireActiveUser();
  const { user, profile, displayName } = auth;

  return (
    <ErpAppShell
      eyebrow="INSIGHTS"
      title="Sales Report"
      description="Project File-qualified approvals, quoted value, and conversion per sales person."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <Suspense fallback={<ListPageSkeleton />}>
        <SalesReportContent searchParams={searchParams} auth={auth} />
      </Suspense>
    </ErpAppShell>
  );
}

async function SalesReportContent({ searchParams, auth }: PageProps & { auth: Awaited<ReturnType<typeof requireActiveUser>> }) {
  const { profile } = auth;
  const supabase = await createSupabaseClient();

  // ── Range param ─────────────────────────────────────────────────────────────
  const resolved = await searchParams;
  const rawRange = resolved?.range;
  const rawUser = resolved?.user;
  const teamView = resolved?.teamView === "commercial" ? "commercial" : "contribution";
  const rawDetailTab = resolved?.detailTab ?? "quotations";
  const detailTab: StaffDetailTab = (STAFF_DETAIL_TABS as readonly string[]).includes(rawDetailTab)
    ? (rawDetailTab as StaffDetailTab)
    : "quotations";
  // ── Date boundaries ─────────────────────────────────────────────────────────
  const now = new Date();
  const { range, from: rangeStart, to: rangeEnd, validCustom: hasValidCustomRange } = resolveDateRange(rawRange, resolved?.from, resolved?.to, now);
  const rangeLabel = hasValidCustomRange
    ? `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(rangeStart)} – ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(rangeEnd)}`
    : DATE_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? "Last 6 months";
  const amountMode: AmountMode = resolved?.amount === "full" ? "full" : "millions";
  const baseReportParams = new URLSearchParams({ range });
  baseReportParams.set("teamView", teamView);
  if (amountMode === "full") baseReportParams.set("amount", "full");
  if (hasValidCustomRange && resolved?.from && resolved?.to) {
    baseReportParams.set("from", resolved.from);
    baseReportParams.set("to", resolved.to);
  }
  function reportHref(params: Record<string, string> = {}) {
    const next = new URLSearchParams(baseReportParams);
    for (const [key, value] of Object.entries(params)) {
      next.set(key, value);
    }
    return `?${next.toString()}`;
  }
  // Prior period: same duration, immediately before rangeStart
  const priorStart =
    range === "custom" || range === "ytd"
      ? new Date(rangeStart.getTime() - (rangeEnd.getTime() - rangeStart.getTime()))
      : getRangeStart(range, rangeStart);
  const priorEnd = rangeStart;

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const adminResult = createAdminClient();
  if (!adminResult.client) throw new Error(adminResult.error ?? "Admin client unavailable");
  const adminClient = adminResult.client;

  const teamDateRange = { from: rangeStart.toISOString(), to: rangeEnd.toISOString() };
  const [{ data: quotations }, { data: salespersonProfiles }, teamStats] = await Promise.all([
    supabase
      .from("quotations")
      .select(
        "id,quotation_no,option_no,revision_no,approved_salesperson_id,salesperson_id,status,grand_total,currency,created_at,status_updated_at,layout_settings",
      )
      .returns<QuotationRow[]>(),
    adminClient
      .from("profiles")
      .select("id,full_name,email,avatar_url")
      .eq("role", "sales_designer")
      .eq("account_status", "active")
      .order("full_name", { ascending: true })
      .returns<SalespersonProfileRow[]>(),
    profile?.role === "system_owner"
      ? loadTeamStats(teamDateRange)
      : Promise.resolve(null),
  ]);

  const allQuotationRows = quotations ?? [];
  const contractStates = await loadProjectContractTotals(supabase, projectContractQuotationIds(allQuotationRows));
  const allProfiles = salespersonProfiles ?? [];

  // ── Selected user (Team Overview drill-down) ─────────────────────────────────
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const selectedUserId =
    rawUser &&
    UUID_RE.test(rawUser) &&
    profile?.role === "system_owner" &&
    teamStats != null &&
    teamStats.some((m) => m.userId === rawUser)
      ? rawUser
      : null;

  const selectedUserInfo = teamStats?.find((m) => m.userId === selectedUserId) ?? null;
  const visibleTeamStats = teamView === "commercial"
    ? (teamStats ?? [])
      .filter((member) => member.role === "sales_designer")
      .sort((left, right) => right.totalValue - left.totalValue)
    : teamStats ?? [];
  const selectedUserStats = selectedUserId
    ? await loadProfileStatsForUser(selectedUserId, teamDateRange, selectedUserInfo?.role ?? null)
    : null;
  const selectedUsesPreparationAttribution = [
    "sales_coordinator",
    "designer",
  ].includes(selectedUserInfo?.role ?? "");
  const selectedUsesOperationalAttribution = selectedUserInfo?.role !== "sales_designer" &&
    !selectedUsesPreparationAttribution;
  const selectedRecentActivity = selectedUserStats?.recentActivity ?? [];
  const selectedProductActivity = selectedRecentActivity.filter(
    (entry) =>
      entry.entity_type.startsWith("product_template") ||
      entry.entity_type === "brand" ||
      entry.entity_type === "brand_price_list_update" ||
      entry.action === "quotation_item_added",
  );
  const selectedClientActivity = selectedRecentActivity.filter(
    (entry) => entry.action === "enquiry_details_updated",
  );
  const selectedDocumentActivity = selectedRecentActivity.filter((entry) =>
    [
      "document_setup_updated",
      "project_file_created",
      "confirmed_order_project_created",
    ].includes(entry.action),
  );
  const hasSelectedTrend = selectedUserStats?.monthlyData.some(
    (month) => month.total > 0 || month.approved > 0,
  ) ?? false;
  const selectedHasNoData = selectedUserStats != null && selectedUserInfo != null &&
    !hasSelectedTrend &&
    selectedUserStats.totalQuotations === 0 &&
    selectedUserStats.recentQuotations.length === 0 &&
    selectedRecentActivity.length === 0 &&
    selectedUserInfo.recordsWorkedOn === 0 &&
    selectedUserInfo.activityCount === 0;
  const selectedNeighbours = selectedUserId
    ? teamMemberNeighbours(visibleTeamStats.map((member) => member.userId), selectedUserId)
    : null;
  // Display only: which row gets the top-performer badge and how wide each contribution bar is.
  const maxContribution = Math.max(0, ...visibleTeamStats.map((member) => member.contributionValue ?? 0));
  const topMemberId = teamView === "commercial"
    ? visibleTeamStats[0]?.userId ?? null
    : maxContribution > 0
      ? visibleTeamStats.find((member) => member.contributionValue === maxContribution)?.userId ?? null
      : null;
  const selectedPosition =selectedNeighbours && selectedNeighbours.index >= 0
    ? `${selectedNeighbours.index + 1} of ${selectedNeighbours.total}`
    : null;

  // ── Approved definition ──────────────────────────────────────────────────────
  const quotedQuotations = latestPrimaryQuotationsByFolder(allQuotationRows);
  const approvedQuotations = actualApprovedQuotationsByFolder(allQuotationRows);

  const quotedTotalByFolder = new Map(quotedQuotations.map((q) => [quotationSalesFolderKey(q), q.grand_total ?? 0]));
  const salespersonNames = new Map(allProfiles.map((p) => [p.id, p.full_name?.trim() || p.email?.trim() || "Unknown"]));

  // ── Period filtering (by created_at) ────────────────────────────────────────
  const currentQuotes = quotedQuotations.filter((q) => {
    const createdAt = new Date(q.created_at);
    return createdAt >= rangeStart && createdAt <= rangeEnd;
  });
  const priorQuotes = quotedQuotations.filter((q) => {
    const d = new Date(q.created_at);
    return d >= priorStart && d < priorEnd;
  });
  const currentApproved = approvedQuotations.filter((q) => {
    const createdAt = new Date(q.created_at);
    return createdAt >= rangeStart && createdAt <= rangeEnd;
  });
  const priorApproved = approvedQuotations.filter((q) => {
    const d = new Date(q.created_at);
    return d >= priorStart && d < priorEnd;
  });

  const projectWiseRows = projectWiseApprovedRows(currentApproved, quotedTotalByFolder, quotationSalesFolderKey, contractStates)
    .filter((row) => !selectedUserId || row.salespersonId === selectedUserId);

  // ── Company-wide KPI totals ──────────────────────────────────────────────────
  const kpiCurrent = {
    totalQuotes: currentQuotes.length,
    totalQuotedAmount: currentQuotes.reduce((s, q) => s + (q.grand_total ?? 0), 0),
    approvedCount: currentApproved.length,
    approvedAmount: currentApproved.reduce((s, q) => s + projectContractValue(q, contractStates), 0),
  };
  const kpiPrior = {
    totalQuotes: priorQuotes.length,
    totalQuotedAmount: priorQuotes.reduce((s, q) => s + (q.grand_total ?? 0), 0),
    approvedCount: priorApproved.length,
    approvedAmount: priorApproved.reduce((s, q) => s + projectContractValue(q, contractStates), 0),
  };

  const conversionCurrent =
    kpiCurrent.totalQuotes > 0
      ? (kpiCurrent.approvedCount / kpiCurrent.totalQuotes) * 100
      : 0;
  const conversionPrior =
    kpiPrior.totalQuotes > 0
      ? (kpiPrior.approvedCount / kpiPrior.totalQuotes) * 100
      : 0;

  // ── Month keys for selected range ────────────────────────────────────────────
  const monthKeys = getMonthKeys(rangeStart, rangeEnd);

  // ── Aggregate monthly breakdown (for bar chart + KPI sparklines) ─────────────
  const aggQuotedByMonth = new Map<string, number>(monthKeys.map((k) => [k, 0]));
  const aggApprovedByMonth = new Map<string, number>(monthKeys.map((k) => [k, 0]));

  for (const q of currentQuotes) {
    const k = monthKey(new Date(q.created_at));
    if (aggQuotedByMonth.has(k)) {
      aggQuotedByMonth.set(k, (aggQuotedByMonth.get(k) ?? 0) + (q.grand_total ?? 0));
    }
  }

  for (const q of currentApproved) {
    const k = monthKey(new Date(q.created_at));
    if (aggApprovedByMonth.has(k)) {
      aggApprovedByMonth.set(k, (aggApprovedByMonth.get(k) ?? 0) + projectContractValue(q, contractStates));
    }
  }

  const aggMonthData: AggMonthPoint[] = monthKeys.map((k) => ({
    month: monthLabel(k),
    quoted: aggQuotedByMonth.get(k) ?? 0,
    approved: aggApprovedByMonth.get(k) ?? 0,
  }));

  // Sparkline data arrays for KPI tiles 2 and 3
  const kpiQuotedSparkline = aggMonthData.map((m) => m.quoted);
  const kpiApprovedSparkline = aggMonthData.map((m) => m.approved);

  // ── Per-rep stats ────────────────────────────────────────────────────────────
  type RepStat = {
    id: string;
    name: string;
    avatarUrl: string | null;
    totalQuotes: number;
    totalQuotedAmount: number;
    approvedCount: number;
    currentApprovedAmount: number;
    approvalRate: number;
    priorApprovedAmount: number;
    monthlyApproved: Array<{ month: string; value: number }>;
  };

  const repStats: RepStat[] = allProfiles.map((p) => {
    const repCurrent = currentQuotes.filter((q) => q.salesperson_id === p.id);
    const repCurrentApproved = currentApproved.filter((q) => q.approved_salesperson_id === p.id);
    const repPriorApproved = priorApproved.filter((q) => q.approved_salesperson_id === p.id);

    // Monthly approved for this rep (for sparkline + line chart)
    const monthMap = new Map<string, number>(monthKeys.map((k) => [k, 0]));
    for (const q of repCurrentApproved) {
      const k = monthKey(new Date(q.created_at));
      if (monthMap.has(k)) {
        monthMap.set(k, (monthMap.get(k) ?? 0) + projectContractValue(q, contractStates));
      }
    }

    const totalQuotes = repCurrent.length;
    const approvedCount = repCurrentApproved.length;
    return {
      id: p.id,
      name: p.full_name ?? p.email ?? p.id,
      avatarUrl: p.avatar_url ?? null,
      totalQuotes,
      totalQuotedAmount: repCurrent.reduce((s, q) => s + (q.grand_total ?? 0), 0),
      approvedCount,
      currentApprovedAmount: repCurrentApproved.reduce(
        (s, q) => s + projectContractValue(q, contractStates),
        0,
      ),
      approvalRate: totalQuotes > 0 ? approvedCount / totalQuotes : 0,
      priorApprovedAmount: repPriorApproved.reduce(
        (s, q) => s + projectContractValue(q, contractStates),
        0,
      ),
      monthlyApproved: monthKeys.map((k) => ({
        month: monthLabel(k),
        value: monthMap.get(k) ?? 0,
      })),
    };
  });

  // Sort by current approved amount desc → determines current rank
  repStats.sort((a, b) => b.currentApprovedAmount - a.currentApprovedAmount);

  // ── Rank trend ───────────────────────────────────────────────────────────────
  // Sort a copy by prior approved amount to get prior ranks.
  // Reps tied at 0 in the prior period all share the bottom rank.
  const priorSorted = [...repStats].sort(
    (a, b) => b.priorApprovedAmount - a.priorApprovedAmount,
  );
  const priorRankMap = new Map<string, number>();
  for (let i = 0; i < priorSorted.length; i++) {
    const rep = priorSorted[i];
    const prev = priorSorted[i - 1];
    const priorRank =
      i > 0 && rep.priorApprovedAmount === prev.priorApprovedAmount
        ? priorRankMap.get(prev.id)!
        : i + 1;
    priorRankMap.set(rep.id, priorRank);
  }

  // ── Leaderboard rows ─────────────────────────────────────────────────────────
  const leaderboardRows: LeaderboardRow[] = repStats.map((rep, i) => ({
    id: rep.id,
    name: rep.name,
    avatarUrl: rep.avatarUrl,
    totalQuotes: rep.totalQuotes,
    totalQuotedAmount: rep.totalQuotedAmount,
    approvedCount: rep.approvedCount,
    approvedAmount: rep.currentApprovedAmount,
    approvalRate: rep.approvalRate,
    currentRank: i + 1,
    priorRank: priorRankMap.get(rep.id) ?? null,
  }));

  // ── Per-rep series for line chart ────────────────────────────────────────────
  const perRepSeriesData: RepSeriesData[] = repStats.map((rep) => ({
    name: rep.name,
    data: rep.monthlyApproved,
  }));

  // ── KPI % changes ────────────────────────────────────────────────────────────
  const quotesChange = pctChange(kpiCurrent.totalQuotes, kpiPrior.totalQuotes);
  const quotedChange = pctChange(kpiCurrent.totalQuotedAmount, kpiPrior.totalQuotedAmount);
  const approvedChange = pctChange(kpiCurrent.approvedAmount, kpiPrior.approvedAmount);
  const conversionChange = pctChange(conversionCurrent, conversionPrior);

  return (
      <div className="px-4 py-5 sm:px-6 lg:px-8">

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="mb-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-xs text-zinc-500">
            Showing <span className="font-semibold text-zinc-700">{rangeLabel.toLowerCase()}</span>
            {" "}vs. prior equivalent period
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <AmountModeToggle />
            <DateRangeSelector
              current={range}
              customFrom={hasValidCustomRange ? resolved?.from : undefined}
              customTo={hasValidCustomRange ? resolved?.to : undefined}
            />
          </div>
        </div>

        <div className="grid gap-5">

          {/* KPI strip — 4 tiles in one row from xl, 2 columns on tablets, stacked on phones */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">

            {/* Tile 1: Total Quotes */}
            <KpiCard label="Total Quotes" icon="quotes">
              <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-950">
                {kpiCurrent.totalQuotes}
              </p>
              <ChangeBadge value={quotesChange} />
              <p className="mt-1 text-[10px] text-zinc-400">
                vs {kpiPrior.totalQuotes} prior period
              </p>
            </KpiCard>

            {/* Tile 2: Total Quoted Value + sparkline */}
            <KpiCard
              label="Total Quoted"
              icon="quoted"
              footer={
                <SalesRepSparkline
                  data={kpiQuotedSparkline}
                  color="#6366f1"
                  uniqueId="kpi-quoted"
                />
              }
            >
              <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-950">
                {formatSalesReportAED(kpiCurrent.totalQuotedAmount, amountMode)}
              </p>
              <ChangeBadge value={quotedChange} />
              <p className="mt-1 text-[10px] text-zinc-400">Latest quotation per folder</p>
            </KpiCard>

            {/* Tile 3: Total Approved Value + sparkline */}
            <KpiCard
              label="Client Approved Value"
              icon="approved"
              footer={
                <SalesRepSparkline
                  data={kpiApprovedSparkline}
                  color="#10b981"
                  uniqueId="kpi-approved"
                />
              }
            >
              <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-950">
                {formatSalesReportAED(kpiCurrent.approvedAmount, amountMode)}
              </p>
              <ChangeBadge value={approvedChange} />
              <p className="mt-1 text-[10px] text-zinc-400">Current Project contract value (includes variations)</p>
            </KpiCard>

            {/* Tile 4: Overall Conversion Rate + progress bar */}
            <KpiCard label="Conversion Rate" icon="conversion">
              <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-950">
                {conversionCurrent.toFixed(0)}%
              </p>
              <ChangeBadge value={conversionChange} />
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-1 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(conversionCurrent, 100)}%` }}
                />
              </div>
            </KpiCard>
          </div>

          {/* Charts with Top Sales Performers beside them (below on smaller screens) */}
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Performance Trends
              </h2>
              <SalesPerformanceCharts
                perRepData={perRepSeriesData}
                aggMonthData={aggMonthData}
                amountMode={amountMode}
              />
            </div>
            <aside className="min-w-0">
              <SalesLeaderboard rows={leaderboardRows} rangeLabel={rangeLabel} amountMode={amountMode} />
            </aside>
          </div>

          <SalesTeamPerformanceTable
            rows={leaderboardRows}
            rangeLabel={rangeLabel}
            canOpenDetails={profile?.role === "system_owner"}
            hrefForUser={(userId) => reportHref({ user: userId })}
            amountMode={amountMode}
          />
          <ProjectWiseApprovedTable
            rows={projectWiseRows}
            salespersonName={(id) => (id ? salespersonNames.get(id) ?? "Unknown" : "Unassigned")}
            rangeLabel={rangeLabel}
            amountMode={amountMode}
          />
        </div>

        {/* ── Team Overview — system_owner only ───────────────────────────── */}
        {profile?.role === "system_owner" && teamStats && teamStats.length > 0 ? (
          <div className="mt-5 rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-950">Team Overview</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                {teamView === "commercial"
                  ? "Commercial ownership for active Sales Managers in the selected period."
                  : "Role-aware contribution for all active users in the selected period."}
              </p>
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-zinc-100 bg-zinc-50 px-5 py-2 text-xs font-semibold">
              <Link
                href={reportHref({ teamView: "contribution" })}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 ${
                  teamView === "contribution"
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                }`}
              >
                Team Contribution
              </Link>
              <Link
                href={reportHref({ teamView: "commercial" })}
                className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 ${
                  teamView === "commercial"
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-800"
                }`}
              >
                Commercial Sales Performance
              </Link>
            </div>
            <div className="max-h-[34rem] overflow-auto">
              <table className="w-full min-w-[980px] divide-y divide-zinc-200 text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-[0_1px_0_0_#e4e4e7]">
                  {teamView === "commercial" ? (
                    <tr>
                      <th className="px-5 py-3 text-left font-semibold">Sales Manager</th>
                      <th className="px-5 py-3 text-right font-semibold">Owned Quotations</th>
                      <th className="px-5 py-3 text-right font-semibold">Client Approved</th>
                      <th className="px-5 py-3 text-right font-semibold">Win Rate</th>
                      <th className="px-5 py-3 text-right font-semibold">Owned Quoted Value</th>
                      <th className="px-5 py-3 text-right font-semibold">Client Approved Value</th>
                      <th className="px-5 py-3 w-8" />
                    </tr>
                  ) : (
                    <tr>
                      <th className="px-5 py-3 text-left font-semibold">Team Member</th>
                      <th className="px-5 py-3 text-left font-semibold">Role</th>
                      <th className="px-5 py-3 text-left font-semibold">Primary Contribution</th>
                      <th className="px-5 py-3 text-right font-semibold">Records Worked On</th>
                      <th className="px-5 py-3 text-right font-semibold">Approved / Completed</th>
                      <th className="px-5 py-3 text-right font-semibold">Contribution Value</th>
                      <th className="px-5 py-3 text-right font-semibold">Activity Count</th>
                      <th className="px-5 py-3 w-8" />
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(visibleTeamStats as TeamMemberStat[]).map((member) => {
                    const isSelected = member.userId === selectedUserId;
                    const rowHref = reportHref({ user: member.userId });
                    return (
                      <tr
                        key={member.userId}
                        aria-selected={isSelected}
                        className={`transition-colors ${
                          isSelected
                            ? "bg-emerald-50 shadow-[inset_3px_0_0_0_#059669]"
                            : member.userId === topMemberId
                            ? "bg-emerald-50/40 hover:bg-emerald-50/70"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <td className="px-0">
                          <Link href={rowHref} scroll={false} className="block px-5 py-4 font-medium text-zinc-950">
                            {member.displayName}
                            {member.userId === topMemberId && (
                              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                #1 Top performer
                              </span>
                            )}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} scroll={false} className={`block px-5 py-4 ${teamView === "commercial" ? "text-right text-zinc-950" : "text-zinc-500"}`}>
                            {teamView === "commercial" ? member.totalQuotations : roleLabel(member.role)}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} scroll={false} className={`block px-5 py-4 ${teamView === "commercial" ? "text-right" : "text-left"} text-zinc-950`}>
                            {teamView === "commercial" ? member.approvedQuotations : member.primaryContribution}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} scroll={false} className="block px-5 py-4 text-right text-zinc-950">
                            {teamView === "commercial"
                              ? member.totalQuotations > 0
                                ? Math.round((member.approvedQuotations / member.totalQuotations) * 100) + "%"
                                : "—"
                              : member.recordsWorkedOn}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} scroll={false} className="block px-5 py-4 text-right text-zinc-950">
                            {teamView === "commercial"
                              ? formatSalesReportAED(member.totalValue, amountMode)
                              : member.approvedCompleted}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} scroll={false} className="block px-5 py-4 text-right font-medium text-zinc-950">
                            {teamView === "commercial"
                              ? formatSalesReportAED(member.approvedValue, amountMode)
                              : member.contributionValue === null
                                ? "—"
                                : formatSalesReportAED(member.contributionValue, amountMode)}
                            {teamView === "contribution" && member.contributionValue !== null && maxContribution > 0 ? (
                              <span className="mt-1.5 ml-auto block h-1 w-24 overflow-hidden rounded-full bg-zinc-100">
                                <span
                                  className="block h-1 rounded-full bg-emerald-500"
                                  style={{ width: `${Math.min(100, Math.max(0, (member.contributionValue / maxContribution) * 100))}%` }}
                                />
                              </span>
                            ) : null}
                          </Link>
                        </td>
                        {teamView === "contribution" ? (
                          <td className="px-0">
                            <Link href={rowHref} scroll={false} className="block px-5 py-4 text-right text-zinc-950">
                              {member.activityCount}
                            </Link>
                          </td>
                        ) : null}
                        <td className="px-5 py-4 text-center" />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── User detail popup ── */}
            {selectedUserStats && selectedUserInfo ? (
              <TeamMemberDialog
                name={selectedUserInfo.displayName}
                roleLabel={roleLabel(selectedUserInfo.role)}
                position={selectedPosition}
                rangeLabel={rangeLabel}
                range={range}
                customFrom={hasValidCustomRange ? resolved?.from : undefined}
                customTo={hasValidCustomRange ? resolved?.to : undefined}
                closeHref={reportHref()}
                prevHref={selectedNeighbours?.prevId ? reportHref({ user: selectedNeighbours.prevId }) : null}
                nextHref={selectedNeighbours?.nextId ? reportHref({ user: selectedNeighbours.nextId }) : null}
              >
              <div>

                {/* Stat cards */}
                <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                  <div className="rounded-lg border border-zinc-200 bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      {selectedUsesOperationalAttribution
                        ? "Records Worked On"
                        : selectedUsesPreparationAttribution
                        ? "Quotations Prepared"
                        : selectedUserInfo.role === "sales_designer"
                          ? "Owned Quotations"
                          : "Quotes Created"}
                    </p>
                    <p className="mt-1 text-xl font-bold text-zinc-950">
                      {selectedUsesOperationalAttribution
                        ? selectedUserInfo.recordsWorkedOn
                        : selectedUserStats.totalQuotations}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      {selectedUsesOperationalAttribution
                        ? "Approved / Completed"
                        : selectedUsesPreparationAttribution
                        ? "Client Approved Quotations Prepared"
                        : "Client Approved"}
                    </p>
                    <p className="mt-1 text-xl font-bold text-zinc-950">
                      {selectedUsesOperationalAttribution
                        ? selectedUserInfo.approvedCompleted
                        : selectedUserStats.approvedQuotations}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      {selectedUsesOperationalAttribution
                        ? "Activity Count"
                        : selectedUsesPreparationAttribution
                        ? "Preparation Success Rate"
                        : "Win Rate"}
                    </p>
                    <p className="mt-1 text-xl font-bold text-zinc-950">
                      {selectedUsesOperationalAttribution
                        ? selectedUserInfo.activityCount
                        : selectedUserStats.totalQuotations > 0
                        ? Math.round(
                            (selectedUserStats.approvedQuotations / selectedUserStats.totalQuotations) * 100,
                          ) + "%"
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      {selectedUsesOperationalAttribution
                        ? "Contribution Value"
                        : selectedUsesPreparationAttribution
                        ? "Prepared Quoted Value"
                        : selectedUserInfo.role === "sales_designer"
                          ? "Owned Quoted Value"
                          : "Total Value"}
                    </p>
                    <p className="mt-1 text-xl font-bold text-zinc-950">
                      {selectedUsesOperationalAttribution
                        ? selectedUserInfo.contributionValue === null
                          ? "—"
                          : formatSalesReportAED(selectedUserInfo.contributionValue, amountMode)
                        : formatSalesReportAED(selectedUserStats.totalValue, amountMode)}
                    </p>
                    {selectedUsesPreparationAttribution ? (
                      <p className="mt-1 text-[10px] leading-4 text-zinc-400">
                        Preparation contribution only. Commercial ownership remains with the assigned Sales Manager.
                      </p>
                    ) : null}
                  </div>
                </div>

                {selectedHasNoData ? <TeamMemberEmptyState /> : (<>
                {/* Monthly trend chart */}
                {hasSelectedTrend ? (
                <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Activity Trend
                  </h4>
                  <SalesPerformanceCharts
                    perRepData={[]}
                    showRepChart={false}
                    valueKind="count"
                    amountMode={amountMode}
                    aggMonthData={selectedUserStats.monthlyData.map((m) => ({
                      month: m.month,
                      quoted: m.total,
                      approved: m.approved,
                    }))}
                  />
                </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-5 text-center text-xs text-zinc-400">
                    No quotation trend data for this period.
                  </div>
                )}

                <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Contribution Breakdown
                  </h4>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-md bg-zinc-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Products added</p>
                      <p className="mt-1 text-base font-semibold text-zinc-950">
                        {activityCount(selectedUserStats.contributions.quotationItemsAdded)}
                      </p>
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Templates created / edited</p>
                      <p className="mt-1 text-base font-semibold text-zinc-950">
                        {activityCount(selectedUserStats.contributions.productTemplatesCreated)}
                        {" / "}
                        {activityCount(selectedUserStats.contributions.productTemplatesUpdated)}
                      </p>
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Clients created</p>
                      <p className="mt-1 text-base font-semibold text-zinc-950">
                        {activityCount(selectedUserStats.contributions.clientsCreated)}
                      </p>
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Revisions / options / copies</p>
                      <p className="mt-1 text-base font-semibold text-zinc-950">
                        {activityCount(selectedUserStats.contributions.revisionsCreated)}
                        {" / "}
                        {activityCount(selectedUserStats.contributions.optionsCreated)}
                        {" / "}
                        {activityCount(selectedUserStats.contributions.copiesCreated)}
                      </p>
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Enquiry updates</p>
                      <p className="mt-1 text-base font-semibold text-zinc-950">
                        {activityCount(selectedUserStats.contributions.enquiryUpdates)}
                      </p>
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2.5">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Document actions</p>
                      <p className="mt-1 text-base font-semibold text-zinc-950">
                        {activityCount(selectedUserStats.contributions.documentActions)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Recent Activity
                  </h4>
                  <StaffActivityList
                    entries={selectedRecentActivity.slice(0, 8)}
                    emptyMessage="No logged activity in this period."
                  />
                </div>

                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Detailed Activity
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["quotations", "Quotations"],
                      ["products", "Products"],
                      ["clients", "Clients & enquiries"],
                      ["documents", "Documents"],
                    ].map(([tab, label]) => (
                      <Link
                        key={tab}
                        href={reportHref({ user: selectedUserId ?? "", detailTab: tab })}
                        scroll={false}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                          detailTab === tab
                            ? "bg-emerald-900 text-white"
                            : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Recent quotations */}
                {detailTab === "quotations" ? (
                <div className="mt-3 rounded-lg border border-zinc-200 bg-white">
                  <div className="border-b border-zinc-200 px-4 py-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Recent Quotations
                    </h4>
                  </div>
                  {selectedUserStats.recentQuotations.length === 0 ? (
                    <p className="px-4 py-5 text-center text-xs text-zinc-400">
                      No quotations in this period.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] divide-y divide-zinc-100 text-sm">
                        <thead>
                          <tr className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            <th className="px-4 py-2.5">No.</th>
                            <th className="px-4 py-2.5">Title</th>
                            <th className="px-4 py-2.5">Status</th>
                            <th className="px-4 py-2.5 text-right">Value</th>
                            <th className="px-4 py-2.5">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {selectedUserStats.recentQuotations.map((q) => (
                            <tr key={q.id} className="hover:bg-zinc-50">
                              <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                                <Link href={`/quotations/${q.id}`} className="hover:underline">
                                  {q.quotation_no ?? "—"}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-zinc-800">
                                <Link href={`/quotations/${q.id}`} className="hover:underline">
                                  {q.title ?? "—"}
                                </Link>
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(q.status)}`}
                                >
                                  {q.status.replaceAll("_", " ")}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-zinc-700">
                                {formatSalesReportAED(q.grand_total ?? 0, amountMode)}
                              </td>
                              <td className="px-4 py-3 text-xs text-zinc-400">
                                {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
                                  new Date(q.created_at),
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                ) : null}

                {detailTab === "products" ? (
                  <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-4">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md bg-zinc-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Products added</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-950">
                          {activityCount(selectedUserStats.contributions.quotationItemsAdded)}
                        </p>
                      </div>
                      <div className="rounded-md bg-zinc-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Templates created</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-950">
                          {activityCount(selectedUserStats.contributions.productTemplatesCreated)}
                        </p>
                      </div>
                      <div className="rounded-md bg-zinc-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Templates edited</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-950">
                          {activityCount(selectedUserStats.contributions.productTemplatesUpdated)}
                        </p>
                      </div>
                    </div>
                    <StaffActivityList
                      entries={selectedProductActivity.slice(0, 10)}
                      emptyMessage="No logged product activity in this period."
                    />
                  </div>
                ) : null}

                {detailTab === "clients" ? (
                  <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-4">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md bg-zinc-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Clients created</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-950">
                          {activityCount(selectedUserStats.contributions.clientsCreated)}
                        </p>
                      </div>
                      <div className="rounded-md bg-zinc-50 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Enquiry updates</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-950">
                          {activityCount(selectedUserStats.contributions.enquiryUpdates)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] text-zinc-400">
                      Enquiry creation is unavailable because there is no separate creator-owned enquiry record.
                    </p>
                    <StaffActivityList
                      entries={selectedClientActivity.slice(0, 10)}
                      emptyMessage="No logged client or enquiry activity in this period."
                    />
                  </div>
                ) : null}

                {detailTab === "documents" ? (
                  <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-4">
                    <div className="rounded-md bg-zinc-50 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-zinc-500">Document actions</p>
                      <p className="mt-1 text-lg font-semibold text-zinc-950">
                        {activityCount(selectedUserStats.contributions.documentActions)}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Logged document setup and project-file creation actions.
                      </p>
                    </div>
                    <StaffActivityList
                      entries={selectedDocumentActivity.slice(0, 10)}
                      emptyMessage="No logged document activity in this period."
                    />
                  </div>
                ) : null}
                </>)}
              </div>
              </TeamMemberDialog>
            ) : null}
          </div>
        ) : null}
      </div>
  );
}
