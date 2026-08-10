"use client";

import { useMemo, useState } from "react";
import {
  dayCountLabel,
  formatDateDisplay,
  type VacationEntrySource,
} from "@/components/settings/vacation-dates-editor";
import type { VacationEntry } from "@/app/hr/actions";
import {
  cancelActiveLeave,
  cancelApprovedLeaveRequest,
  correctLeaveActualDates,
  editManagedLeaveRequest,
  recordLeaveEarlyReturn,
} from "@/app/hr/actions";
import {
  formatLeaveDate,
  formatLeaveDays,
  leaveDisplayStatus,
  leaveRequestDateBoundaries,
  leaveRequestGroup,
  leaveTypeLabel,
  type LeaveBalanceSummary,
  type LeaveRequestRow,
} from "@/lib/hr/leave-requests";

function entryYear(entry: VacationEntry): number {
  return Number(entry.start_date.slice(0, 4));
}

export function VacationHistoryModal({
  balance,
  entrySources,
  leaveRequests = [],
  onClose,
  personName,
  vacationDates = [],
}: {
  balance?: LeaveBalanceSummary;
  entrySources?: Record<string, VacationEntrySource>;
  leaveRequests?: LeaveRequestRow[];
  onClose: () => void;
  personName: string;
  vacationDates?: VacationEntry[];
}) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const years = useMemo(() => {
    const set = new Set<number>([currentYear, ...vacationDates.map(entryYear), ...leaveRequests.map((request) => Number(request.start_date.slice(0, 4)))]);
    return Array.from(set).sort((a, b) => b - a);
  }, [currentYear, leaveRequests, vacationDates]);

  const filteredEntries = useMemo(
    () => vacationDates.filter((entry) => entryYear(entry) === selectedYear),
    [selectedYear, vacationDates],
  );
  const filteredRequests = useMemo(
    () => leaveRequests.filter((request) => Number(request.start_date.slice(0, 4)) === selectedYear),
    [leaveRequests, selectedYear],
  );
  const boundaries = leaveRequestDateBoundaries();
  const currentRequests = filteredRequests.filter((request) => leaveRequestGroup(request, boundaries) === "current");
  const recentRequests = filteredRequests.filter((request) => leaveRequestGroup(request, boundaries) === "recent");
  const previousRequests = filteredRequests.filter((request) => leaveRequestGroup(request, boundaries) === "previous");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-zinc-950">{personName}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 shrink-0 rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            ×
          </button>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">Vacation dates</p>
        {balance ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-emerald-50 px-3 py-2 text-xs sm:grid-cols-4">
            <div><dt className="text-zinc-500">Available</dt><dd className="font-semibold text-emerald-900">{balance.available_to_plan}</dd></div>
            <div><dt className="text-zinc-500">Remaining</dt><dd className="font-semibold text-zinc-800">{balance.remaining_entitlement}</dd></div>
            <div><dt className="text-zinc-500">Entitlement</dt><dd className="font-semibold text-zinc-800">{balance.entitlement}</dd></div>
            <div><dt className="text-zinc-500">Taken</dt><dd className="font-semibold text-zinc-800">{balance.taken}</dd></div>
            <div><dt className="text-zinc-500">Planned</dt><dd className="font-semibold text-blue-700">{balance.planned}</dd></div>
            <div><dt className="text-zinc-500">On Leave</dt><dd className="font-semibold text-amber-700">{balance.active}</dd></div>
            <div><dt className="text-zinc-500">Requested</dt><dd className="font-semibold text-amber-700">{balance.requested}</dd></div>
          </dl>
        ) : null}

        <label className="mt-4 grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Year
          </span>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        {leaveRequests.length ? (
          <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
            {(["Current & Pending", "Recent"] as const).map((heading) => {
              const requests = heading === "Current & Pending" ? currentRequests : recentRequests;
              if (!requests.length) return null;
              return <section key={heading} className="mb-4"><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</h4><div className="grid gap-2">{requests.map((request) => <LeaveHistoryItem key={request.id} request={request} />)}</div></section>;
            })}
            <details className="border-t border-zinc-100 pt-3">
              <summary className="cursor-pointer text-sm font-semibold text-emerald-900">Previous Requests ({previousRequests.length})</summary>
              <div className="mt-2 grid gap-2">{previousRequests.slice(0, 10).map((request) => <LeaveHistoryItem key={request.id} request={request} />)}{previousRequests.length === 0 ? <p className="text-sm text-zinc-400">No previous vacation requests.</p> : null}</div>
              {previousRequests.length > 10 ? <p className="mt-2 text-xs text-zinc-500">Showing 10 records. Use the Vacation Requests year and employee filters for more.</p> : null}
            </details>
          </div>
        ) : null}
        {vacationDates.length ? <details className="mt-4 border-t border-zinc-100 pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-emerald-900">Legacy vacation history (read-only)</summary>
          <div className="mt-2 grid gap-1.5">
          {filteredEntries.length ? (
            filteredEntries.map((entry) => {
              const days = dayCountLabel(entry.start_date, entry.end_date);
              const source = entrySources?.[entry.id];
              return (
                <div
                  key={entry.id}
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                >
                  <p className="font-medium text-zinc-900">
                    {formatDateDisplay(entry.start_date)} – {formatDateDisplay(entry.end_date)}
                    {days ? `  · ${days}` : ""}
                  </p>
                  {source ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600">
                        {source.label}
                      </span>
                      {source.balanceAdjusted ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          Balance adjusted
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  {entry.note ? <p className="mt-0.5 text-zinc-500">{entry.note}</p> : null}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-zinc-400">No vacation dates for this year.</p>
          )}
          </div>
        </details> : !leaveRequests.length ? <p className="mt-4 text-sm text-zinc-400">No vacation dates for this year.</p> : null}
      </div>
    </div>
  );
}

function LeaveHistoryItem({ request }: { request: LeaveRequestRow }) {
  const today = new Date().toISOString().slice(0, 10);
  const approvedStart = request.start_date;
  const approvedEnd = request.end_date;
  const isFuture = approvedStart > today;
  const isActive = request.status === "approved" && approvedStart <= today && approvedEnd >= today;

  return (
    <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
      <summary className="cursor-pointer list-none">
        <p className="font-medium text-zinc-900">{leaveTypeLabel(request.leave_type)} · {formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{leaveDisplayStatus(request)} · {formatLeaveDays(Number(request.actual_days ?? request.requested_days))}</p>
      </summary>
      <div className="mt-2 grid gap-2 border-t border-zinc-200 pt-2 text-xs">
        <p>Original approved: {request.approved_start_date ? `${formatLeaveDate(request.approved_start_date)} – ${formatLeaveDate(request.approved_end_date ?? request.approved_start_date)}` : "Not approved"}</p>
        {request.actual_start_date ? <p>Actual: {formatLeaveDate(request.actual_start_date)} – {formatLeaveDate(request.actual_end_date ?? request.actual_start_date)}</p> : null}
        {request.administrative_note ? <p>Administrative note: {request.administrative_note}</p> : null}
        {request.status === "approved" && isFuture ? <form action={editManagedLeaveRequest.bind(null, request.id)} className="grid grid-cols-2 gap-1.5"><input required name="start_date" type="date" defaultValue={request.start_date} className="h-8 rounded border border-zinc-200 px-1" /><input required name="end_date" type="date" defaultValue={request.end_date} className="h-8 rounded border border-zinc-200 px-1" /><input type="hidden" name="duration_type" value={request.duration_type} /><input required name="reason" placeholder="Edit reason" className="col-span-2 h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-emerald-300 font-semibold text-emerald-900">Edit approved dates</button></form> : null}
        {request.status === "approved" && isFuture ? <form action={cancelApprovedLeaveRequest.bind(null, request.id)} className="flex gap-1.5"><input required name="reason" placeholder="Cancellation reason" className="h-8 min-w-0 flex-1 rounded border border-zinc-200 px-2" /><button className="h-8 rounded border border-red-200 px-2 font-semibold text-red-700">Cancel</button></form> : null}
        {request.status === "approved" && !isFuture ? <form action={recordLeaveEarlyReturn.bind(null, request.id)} className="grid grid-cols-2 gap-1.5"><input required name="actual_end_date" type="date" aria-label="Actual last leave date" className="h-8 rounded border border-zinc-200 px-1" /><input required name="return_to_work_date" type="date" aria-label="Return to work date" className="h-8 rounded border border-zinc-200 px-1" /><input required name="reason" placeholder="Early-return reason" className="col-span-2 h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-amber-300 font-semibold text-amber-800">Record Early Return</button></form> : null}
        {isActive ? <form action={cancelActiveLeave.bind(null, request.id)} className="grid grid-cols-2 gap-1.5"><input required name="actual_end_date" type="date" aria-label="Actual last leave date for cancellation" className="h-8 rounded border border-zinc-200 px-1" /><input required name="return_to_work_date" type="date" aria-label="Return to work date for cancellation" className="h-8 rounded border border-zinc-200 px-1" /><input required name="reason" placeholder="Active cancellation reason" className="col-span-2 h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-red-200 font-semibold text-red-700">Cancel Active Leave</button></form> : null}
        {request.status === "approved" || request.status === "returned_early" || request.status === "cancelled" ? <details><summary className="cursor-pointer font-semibold text-emerald-900">Correct Actual Dates</summary><form action={correctLeaveActualDates.bind(null, request.id)} className="mt-1.5 grid grid-cols-2 gap-1.5"><input required name="actual_start_date" type="date" defaultValue={request.actual_start_date ?? approvedStart} className="h-8 rounded border border-zinc-200 px-1" /><input required name="actual_end_date" type="date" defaultValue={request.actual_end_date ?? approvedEnd} className="h-8 rounded border border-zinc-200 px-1" /><input name="return_to_work_date" type="date" defaultValue={request.return_to_work_date ?? ""} className="h-8 rounded border border-zinc-200 px-1" /><input required name="reason" placeholder="Correction reason" className="h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-zinc-300 font-semibold">Save correction</button></form></details> : null}
      </div>
    </details>
  );
}
