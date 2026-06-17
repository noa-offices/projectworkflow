export type SalesRepCardProps = {
  name: string;
  avatarUrl: string | null;
  totalQuotes: number;
  totalQuotedAmount: string;
  approvedCount: number;
  approvedAmount: string;
  approvalRate: number;
};

const AVATAR_COLORS = [
  "bg-emerald-700",
  "bg-blue-700",
  "bg-violet-700",
  "bg-amber-700",
  "bg-rose-700",
  "bg-teal-700",
];

function avatarColorClass(name: string): string {
  const code = name.charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

function approvalRateBadgeClass(rate: number): string {
  if (rate > 0.5) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (rate >= 0.2) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-zinc-100 bg-zinc-50 px-2 py-1.5">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-xs font-semibold leading-none text-zinc-900">{value}</p>
    </div>
  );
}

export function SalesRepCard({
  name,
  avatarUrl,
  totalQuotes,
  totalQuotedAmount,
  approvedCount,
  approvedAmount,
  approvalRate,
}: SalesRepCardProps) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center text-xs font-semibold text-white ${avatarColorClass(name)}`}
            >
              {initial}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-950">{name}</p>
          <span
            className={`mt-0.5 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${approvalRateBadgeClass(approvalRate)}`}
          >
            {(approvalRate * 100).toFixed(0)}% approval
          </span>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <StatTile label="Total Quotes" value={totalQuotes} />
        <StatTile label="Total Quoted" value={totalQuotedAmount} />
        <StatTile label="Approved" value={approvedCount} />
        <StatTile label="Approved Value" value={approvedAmount} />
      </div>
    </div>
  );
}
