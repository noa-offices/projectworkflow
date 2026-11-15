import type { AmountMode } from "@/lib/insights/sales-report-money";

export type AxisScale = { max: number; ticks: number[] };

/** Axis from 0 to a "nice" max with about four steps. Zero data still gets a real scale, so a zero bar stays empty. */
export function niceAxisScale(dataMax: number, options: { integer?: boolean } = {}): AxisScale {
  const peak = Number.isFinite(dataMax) && dataMax > 0 ? dataMax : 0;
  if (peak === 0) {
    const max = options.integer ? 4 : 1_000;
    return { max, ticks: [0, max / 4, max / 2, (max * 3) / 4, max] };
  }
  const rough = peak / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].find((step) => step * magnitude >= rough) ?? 10;
  let step = unit * magnitude;
  if (options.integer) step = Math.max(1, Math.ceil(step));
  const intervals = Math.max(1, Math.ceil(peak / step));
  const max = step * intervals;
  return { max, ticks: Array.from({ length: intervals + 1 }, (_, index) => step * index) };
}

function trimmed(value: number, digits = 2) {
  return String(Number(value.toFixed(digits)));
}

/** Short axis label. Full mode: 25K, 1.5M. Millions mode keeps the page's existing M style with enough decimals. */
export function formatAxisMoney(value: number, mode: AmountMode): string {
  const amount = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(amount);
  if (mode === "full") {
    if (abs >= 1_000_000) return `${trimmed(amount / 1_000_000)}M`;
    if (abs >= 1_000) return `${trimmed(amount / 1_000)}K`;
    return String(Math.round(amount) || 0);
  }
  return `${trimmed(amount / 1_000_000, 3)}M`;
}
