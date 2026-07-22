import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { DateRangeSelector } from "@/components/insights/date-range-selector";
import { SalesPerformanceCharts } from "@/components/insights/sales-performance-charts";
import { SalesRepSparkline } from "@/components/insights/sales-rep-sparkline";
import { SalesRepCard } from "@/components/insights/sales-rep-card";
import { ResolvedAvatar } from "@/components/ui/resolved-avatar";
import { requireActiveUser } from "@/lib/auth";
import {
  quotationOptionNoFromQuotationNo,
  quotationRootBaseNo,
} from "@/lib/quotation-options";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTeamStats, loadProfileStatsForUser } from "@/lib/settings/profile-stats-loader";
import type { TeamMemberStat } from "@/lib/settings/profile-stats-loader";
import type { AggMonthPoint, RepSeriesData } from "@/components/insights/sales-performance-charts";

export const dynamic = "force-dynamic";

// ─── Row types ────────────────────────────────────────────────────────────────

type QuotationRow = {
  id: string;
  quotation_no: string | null;
  option_no: number | null;
  revision_no: number | null;
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

const VALID_RANGES = ["30d", "3m", "6m", "1y"] as const;
type RangeKey = (typeof VALID_RANGES)[number];

const RANGE_LABELS: Record<RangeKey, string> = {
  "30d": "Last 30 Days",
  "3m": "Last 3 Months",
  "6m": "Last 6 Months",
  "1y": "Last 1 Year",
};

function getRangeStart(range: RangeKey, from: Date): Date {
  const d = new Date(from);
  switch (range) {
    case "30d": d.setDate(d.getDate() - 30); break;
    case "3m":  d.setMonth(d.getMonth() - 3); break;
    case "1y":  d.setFullYear(d.getFullYear() - 1); break;
    default:    d.setMonth(d.getMonth() - 6); // 6m
  }
  return d;
}

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

function formatAED(value: number): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
}

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
    case "sales_designer": return "Sales User";
    case "designer": return "Designer";
    case "viewer": return "Viewer";
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

function quotationRevisionSequence(quotation: QuotationRow): number {
  if (typeof quotation.revision_no === "number" && Number.isFinite(quotation.revision_no)) {
    return Math.max(Math.trunc(quotation.revision_no), 0);
  }

  const match = quotation.quotation_no?.trim().match(/-R(\d+)$/i);
  if (!match) return 0;

  const sequence = Number.parseInt(match[1], 10);
  return Number.isFinite(sequence) ? Math.max(sequence, 0) : 0;
}

function quotationOptionSequence(quotation: QuotationRow): number {
  if (typeof quotation.option_no === "number" && Number.isFinite(quotation.option_no)) {
    return Math.max(Math.trunc(quotation.option_no), 1);
  }

  return quotationOptionNoFromQuotationNo(quotation.quotation_no) ?? 1;
}

function quotationFolderKey(quotation: QuotationRow): string {
  return quotationRootBaseNo(quotation.quotation_no) ?? quotation.id;
}

function quotationSortTime(quotation: QuotationRow): number {
  const statusUpdatedAt = quotation.status_updated_at ? new Date(quotation.status_updated_at).getTime() : 0;
  const createdAt = new Date(quotation.created_at).getTime();
  return Math.max(
    Number.isFinite(statusUpdatedAt) ? statusUpdatedAt : 0,
    Number.isFinite(createdAt) ? createdAt : 0,
  );
}

function primaryQuotationRank(quotation: QuotationRow): number | null {
  const revisionBase = quotation.quotation_no?.trim().replace(/-R\d+$/i, "") ?? "";
  const hasOptionSuffix = /-(?:OPT-[A-Z]+|OPT\d+)$/i.test(revisionBase);
  const optionSequence = quotationOptionSequence(quotation);

  if (hasOptionSuffix || optionSequence > 1) return null;
  return quotation.option_no === null ? 0 : 1;
}

