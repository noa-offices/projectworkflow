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
import { formatSalesReportAED, type AmountMode } from "@/lib/insights/sales-report-money";
import { formatAxisMoney, niceAxisScale } from "@/lib/insights/sales-report-chart-scale";

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

// ─── Chart 1: Per-rep monthly approved (LineChart) ───────────────────────────

type LineRow = { month: string } & { [key: string]: string | number };

function ChartEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
      <p className="text-xs text-zinc-400">No data in this period.</p>
    </div>
  );
}

function RepApprovedLineChart({ seriesData, amountMode }: { seriesData: RepSeriesData[]; amountMode: AmountMode }) {
  if (seriesData.length === 0 || seriesData[0].data.length === 0) {
    return <ChartEmpty />;
  }

  const months = seriesData[0].data.map((d) => d.month);
  const chartData: LineRow[] = months.map((month, i) => {
    const row: LineRow = { month };
    for (const series of seriesData) {
        row[series.name] = series.data[i]?.value ?? 0;
    }
    return row;
  });
  const lineScale = niceAxisScale(
    Math.max(0, ...chartData.flatMap((row) => seriesData.map((series) => Number(row[series.name]) || 0))),
  );

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
          domain={[0, lineScale.max]}
          ticks={lineScale.ticks}
          tickFormatter={(value) => formatAxisMoney(value, amountMode)}
          width={44}
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
            formatSalesReportAED(typeof value === "number" ? value : 0, amountMode),
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

function QuotedVsApprovedBarChart({
  data,
  amountMode,
  valueKind,
}: {
  data: AggMonthPoint[];
  amountMode: AmountMode;
  valueKind: ValueKind;
}) {
  if (data.length === 0) {
    return <ChartEmpty />;
  }
  const isCount = valueKind === "count";
  const barScale = niceAxisScale(Math.max(0, ...data.flatMap((point) => [point.quoted, point.approved])), { integer: isCount });
  const quotedLabel = isCount ? "Quotations" : "Quoted";

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
          domain={[0, barScale.max]}
          ticks={barScale.ticks}
          allowDecimals={!isCount}
          tickFormatter={(value) => (isCount ? String(value) : formatAxisMoney(value, amountMode))}
          width={isCount ? 30 : 44}
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
            isCount
              ? String(typeof value === "number" ? value : 0)
              : formatSalesReportAED(typeof value === "number" ? value : 0, amountMode),
            name === "quoted" ? quotedLabel : "Client Approved",
          ]}
        />
        <Legend
          wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
          iconSize={8}
          iconType="circle"
          formatter={(value) => (value === "quoted" ? quotedLabel : "Client Approved")}
        />
        <Bar dataKey="quoted" name="quoted" fill="#6366f1" radius={[2, 2, 0, 0]} />
        <Bar dataKey="approved" name="approved" fill="#10b981" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Combined export ──────────────────────────────────────────────────────────

type ValueKind = "money" | "count";

export function SalesPerformanceCharts({
  aggMonthData,
  perRepData,
  amountMode = "millions",
  valueKind = "money",
  showRepChart = true,
}: {
  aggMonthData: AggMonthPoint[];
  perRepData: RepSeriesData[];
  amountMode?: AmountMode;
  /** "count" plots whole quotation counts (no AED formatting). */
  valueKind?: ValueKind;
  showRepChart?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${showRepChart ? "2xl:grid-cols-2" : ""}`}>
      {showRepChart ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Monthly Client Approved Value
          </h3>
          <RepApprovedLineChart seriesData={perRepData} amountMode={amountMode} />
        </div>
      ) : null}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {valueKind === "count" ? "Monthly Quotations vs. Client Approved" : "Monthly Quoted vs. Client Approved"}
        </h3>
        <QuotedVsApprovedBarChart data={aggMonthData} amountMode={amountMode} valueKind={valueKind} />
      </div>
    </div>
  );
}
