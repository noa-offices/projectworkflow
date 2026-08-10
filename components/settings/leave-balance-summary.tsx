import { formatLeaveDays, type LeaveBalanceSummary } from "@/lib/hr/leave-requests";

function availableColorClass(available: number) {
  if (available <= 5) return "text-red-700";
  if (available <= 10) return "text-amber-700";
  return "text-emerald-700";
}

export function LeaveBalanceSummaryDisplay({
  balance,
  className = "",
}: {
  balance: LeaveBalanceSummary;
  className?: string;
}) {
  const secondary = [
    { label: "Taken", tone: "text-zinc-600", value: balance.taken },
    { label: "Planned", tone: "text-blue-700", value: balance.planned },
    { label: "On Leave", tone: "text-amber-700", value: balance.active },
    { label: "Requested", tone: "text-amber-700", value: balance.requested },
  ].filter((item) => item.value > 0);

  return (
    <div className={className}>
      <p className={`font-semibold ${availableColorClass(balance.available_to_plan)}`}>
        Available {formatLeaveDays(balance.available_to_plan)}
      </p>
      {secondary.length ? (
        <p className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
          {secondary.map((item) => (
            <span key={item.label} className={item.tone}>{item.label} {item.value}</span>
          ))}
        </p>
      ) : null}
      <p className="mt-0.5 text-xs text-zinc-400">Entitlement {balance.entitlement}</p>
    </div>
  );
}