function latestPrimaryQuotationsByFolder(quotations: QuotationRow[]): QuotationRow[] {
  const byFolder = new Map<string, QuotationRow[]>();

  for (const quotation of quotations) {
    const key = quotationFolderKey(quotation);
    byFolder.set(key, [...(byFolder.get(key) ?? []), quotation]);
  }

  return Array.from(byFolder.entries()).map(([folderKey, folderQuotations]) => {
    const latestRevision = Math.max(...folderQuotations.map(quotationRevisionSequence));
    const latestRevisionQuotations = folderQuotations.filter(
      (quotation) => quotationRevisionSequence(quotation) === latestRevision,
    );
    const primaryQuotations = latestRevisionQuotations
      .map((quotation) => ({ quotation, rank: primaryQuotationRank(quotation) }))
      .filter((entry): entry is { quotation: QuotationRow; rank: number } => entry.rank !== null)
      .sort((left, right) => left.rank - right.rank || quotationSortTime(right.quotation) - quotationSortTime(left.quotation));

    const primaryQuotation = primaryQuotations[0]?.quotation;
    if (!primaryQuotation) {
      throw new Error(`Sales Report cannot identify a primary quotation for folder ${folderKey}.`);
    }

    return primaryQuotation;
  });
}

function actualApprovedQuotationsByFolder(quotations: QuotationRow[]): QuotationRow[] {
  const approvedByFolder = new Map<string, QuotationRow>();

  for (const quotation of quotations) {
    const key = quotationFolderKey(quotation);
    const current = approvedByFolder.get(key);

    if (!current || quotationSortTime(quotation) > quotationSortTime(current)) {
      approvedByFolder.set(key, quotation);
    }
  }

  return Array.from(approvedByFolder.values());
}

// ─── Inline server components ─────────────────────────────────────────────────

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
  approvedAmount: number;
  approvalRate: number;
  currentRank: number;
  priorRank: number | null;
};

const REP_COLORS = ["#14532d", "#5b21b6", "#b45309", "#075985", "#9f1239", "#0f766e"];

