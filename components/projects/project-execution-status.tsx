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
  canEdit: boolean;
  orderNo: string;
  quotationId: string;
};

export function ProjectExecutionStatus({ canEdit, orderNo: _orderNo, quotationId: _quotationId }: Props) {
  const [status, setStatus] = useState("in_progress");

  const currentLabel = statusLabel(status);
  const badgeClass = badgeClassName(status);

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Project Execution Status</p>
      <div className="mt-3">
        {canEdit ? (
          <div className="flex flex-col gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
            >
              {EXECUTION_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <button
              type="button"
              className="h-9 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Update
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
              {currentLabel}
            </span>
            <span className="text-xs text-zinc-400">View only</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        {canEdit
          ? "Only Admin Manager and System Owner can change this status."
          : "Contact an Admin Manager to update this status."}
      </p>
    </div>
  );
}
