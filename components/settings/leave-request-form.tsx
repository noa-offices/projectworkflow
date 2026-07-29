"use client";

import { useState } from "react";
import Link from "next/link";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  LEAVE_DURATION_OPTIONS,
  LEAVE_TYPE_OPTIONS,
  leaveTypeLabel,
  type LeaveRequestRow,
} from "@/lib/hr/leave-requests";

function requestedDays(start: string, end: string, duration: string) {
  if (!start || !end) return null;
  if (duration !== "full_day") return start === end ? 0.5 : null;
  const days = Math.round(
    (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000,
  ) + 1;
  return days > 0 ? days : null;
}

export function LeaveRequestForm({
  action,
  currentBalance,
  request,
}: {
  action: (formData: FormData) => void | Promise<void>;
  currentBalance: number;
  request?: LeaveRequestRow;
}) {
  const [leaveType, setLeaveType] = useState<string>(request?.leave_type ?? "annual_leave");
  const [startDate, setStartDate] = useState(request?.start_date ?? "");
  const [endDate, setEndDate] = useState(request?.end_date ?? "");
  const [duration, setDuration] = useState<string>(request?.duration_type ?? "full_day");
  const days = requestedDays(startDate, endDate, duration);
  const projectedBalance = leaveType === "annual_leave" && days !== null
    ? currentBalance - days
    : currentBalance;

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-zinc-700">Leave type</span>
        <select name="leave_type" value={leaveType} onChange={(event) => setLeaveType(event.target.value)} className="h-10 rounded-md border border-zinc-200 bg-white px-3">
          {LEAVE_TYPE_OPTIONS.map((value) => <option key={value} value={value}>{leaveTypeLabel(value)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-zinc-700">Duration</span>
        <select name="duration_type" value={duration} onChange={(event) => setDuration(event.target.value)} className="h-10 rounded-md border border-zinc-200 bg-white px-3">
          {LEAVE_DURATION_OPTIONS.map((value) => <option key={value} value={value}>{leaveTypeLabel(value)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-zinc-700">Start date</span>
        <input required name="start_date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="h-10 rounded-md border border-zinc-200 px-3" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-zinc-700">End date</span>
        <input required name="end_date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="h-10 rounded-md border border-zinc-200 px-3" />
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        <span className="font-medium text-zinc-700">Reason</span>
        <textarea name="reason" defaultValue={request?.reason ?? ""} rows={2} className="rounded-md border border-zinc-200 px-3 py-2" />
      </label>
      <label className="grid gap-1 text-sm md:col-span-2">
        <span className="font-medium text-zinc-700">Handover note</span>
        <textarea name="handover_note" defaultValue={request?.handover_note ?? ""} rows={2} className="rounded-md border border-zinc-200 px-3 py-2" />
      </label>
      <div className="grid gap-2 rounded-md bg-zinc-50 p-3 text-sm sm:grid-cols-3 md:col-span-2">
        <p><span className="block text-xs text-zinc-500">Requested days</span>{days ?? "—"}</p>
        <p><span className="block text-xs text-zinc-500">Current balance</span>{currentBalance}</p>
        <p><span className="block text-xs text-zinc-500">Projected balance</span>{days === null ? "—" : projectedBalance}</p>
      </div>
      <p className="text-xs text-zinc-500 md:col-span-2">Days are inclusive calendar days; public holidays and weekends are not excluded in this phase.</p>
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <PendingSubmitButton name="intent" value="draft" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700">Save Draft</PendingSubmitButton>
        <PendingSubmitButton name="intent" value="submit" className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white">Submit for Approval</PendingSubmitButton>
        <Link href="/settings/profile" className="rounded-md px-4 py-2 text-sm font-semibold text-zinc-500">Cancel</Link>
      </div>
    </form>
  );
}
