import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Clock, IdCard } from "lucide-react";
import { DashboardCard } from "@/components/dashboard/dashboard-card";

export type AlertIconKey = "critical" | "warning" | "info";

export type DashboardAlert = {
  detail: string;
  icon: AlertIconKey;
  tone: string;
  title: string;
};

const ALERT_ICONS: Record<AlertIconKey, LucideIcon> = {
  critical: AlertTriangle,
  warning: Clock,
  info: IdCard,
};

export function AlertsPanel({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <DashboardCard className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-950">Alerts</p>
          <p className="mt-1 text-xs text-zinc-500">Cached notifications queued for review.</p>
        </div>
        <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">{alerts.length} open</span>
      </div>
      <div className="mt-4 grid gap-3">
        {alerts.map((alert) => {
          const Icon = ALERT_ICONS[alert.icon];
          return (
            <article key={alert.title} className="flex gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${alert.tone}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-zinc-950">{alert.title}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-600">{alert.detail}</p>
              </div>
            </article>
          );
        })}
      </div>
    </DashboardCard>
  );
}
