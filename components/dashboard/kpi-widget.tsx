import type { LucideIcon } from "lucide-react";
import { DashboardCard } from "@/components/dashboard/dashboard-card";

export function KPIWidget({
  accent,
  description,
  icon: Icon,
  label,
  trend,
  value,
}: {
  accent: string;
  description: string;
  icon: LucideIcon;
  label: string;
  trend: string;
  value: string;
}) {
  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold text-zinc-950">{value}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-md ${accent}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-sm text-zinc-600">{description}</p>
      <p className="mt-4 border-t border-zinc-100 pt-3 text-xs font-medium text-emerald-800">{trend}</p>
    </DashboardCard>
  );
}
