"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { DashboardCard } from "@/components/dashboard/dashboard-card";

export function KPIWidget({
  accent,
  cardBg,
  description,
  icon: Icon,
  label,
  sparkline,
  trend,
  value,
}: {
  accent: string;
  cardBg?: string;
  description: string;
  icon: LucideIcon;
  label: string;
  sparkline?: ReactNode;
  trend: string;
  value: string;
}) {
  return (
    <DashboardCard bg={cardBg} className="overflow-hidden">
      <div className="p-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
              {label}
            </p>
            <p className="mt-2 text-3xl font-bold text-zinc-950">{value}</p>
            <p className="mt-1 text-xs text-zinc-600">{description}</p>
          </div>
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${accent}`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        {trend && (
          <p className="mt-2 text-[10px] text-zinc-400">{trend}</p>
        )}
      </div>
      {sparkline && <div className="w-full">{sparkline}</div>}
    </DashboardCard>
  );
}
