import { Cloud, Database, Wifi } from "lucide-react";
import { DashboardCard } from "@/components/dashboard/dashboard-card";

export function LocalStatusCard({
  lastSyncLabel,
  online,
  pendingWrites,
  source,
}: {
  lastSyncLabel: string;
  online: boolean;
  pendingWrites?: number;
  source?: string;
}) {
  return (
    <DashboardCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-950">System Status</p>
          <p className="mt-1 text-xs text-zinc-500">Connection state and last data refresh.</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-md ${online ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          <Database className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
          <dt className="flex items-center gap-2 text-zinc-600">
            <Wifi className="h-4 w-4" aria-hidden="true" />
            Status
          </dt>
          <dd className="font-semibold text-zinc-950">{online ? "Online" : "Offline"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
          <dt className="flex items-center gap-2 text-zinc-600">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            Last Refresh
          </dt>
          <dd className="font-semibold text-zinc-950">{lastSyncLabel}</dd>
        </div>
        {pendingWrites !== undefined && (
          <div className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
            <dt className="text-zinc-600">Pending Writes</dt>
            <dd className="font-semibold text-zinc-950">{pendingWrites}</dd>
          </div>
        )}
      </dl>

      {source && (
        <p className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
          Source: {source}
        </p>
      )}
    </DashboardCard>
  );
}
