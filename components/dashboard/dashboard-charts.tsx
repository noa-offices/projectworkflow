"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAEDShort(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(Math.round(value));
}

// ─── KpiSparkline ─────────────────────────────────────────────────────────────
// Decorative area chart — no axes, no grid, no tooltip.
// `data` is a small array of numbers representing a shape; not real time-series.

export function KpiSparkline({
  color,
  data,
  gradientId,
}: {
  color: string;
  data: number[];
  gradientId: string;
}) {
  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width="100%" height={52}>
      <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.28} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── MonthlyBarChart ──────────────────────────────────────────────────────────
// 12-bar chart for Jan–Dec. Tooltip shows AED amount on hover.

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function MonthlyBarChart({
  color = "#10b981",
  data,
}: {
  color?: string;
  data: Array<{ month: number; total: number }>;
}) {
  const chartData = data.map((d) => ({
    month: MONTH_LABELS[(d.month - 1) % 12],
    total: d.total,
  }));

  return (
    <ResponsiveContainer width="100%" height={80}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <XAxis
          dataKey="month"
          tick={{ fontSize: 9, fill: "#a1a1aa" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(value: any) => [
            fmtAEDShort(typeof value === "number" ? value : 0),
            "AED",
          ]}
          contentStyle={{
            fontSize: 11,
            borderRadius: 6,
            border: "1px solid #e4e4e7",
            padding: "4px 8px",
          }}
        />
        <Bar dataKey="total" fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
