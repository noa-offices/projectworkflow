"use client";

import { useState } from "react";

const EXECUTION_STATUS_OPTIONS = [
  ["in_progress", "Manufacturing / In Progress"],
  ["ready_for_delivery", "Ready for Delivery"],
  ["delivered", "Delivered & Installed"],
  ["on_hold", "On Hold"],
  ["completed", "Completed & Signed Off"],
] as const;

function badgeClassName(status: string) {
  switch (status) {
    case "ready_for_delivery": return "border-amber-200 bg-amber-50 text-amber-800";
    case "delivered": return "border-teal-200 bg-teal-50 text-teal-800";
    case "on_hold": return "border-red-200 bg-red-50 text-red-800";
    case "completed": return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "in_progress":
    default: return "border-blue-200 bg-blue-50 text-blue-800";
  }
}

function statusLabel(status: string) {
  return EXECUTION_STATUS_OPTIONS.find(([value]) => value === status)?.[1] ?? status;
}

type Props = {
  orderNo: string;
  quotationId: string;
};

export function ProjectExecutionStatus({ orderNo, quotationId: _quotationId }: Props) {
  const [status, setStatus] = useState("in_progress");

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 block">
          <span className="text-xs font-semibold uppercase text-zinc-500">Execution Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            {EXECUTION_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <div className="sm:pb-1">
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badgeClassName(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      </div>
      <p className="mt-3 text-xs text-zinc-400">
        Project execution status for {orderNo} is local only in Phase 3A. Database persistence will be added in Phase 3C.
      </p>
    </div>
  );
}
