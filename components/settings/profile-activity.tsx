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

type TeamMemberStat = {
  userId: string;
  displayName: string;
  role: string | null;
  totalQuotations: number;
  approvedQuotations: number;
  totalValue: number;
  currency: string;
};

type MonthlyDataPoint = {
  month: string;
  year: number;
  monthKey: string;
  total: number;
  approved: number;
  value: number;
};

type ProfileActivityProps = {
  totalQuotations: number;
  approvedQuotations: number;
  totalValue: number;
  currency: string;
  role: string | null;
  recentActivity: ActivityEntry[];
  recentQuotations: QuotationEntry[];
  teamStats?: TeamMemberStat[] | null;
  monthlyData: MonthlyDataPoint[];
};

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

function roleLabel(role: string | null): string {
  switch (role) {
    case "system_owner": return "System Owner";
    case "admin_manager": return "Admin Manager";
    case "sales_designer": return "Sales User";
    case "viewer": return "Viewer";
    default: return "Unknown";
  }
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
}: {
  monthlyData: MonthlyDataPoint[];
  title: string;
}) {
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Light green = created · Dark green = client approved
      </p>
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
              formatter={(value, name) => [
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

function TeamOverviewTable({ teamStats }: { teamStats: TeamMemberStat[] }) {
  return (
    <div className="mt-6 rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-950">Team Overview</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Quotation performance across all active team members
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-5 py-3 text-left font-semibold">Team Member</th>
              <th className="px-5 py-3 text-left font-semibold">Role</th>
              <th className="px-5 py-3 text-right font-semibold">Quotes</th>
              <th className="px-5 py-3 text-right font-semibold">Approved</th>
              <th className="px-5 py-3 text-right font-semibold">Win Rate</th>
              <th className="px-5 py-3 text-right font-semibold">Total Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {teamStats.map((member, index) => (
              <tr key={member.userId} className={index === 0 ? "bg-emerald-50/40" : ""}>
                <td className="px-5 py-4 font-medium text-zinc-950">
                  {member.displayName}
                  {index === 0 && (
                    <span className="ml-2 text-xs text-emerald-700">Top performer</span>
                  )}
                </td>
                <td className="px-5 py-4 text-zinc-500">{roleLabel(member.role)}</td>
                <td className="px-5 py-4 text-right text-zinc-950">{member.totalQuotations}</td>
                <td className="px-5 py-4 text-right text-zinc-950">{member.approvedQuotations}</td>
                <td className="px-5 py-4 text-right text-zinc-950">
                  {member.totalQuotations > 0
                    ? Math.round((member.approvedQuotations / member.totalQuotations) * 100) + "%"
                    : "—"}
                </td>
                <td className="px-5 py-4 text-right font-medium text-zinc-950">
                  {member.currency}{" "}
                  {new Intl.NumberFormat("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  }).format(member.totalValue)}
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
  teamStats,
  monthlyData,
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

  return (
    <>
      {/* Section 1 — Stats Grid (all roles) */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {/* Section 2A — Sales Designer view */}
      {isSalesDesigner ? (
        <>
          <MonthlyChart
            monthlyData={monthlyData}
            title="My Quotation Activity — Last 6 Months"
          />
          <ActivityFeed recentActivity={recentActivity} />
          <QuotationsTable recentQuotations={recentQuotations} currency={currency} />
        </>
      ) : null}

      {/* Section 2B — Management view (system_owner or admin_manager) */}
      {isManagement ? (
        <>
          <MonthlyChart
            monthlyData={monthlyData}
            title="Team Quotation Activity — Last 6 Months"
          />
          {teamStats && teamStats.length > 0 ? (
            <TeamOverviewTable teamStats={teamStats} />
          ) : null}
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
