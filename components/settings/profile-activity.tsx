"use client";

import Link from "next/link";
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

type DateRange = { from: string; to: string };

type TopClient = {
  clientName: string;
  total: number;
  count: number;
};

type AllQuotationEntry = {
  status: string;
};

type Preset = "this_month" | "last_3_months" | "last_6_months" | "this_year";

type ProfileActivityProps = {
  totalQuotations: number;
  approvedQuotations: number;
  totalValue: number;
  currency: string;
  role: string | null;
  recentActivity: ActivityEntry[];
  recentQuotations: QuotationEntry[];
  monthlyData: MonthlyDataPoint[];
  allQuotations?: AllQuotationEntry[];
  topClients?: TopClient[];
  onDateRangeChange?: (range: DateRange | null) => void;
  onPresetChange?: (preset: Preset) => void;
  selectedPreset?: string;
};

const PRESET_LABELS: Record<Preset, string> = {
  this_month: "This Month",
  last_3_months: "Last 3 Months",
  last_6_months: "Last 6 Months",
  this_year: "This Year",
};

const PRESET_KEYS: Preset[] = ["this_month", "last_3_months", "last_6_months", "this_year"];

const PIPELINE_STATUSES: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "ready_to_send", label: "Ready to Send" },
  { key: "sent_to_client", label: "Sent to Client" },
  { key: "client_confirmed", label: "Client Approved" },
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

function ActivityFeed({ recentActivity }: { recentActivity: ActivityEntry[] }) {
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-950">Recent Activity</h2>
      {recentActivity.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No activity recorded yet.</p>
      ) : (
        <div className="mt-3 divide-y divide-zinc-100">
          {recentActivity.map((entry) => (
            <div key={entry.id} className="flex items-start gap-3 py-3">
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dotColor(entry.entity_type)}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-950">{entry.title}</p>
                {entry.description ? (
                  <p className="mt-0.5 text-xs text-zinc-500">{entry.description}</p>
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
}: {
  recentQuotations: QuotationEntry[];
  currency: string;
}) {
  if (recentQuotations.length === 0) return null;
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-950">My Recent Quotations</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead>
            <tr className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3">No.</th>
              <th className="px-5 py-3">Title</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Value</th>
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
                <td className="px-5 py-3 text-zinc-700">
                  {q.currency ?? currency}{" "}
                  {new Intl.NumberFormat("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  }).format(q.grand_total ?? 0)}
                </td>
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
                name === "total" ? "Quotes Created" : "Approved",
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

export function ProfileActivity({
  totalQuotations,
  approvedQuotations,
  totalValue,
  currency,
  role,
  recentActivity,
  recentQuotations,
  monthlyData,
  allQuotations = [],
  topClients = [],
  onPresetChange,
  selectedPreset = "last_6_months",
}: ProfileActivityProps) {
  const winRate =
    totalQuotations > 0
      ? Math.round((approvedQuotations / totalQuotations) * 100) + "%"
      : "—";

  const formattedValue = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(totalValue);

  const isManagement = role === "system_owner" || role === "admin_manager";
  const isSalesDesigner = role === "sales_designer";
  const isSystemOwner = role === "system_owner";
  const showPipeline = isSalesDesigner || isSystemOwner;

  const chartTitle = "My Quotation Activity";

  return (
    <>
      {/* Section 0 — Date Range Selector */}
      <div className="mt-6 flex flex-wrap gap-2">
        {PRESET_KEYS.map((preset) => {
          const isActive = selectedPreset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onPresetChange?.(preset)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-emerald-900 text-white"
                  : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {PRESET_LABELS[preset]}
            </button>
          );
        })}
      </div>

      {/* Section 1 — Stats Grid (all roles) */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Quotations Created
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{totalQuotations}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Client Approved
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{approvedQuotations}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Win Rate</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{winRate}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Total Value</p>
          <p className="mt-1 text-xs font-medium text-zinc-400">{currency}</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-950">{formattedValue}</p>
        </div>
      </div>

      {/* Section 2 — Pipeline Breakdown (sales_designer + system_owner) */}
      {showPipeline ? (
        <PipelineBreakdown allQuotations={allQuotations} />
      ) : null}

      {/* Section 3A — Sales Designer view */}
      {isSalesDesigner ? (
        <>
          <MonthlyChart
            monthlyData={monthlyData}
            title={chartTitle}
            currency={currency}
            totalValue={totalValue}
          />
          <TopClientsTable topClients={topClients} currency={currency} />
          <ActivityFeed recentActivity={recentActivity} />
          <QuotationsTable recentQuotations={recentQuotations} currency={currency} />
        </>
      ) : null}

      {/* Section 3B — Management view (system_owner or admin_manager) */}
      {isManagement ? (
        <>
          <MonthlyChart
            monthlyData={monthlyData}
            title={chartTitle}
            currency={currency}
            totalValue={totalValue}
          />
          <ActivityFeed recentActivity={recentActivity} />
        </>
      ) : null}

      {/* Viewer / unknown role — stats + activity only */}
      {!isSalesDesigner && !isManagement ? (
        <ActivityFeed recentActivity={recentActivity} />
      ) : null}
    </>
  );
}
