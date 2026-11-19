export type PriceStatusTone = "ok" | "notice" | "warning" | "neutral";

export function PriceStatusBadge({ detail, label, tone }: { detail?: string; label: string; tone: PriceStatusTone }) {
  const className = tone === "ok"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : tone === "notice"
      ? "border-sky-200 bg-sky-50 text-sky-900"
      : tone === "neutral"
        ? "border-zinc-200 bg-zinc-50 text-zinc-700"
        : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <span className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 align-top text-[11px] font-semibold shadow-sm ${className}`} title={detail ? `${label} - ${detail}` : label}>
      {label}
      {detail ? <span className="sr-only">: {detail}</span> : null}
    </span>
  );
}
