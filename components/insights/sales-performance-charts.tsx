"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ─── Types (re-exported so page.tsx can import them) ──────────────────────────

export type RepSeriesData = {
  name: string;
  data: Array<{ month: string; value: number }>;
};

export type AggMonthPoint = {
  month: string;
  quoted: number;
  approved: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SERIES_COLORS = ["#14532d", "#5b21b6", "#b45309", "#075985", "#9f1239", "#0f766e"];

function fmtAED(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(Math.round(v));
}

// ─── Chart 1: Per-rep monthly approved (LineChart) ───────────────────────────

type LineRow = { month: string } & { [key: string]: string | number };

function RepApprovedLineChart({ seriesData }: { seriesData: RepSeriesData[] }) {
  if (seriesData.length === 0 || seriesData[0].data.length === 0) {
    return <p className="py-8 text-center text-xs text-zinc-400">No data in this period.</p>;
  }

  const months = seriesData[0].data.map((d) => d.month);
  const chartData: LineRow[] = months.map((month, i) => {
    const row: LineRow = { month };
    for (const series of seriesData) {
      row[series.name] = series.data[i]?.value ?? 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={165}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#f4f4f5" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 9, fill: "#a1a1aa" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "#a1a1aa" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtAED}
          width={38}
        />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            borderRadius: 6,
            border: "1px solid #e4e4e7",
            padding: "4px 8px",
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => [
            `AED ${fmtAED(typeof value === "number" ? value : 0)}`,
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          iconSize={8}
          iconType="circle"
        />
        {seriesData.map((series, i) => (
          <Line
            key={series.name}
            type="monotone"
            dataKey={series.name}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 1.5 }}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Chart 2: Monthly quoted vs approved aggregate (BarChart) ─────────────────

function QuotedVsApprovedBarChart({ data }: { data: AggMonthPoint[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-xs text-zinc-400">No data in this period.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={165}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#f4f4f5" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 9, fill: "#a1a1aa" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "#a1a1aa" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtAED}
          width={38}
        />
        <Tooltip
          contentStyle={{
            fontSize: 11,
            borderRadius: 6,
            border: "1px solid #e4e4e7",
            padding: "4px 8px",
          }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any, name: any) => [
            `AED ${fmtAED(typeof value === "number" ? value : 0)}`,
            name === "quoted" ? "Quoted" : "Client Approved",
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          iconSize={8}
          formatter={(value) => (value === "quoted" ? "Quoted" : "Client Approved")}
        />
        <Bar dataKey="quoted" name="quoted" fill="#6366f1" radius={[2, 2, 0, 0]} />
        <Bar dataKey="approved" name="approved" fill="#10b981" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Combined export ──────────────────────────────────────────────────────────

export function SalesPerformanceCharts({
  aggMonthData,
  perRepData,
}: {
  aggMonthData: AggMonthPoint[];
  perRepData: RepSeriesData[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Monthly Client Approved Value
        </h3>
        <RepApprovedLineChart seriesData={perRepData} />
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Monthly Quoted vs. Client Approved
        </h3>
        <QuotedVsApprovedBarChart data={aggMonthData} />
      </div>
    </div>
  );
}
