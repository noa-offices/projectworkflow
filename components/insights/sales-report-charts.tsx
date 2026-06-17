"use client";

export type MonthlyDataPoint = { month: string; value: number };

type PerRepSeries = { name: string; data: MonthlyDataPoint[] };

type SalesReportChartsProps = {
  perRepData: PerRepSeries[];
};

const SERIES_COLORS = ["#14532d", "#5b21b6", "#b45309", "#075985", "#9f1239", "#0f766e"];

function formatAEDShort(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value.toFixed(0)}`;
}

const W = 540;
const H = 210;
const PL = 58;
const PB = 28;
const PT = 8;
const PR = 12;
const CHART_W = W - PL - PR;
const CHART_H = H - PT - PB;

export function SalesReportCharts({ perRepData }: SalesReportChartsProps) {
  if (perRepData.length === 0) {
    return <p className="py-8 text-center text-xs text-zinc-400">No data available.</p>;
  }

  const allValues = perRepData.flatMap((s) => s.data.map((d) => d.value));
  const maxValue = Math.max(...allValues, 1);
  const months = perRepData[0]?.data.map((d) => d.month) ?? [];
  const N = months.length;

  function xPos(i: number): number {
    return N <= 1 ? PL + CHART_W / 2 : PL + (i / (N - 1)) * CHART_W;
  }

  function yPos(value: number): number {
    return PT + CHART_H - (value / maxValue) * CHART_H;
  }

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => (maxValue * i) / yTickCount);

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {perRepData.map((series, i) => (
          <div key={series.name} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
            />
            <span className="text-[10px] text-zinc-500">{series.name}</span>
          </div>
        ))}
      </div>

      {/* SVG line chart */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 280 }}
          aria-label="Monthly approved value by sales designer"
        >
          {/* Y-axis grid + labels */}
          {yTicks.map((tick, i) => {
            const y = yPos(tick);
            return (
              <g key={i}>
                <line x1={PL} y1={y} x2={PL + CHART_W} y2={y} stroke="#e4e4e7" strokeWidth="1" />
                <text x={PL - 5} y={y + 3.5} textAnchor="end" fontSize="9" fill="#a1a1aa">
                  {formatAEDShort(tick)}
                </text>
              </g>
            );
          })}

          {/* X-axis baseline */}
          <line
            x1={PL}
            y1={PT + CHART_H}
            x2={PL + CHART_W}
            y2={PT + CHART_H}
            stroke="#d4d4d8"
            strokeWidth="1"
          />

          {/* X-axis month labels */}
          {months.map((m, i) => (
            <text
              key={i}
              x={xPos(i)}
              y={H - 7}
              textAnchor="middle"
              fontSize="9"
              fill="#71717a"
            >
              {m}
            </text>
          ))}

          {/* Series: line + dots */}
          {perRepData.map((series, si) => {
            const color = SERIES_COLORS[si % SERIES_COLORS.length];
            const points = series.data.map((d, i) => `${xPos(i)},${yPos(d.value)}`).join(" ");
            return (
              <g key={series.name}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity="0.9"
                />
                {series.data.map((d, i) => (
                  <circle
                    key={i}
                    cx={xPos(i)}
                    cy={yPos(d.value)}
                    r="2.5"
                    fill="white"
                    stroke={color}
                    strokeWidth="1.5"
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