function SalesLeaderboard({
  rangeLabel,
  rows,
}: {
  rangeLabel: string;
  rows: LeaderboardRow[];
}) {
  const maxAmount = rows[0]?.approvedAmount ?? 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Top Sales Performers
        </h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">{rangeLabel}</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-zinc-400">
          No approved deals in this period.
        </p>
      ) : (
        <div className="divide-y divide-zinc-50">
          {rows.map((row, i) => {
            const barPct = maxAmount > 0 ? (row.approvedAmount / maxAmount) * 100 : 0;
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
                      {formatAED(row.approvedAmount)}
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
                <div className="mt-2 ml-6 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-1 rounded-full transition-all"
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

type PageProps = {
  searchParams?: Promise<{ range?: string; user?: string }>;
};

export default async function SalesReportPage({ searchParams }: PageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const supabase = await createSupabaseClient();

  // ── Range param ─────────────────────────────────────────────────────────────
  const resolved = await searchParams;
  const rawRange = resolved?.range ?? "6m";
  const rawUser = resolved?.user;
  const range: RangeKey = (VALID_RANGES as readonly string[]).includes(rawRange)
    ? (rawRange as RangeKey)
    : "6m";
  const rangeLabel = RANGE_LABELS[range];

  // ── Date boundaries ─────────────────────────────────────────────────────────
  const now = new Date();
  const rangeStart = getRangeStart(range, now);
  // Prior period: same duration, immediately before rangeStart
  const priorStart = getRangeStart(range, rangeStart);
  const priorEnd = rangeStart;

  // ── Fetch ────────────────────────────────────────────────────────────────────
  const today = now.toISOString().slice(0, 10);

  const adminResult = createAdminClient();
  if (!adminResult.client) throw new Error(adminResult.error ?? "Admin client unavailable");
  const adminClient = adminResult.client;

  const teamDateRange = { from: rangeStart.toISOString().slice(0, 10), to: today };
  const [{ data: quotations }, { data: salespersonProfiles }, teamStats] = await Promise.all([
    supabase
      .from("quotations")
      .select(
        "id,quotation_no,option_no,revision_no,salesperson_id,status,grand_total,currency,created_at,status_updated_at,layout_settings",
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
  const selectedUserStats = selectedUserId
    ? await loadProfileStatsForUser(selectedUserId, teamDateRange)
    : null;

  // ── Approved definition ──────────────────────────────────────────────────────
  // Matches the existing page's definition exactly: client_confirmed + project file exists
  function isApproved(q: QuotationRow): boolean {
    return (
      q.status === "client_confirmed" &&
      projectFileFromLayoutSettings(q.layout_settings) !== null
    );
  }

  const quotedQuotations = latestPrimaryQuotationsByFolder(allQuotationRows);
  const approvedQuotations = actualApprovedQuotationsByFolder(allQuotationRows.filter(isApproved));

  // ── Period filtering (by created_at) ────────────────────────────────────────
  const currentQuotes = quotedQuotations.filter(
    (q) => new Date(q.created_at) >= rangeStart,
  );
  const priorQuotes = quotedQuotations.filter((q) => {
    const d = new Date(q.created_at);
    return d >= priorStart && d < priorEnd;
  });
  const currentApproved = approvedQuotations.filter(
    (q) => new Date(q.created_at) >= rangeStart,
  );
  const priorApproved = approvedQuotations.filter((q) => {
    const d = new Date(q.created_at);
    return d >= priorStart && d < priorEnd;
  });

  // ── Company-wide KPI totals ──────────────────────────────────────────────────
  const kpiCurrent = {
    totalQuotes: currentQuotes.length,
    totalQuotedAmount: currentQuotes.reduce((s, q) => s + (q.grand_total ?? 0), 0),
    approvedCount: currentApproved.length,
    approvedAmount: currentApproved.reduce((s, q) => s + (q.grand_total ?? 0), 0),
  };
  const kpiPrior = {
    totalQuotes: priorQuotes.length,
    totalQuotedAmount: priorQuotes.reduce((s, q) => s + (q.grand_total ?? 0), 0),
    approvedCount: priorApproved.length,
    approvedAmount: priorApproved.reduce((s, q) => s + (q.grand_total ?? 0), 0),
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
  const monthKeys = getMonthKeys(rangeStart, now);

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
      aggApprovedByMonth.set(k, (aggApprovedByMonth.get(k) ?? 0) + (q.grand_total ?? 0));
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
    const repCurrentApproved = currentApproved.filter((q) => q.salesperson_id === p.id);
    const repPriorApproved = priorApproved.filter((q) => q.salesperson_id === p.id);

    // Monthly approved for this rep (for sparkline + line chart)
    const monthMap = new Map<string, number>(monthKeys.map((k) => [k, 0]));
    for (const q of repCurrentApproved) {
      const k = monthKey(new Date(q.created_at));
      if (monthMap.has(k)) {
        monthMap.set(k, (monthMap.get(k) ?? 0) + (q.grand_total ?? 0));
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
        (s, q) => s + (q.grand_total ?? 0),
        0,
      ),
      approvalRate: totalQuotes > 0 ? approvedCount / totalQuotes : 0,
      priorApprovedAmount: repPriorApproved.reduce(
        (s, q) => s + (q.grand_total ?? 0),
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
    <ErpAppShell
      eyebrow="INSIGHTS"
      title="Sales Report"
      description="Approval rates, quoted value, and project conversion per sales designer."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-5 sm:px-8">

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="mb-5 flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500">
            Showing <span className="font-semibold text-zinc-700">{rangeLabel.toLowerCase()}</span>
            {" "}vs. prior equivalent period
          </p>
          <DateRangeSelector current={range} />
        </div>

        {/* ── Two-column grid ──────────────────────────────────────────────── */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">

          {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
          <div className="grid gap-5">

            {/* KPI strip — 4 individual tiles */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

              {/* Tile 1: Total Quotes */}
              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Total Quotes
                </p>
                <p className="mt-2 text-2xl font-bold text-zinc-950">
                  {kpiCurrent.totalQuotes}
                </p>
                <ChangeBadge value={quotesChange} />
                <p className="mt-1 text-[10px] text-zinc-400">
                  vs {kpiPrior.totalQuotes} prior period
                </p>
              </div>

              {/* Tile 2: Total Quoted Value + sparkline */}
              <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="p-4 pb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Total Quoted
                  </p>
                  <p className="mt-2 text-2xl font-bold text-zinc-950">
                    {formatAED(kpiCurrent.totalQuotedAmount)}
                  </p>
                  <ChangeBadge value={quotedChange} />
                </div>
                <SalesRepSparkline
                  data={kpiQuotedSparkline}
                  color="#6366f1"
                  uniqueId="kpi-quoted"
                />
              </div>

              {/* Tile 3: Total Approved Value + sparkline */}
              <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="p-4 pb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Approved Value
                  </p>
                  <p className="mt-2 text-2xl font-bold text-zinc-950">
                    {formatAED(kpiCurrent.approvedAmount)}
                  </p>
                  <ChangeBadge value={approvedChange} />
                </div>
                <SalesRepSparkline
                  data={kpiApprovedSparkline}
                  color="#10b981"
                  uniqueId="kpi-approved"
                />
              </div>

              {/* Tile 4: Overall Conversion Rate + progress bar */}
              <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Conversion Rate
                </p>
                <p className="mt-2 text-2xl font-bold text-zinc-950">
                  {conversionCurrent.toFixed(0)}%
                </p>
                <ChangeBadge value={conversionChange} />
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-1 rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(conversionCurrent, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Performance Trends charts */}
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Performance Trends
              </h2>
              <SalesPerformanceCharts
                perRepData={perRepSeriesData}
                aggMonthData={aggMonthData}
              />
            </div>

            {/* Sales Designers per-rep cards */}
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Sales Designers ({allProfiles.length})
              </h2>
              {allProfiles.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
                  No active sales designers found.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {repStats.map((rep, i) => (
                    <SalesRepCard
                      key={rep.id}
                      name={rep.name}
                      avatarUrl={rep.avatarUrl}
                      totalQuotes={rep.totalQuotes}
                      totalQuotedAmount={formatAED(rep.totalQuotedAmount)}
                      approvedCount={rep.approvedCount}
                      approvedAmount={formatAED(rep.currentApprovedAmount)}
                      approvalRate={rep.approvalRate}
                      isTopPerformer={i === 0 && rep.currentApprovedAmount > 0}
                      sparkline={
                        <SalesRepSparkline
                          data={rep.monthlyApproved.map((m) => m.value)}
                          color="#10b981"
                          uniqueId={rep.id}
                        />
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── RIGHT COLUMN: Leaderboard (sticky on desktop) ─────────────── */}
          <aside className="xl:sticky xl:top-4 xl:self-start">
            <SalesLeaderboard rows={leaderboardRows} rangeLabel={rangeLabel} />
          </aside>
        </div>

        {/* ── Team Overview — system_owner only ───────────────────────────── */}
        {profile?.role === "system_owner" && teamStats && teamStats.length > 0 ? (
          <div className="mt-5 rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-950">Team Overview</h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                All active users — quotations created in selected period · Click a row for details
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Team Member</th>
                    <th className="px-5 py-3 text-left font-semibold">Role</th>
                    <th className="px-5 py-3 text-right font-semibold">Quotes Created</th>
                    <th className="px-5 py-3 text-right font-semibold">Approved</th>
                    <th className="px-5 py-3 text-right font-semibold">Win Rate</th>
                    <th className="px-5 py-3 text-right font-semibold">Total Value</th>
                    <th className="px-5 py-3 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(teamStats as TeamMemberStat[]).map((member, index) => {
                    const isSelected = member.userId === selectedUserId;
                    const rowHref = isSelected
                      ? `?range=${range}`
                      : `?range=${range}&user=${member.userId}`;
                    return (
                      <tr
                        key={member.userId}
                        className={`transition-colors ${
                          isSelected
                            ? "border-l-2 border-emerald-600 bg-emerald-50"
                            : index === 0
                            ? "bg-emerald-50/40 hover:bg-zinc-50"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <td className="px-0">
                          <Link href={rowHref} className="block px-5 py-4 font-medium text-zinc-950">
                            {member.displayName}
                            {index === 0 && (
                              <span className="ml-2 text-xs text-emerald-700">Top performer</span>
                            )}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} className="block px-5 py-4 text-zinc-500">
                            {roleLabel(member.role)}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} className="block px-5 py-4 text-right text-zinc-950">
                            {member.totalQuotations}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} className="block px-5 py-4 text-right text-zinc-950">
                            {member.approvedQuotations}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} className="block px-5 py-4 text-right text-zinc-950">
                            {member.totalQuotations > 0
                              ? Math.round((member.approvedQuotations / member.totalQuotations) * 100) + "%"
                              : "—"}
                          </Link>
                        </td>
                        <td className="px-0">
                          <Link href={rowHref} className="block px-5 py-4 text-right font-medium text-zinc-950">
                            {member.currency}{" "}
                            {new Intl.NumberFormat("en-US", {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            }).format(member.totalValue)}
                          </Link>
                        </td>
                        <td className="px-5 py-4 text-center">
                          {isSelected ? (
                            <Link
                              href={`?range=${range}`}
                              className="text-xs font-medium text-zinc-400 hover:text-zinc-700"
                              aria-label="Close detail"
                            >
                              ×
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── User detail panel ── */}
            {selectedUserStats && selectedUserInfo ? (
              <div className="border-t border-emerald-200 bg-emerald-50/30 p-5">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-950">
                      {selectedUserInfo.displayName} — Activity Detail
                    </h3>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {rangeLabel} · {roleLabel(selectedUserInfo.role)}
                    </p>
                  </div>
                  <Link
                    href={`?range=${range}`}
                    className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                  >
                    Close ×
                  </Link>
                </div>

                {/* Stat cards */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Quotes Created
                    </p>
                    <p className="mt-2 text-2xl font-bold text-zinc-950">
                      {selectedUserStats.totalQuotations}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Approved
                    </p>
                    <p className="mt-2 text-2xl font-bold text-zinc-950">
                      {selectedUserStats.approvedQuotations}
                    </p>
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Win Rate
                    </p>
                    <p className="mt-2 text-2xl font-bold text-zinc-950">
                      {selectedUserStats.totalQuotations > 0
                        ? Math.round(
                            (selectedUserStats.approvedQuotations / selectedUserStats.totalQuotations) * 100,
                          ) + "%"
                        : "—"}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                    <div className="p-4 pb-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Total Value
                      </p>
                      <p className="mt-2 text-2xl font-bold text-zinc-950">
                        {formatAED(selectedUserStats.totalValue)}
                      </p>
                    </div>
                    <SalesRepSparkline
                      data={selectedUserStats.monthlyData.map((m) => m.value)}
                      color="#10b981"
                      uniqueId={`detail-${selectedUserId}`}
                    />
                  </div>
                </div>

                {/* Monthly trend chart */}
                <div className="mt-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Monthly Activity
                  </h4>
                  <SalesPerformanceCharts
                    perRepData={[]}
                    aggMonthData={selectedUserStats.monthlyData.map((m) => ({
                      month: m.month,
                      quoted: m.total,
                      approved: m.approved,
                    }))}
                  />
                </div>

                {/* Recent quotations */}
                <div className="mt-4 rounded-lg border border-zinc-200 bg-white shadow-sm">
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
                      <table className="min-w-full divide-y divide-zinc-100 text-sm">
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
                                {q.currency ?? selectedUserStats.currency}{" "}
                                {new Intl.NumberFormat("en-US", {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                }).format(q.grand_total ?? 0)}
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

                {/* Recent activity */}
                <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Recent Activity
                  </h4>
                  {selectedUserStats.recentActivity.length === 0 ? (
                    <p className="text-center text-xs text-zinc-400">No activity in this period.</p>
                  ) : (
                    <div className="divide-y divide-zinc-100">
                      {selectedUserStats.recentActivity.slice(0, 8).map((entry) => (
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
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </ErpAppShell>
  );
}
