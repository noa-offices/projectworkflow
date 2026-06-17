import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { SalesReportCharts } from "@/components/insights/sales-report-charts";
import { SalesRepCard } from "@/components/insights/sales-rep-card";
import { requireActiveUser } from "@/lib/auth";
import { projectFileFromLayoutSettings } from "@/lib/quotations/project-file";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type QuotationRow = {
  id: string;
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

type RepStat = {
  id: string;
  name: string;
  avatarUrl: string | null;
  totalQuotes: number;
  totalQuotedAmount: number;
  approvedCount: number;
  approvedAmount: number;
  approvalRate: number;
};

function formatAED(value: number): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );
}

const REP_COLORS = ["#14532d", "#5b21b6", "#b45309", "#075985", "#9f1239", "#0f766e"];

function KpiTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

function SalesLeaderboard({ reps }: { reps: RepStat[] }) {
  const maxAmount = reps[0]?.approvedAmount ?? 0;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Leaderboard</h2>
      {reps.length === 0 ? (
        <p className="text-xs text-zinc-400">No data.</p>
      ) : (
        <div className="space-y-3">
          {reps.map((rep, i) => {
            const barPct = maxAmount > 0 ? (rep.approvedAmount / maxAmount) * 100 : 0;
            const color = REP_COLORS[i % REP_COLORS.length];
            const initial = rep.name.trim().charAt(0).toUpperCase() || "?";
            return (
              <div key={rep.id} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right text-[10px] font-semibold text-zinc-400">
                  {i + 1}
                </span>
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-white"
                  style={{ backgroundColor: color }}
                >
                  {rep.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={rep.avatarUrl} alt={rep.name} className="h-full w-full object-cover" />
                  ) : (
                    initial
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <p className="truncate text-xs font-medium text-zinc-800">{rep.name}</p>
                    <p className="shrink-0 text-[10px] font-semibold text-zinc-500">
                      {formatAED(rep.approvedAmount)}
                    </p>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-1 rounded-full"
                      style={{ width: `${barPct}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default async function SalesReportPage() {
  const { user, profile, displayName } = await requireActiveUser();
  const supabase = await createSupabaseClient();

  const [{ data: quotations }, { data: salespersonProfiles }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id,salesperson_id,status,grand_total,currency,created_at,status_updated_at,layout_settings")
      .returns<QuotationRow[]>(),
    supabase
      .from("profiles")
      .select("id,full_name,email,avatar_url")
      .eq("role", "sales_designer")
      .eq("account_status", "active")
      .order("full_name", { ascending: true })
      .returns<SalespersonProfileRow[]>(),
  ]);

  const allQuotations = quotations ?? [];
  const allProfiles = salespersonProfiles ?? [];

  function isApproved(q: QuotationRow): boolean {
    return q.status === "client_confirmed" && projectFileFromLayoutSettings(q.layout_settings) !== null;
  }

  // Per-rep stats
  const repStats: RepStat[] = allProfiles.map((p) => {
    const repQuotes = allQuotations.filter((q) => q.salesperson_id === p.id);
    const approvedQuotes = repQuotes.filter(isApproved);
    const totalQuotes = repQuotes.length;
    const totalQuotedAmount = repQuotes.reduce((sum, q) => sum + (q.grand_total ?? 0), 0);
    const approvedCount = approvedQuotes.length;
    const approvedAmount = approvedQuotes.reduce((sum, q) => sum + (q.grand_total ?? 0), 0);
    const approvalRate = totalQuotes > 0 ? approvedCount / totalQuotes : 0;
    return {
      id: p.id,
      name: p.full_name ?? p.email ?? p.id,
      avatarUrl: p.avatar_url ?? null,
      totalQuotes,
      totalQuotedAmount,
      approvedCount,
      approvedAmount,
      approvalRate,
    };
  });

  repStats.sort((a, b) => b.approvedAmount - a.approvedAmount);

  // Company-wide totals
  const totalQuotesAll = repStats.reduce((s, r) => s + r.totalQuotes, 0);
  const totalQuotedAll = repStats.reduce((s, r) => s + r.totalQuotedAmount, 0);
  const approvedCountAll = repStats.reduce((s, r) => s + r.approvedCount, 0);
  const approvedAmountAll = repStats.reduce((s, r) => s + r.approvedAmount, 0);
  const overallRate = totalQuotesAll > 0 ? ((approvedCountAll / totalQuotesAll) * 100).toFixed(0) : "0";

  // Month keys for last 6 months (oldest → newest)
  const now = new Date();
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    monthKeys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }

  // Per-rep monthly approved value
  const perRepMonthlyData = repStats.map((rep) => {
    const repApproved = allQuotations.filter(
      (q) => q.salesperson_id === rep.id && isApproved(q),
    );
    const map = new Map(monthKeys.map((k) => [k, 0]));
    for (const q of repApproved) {
      const k = monthKey(new Date(q.status_updated_at ?? q.created_at));
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + (q.grand_total ?? 0));
    }
    return {
      name: rep.name,
      data: monthKeys.map((k) => ({ month: monthLabel(k), value: map.get(k) ?? 0 })),
    };
  });

  return (
    <ErpAppShell
      eyebrow="INSIGHTS"
      title="Sales Report"
      description="Approval rates, quoted value, and project conversion per sales designer."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-5 sm:px-8">

        {/* KPI strip — single bordered container */}
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 sm:grid-cols-4 sm:divide-y-0">
            <KpiTile label="Total Quotes" value={totalQuotesAll} />
            <KpiTile label="Total Quoted" value={formatAED(totalQuotedAll)} />
            <KpiTile label="Approved Projects" value={approvedCountAll} />
            <KpiTile label="Approved Value" value={`${formatAED(approvedAmountAll)} · ${overallRate}%`} />
          </div>
        </div>

        {/* Chart + Leaderboard */}
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Monthly Approved Value — Last 6 Months
            </h2>
            <div className="mt-3">
              <SalesReportCharts perRepData={perRepMonthlyData} />
            </div>
          </section>
          <SalesLeaderboard reps={repStats} />
        </div>

        {/* Per-rep cards */}
        <section className="mt-4">
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Sales Designers ({allProfiles.length})
          </h2>
          {allProfiles.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-400">
              No active sales designers found.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {repStats.map((rep) => (
                <SalesRepCard
                  key={rep.id}
                  name={rep.name}
                  avatarUrl={rep.avatarUrl}
                  totalQuotes={rep.totalQuotes}
                  totalQuotedAmount={formatAED(rep.totalQuotedAmount)}
                  approvedCount={rep.approvedCount}
                  approvedAmount={formatAED(rep.approvedAmount)}
                  approvalRate={rep.approvalRate}
                />
              ))}
            </div>
          )}
        </section>

      </div>
    </ErpAppShell>
  );
}
