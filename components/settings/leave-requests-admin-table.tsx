import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  approveLeaveRequest,
  cancelApprovedLeaveRequest,
  rejectLeaveRequest,
  returnLeaveRequest,
} from "@/app/hr/actions";
import {
  formatLeaveDate,
  formatLeaveDays,
  leaveStatusLabel,
  leaveTypeLabel,
  type LeaveRequestRow,
} from "@/lib/hr/leave-requests";

export type HrLeaveRequestRow = LeaveRequestRow & {
  employee_name: string;
  current_balance: number;
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function LeaveRequestsAdminTable({
  canApprove,
  currentProfileId,
  requests,
  selectedRequestId,
}: {
  canApprove: boolean;
  currentProfileId: string;
  requests: HrLeaveRequestRow[];
  selectedRequestId?: string;
}) {
  const pendingCount = requests.filter((request) => request.status === "pending_approval").length;

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm lg:mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">Vacation Requests</h2>
          <p className="mt-1 hidden text-sm text-zinc-500 sm:block">{canApprove ? "System Owner approval queue." : "Read-only queue. Only an active System Owner can decide requests."}</p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">{pendingCount} pending</span>
      </div>

      {requests.length === 0 ? (
        <p className="px-5 py-6 text-sm text-zinc-500">No vacation requests.</p>
      ) : (
        <div className="lg:overflow-x-auto">
          <table className="block w-full text-left text-sm lg:table lg:min-w-[1180px]">
            <thead className="hidden bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 lg:table-header-group">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Leave</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Projected</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Reminder</th>
                <th className="px-4 py-3">Status / Actions</th>
              </tr>
            </thead>
            <tbody className="grid gap-3 p-3 lg:table-row-group lg:p-0">
              {requests.map((request) => {
                const projected = request.status === "pending_approval" && request.leave_type === "annual_leave"
                  ? request.current_balance - Number(request.requested_days)
                  : request.current_balance;
                return (
                  <tr key={request.id} id={request.id} className={`grid grid-cols-2 gap-x-3 rounded-lg border border-zinc-200 p-3 align-top lg:table-row lg:border-0 lg:p-0 ${selectedRequestId === request.id ? "bg-emerald-50/60" : ""}`}>
                    <td className="col-span-2 pb-2 font-medium text-zinc-950 lg:table-cell lg:px-4 lg:py-3">{request.employee_name}</td>
                    <td className="col-start-1 row-start-2 py-1 lg:table-cell lg:px-4 lg:py-3">
                      <span className="block text-[10px] font-semibold uppercase text-zinc-400 lg:hidden">Leave</span>
                      {leaveTypeLabel(request.leave_type)}
                    </td>
                    <td className="col-span-2 row-start-3 py-1 whitespace-nowrap lg:table-cell lg:px-4 lg:py-3">
                      <span className="block text-[10px] font-semibold uppercase text-zinc-400 lg:hidden">Dates</span>
                      {formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)}
                    </td>
                    <td className="col-start-2 row-start-2 py-1 text-right lg:table-cell lg:px-4 lg:py-3">
                      <span className="block text-[10px] font-semibold uppercase text-zinc-400 lg:hidden">Days</span>
                      {formatLeaveDays(Number(request.requested_days))}
                    </td>
                    <td className="hidden px-4 py-3 text-right lg:table-cell">{request.current_balance}</td>
                    <td className="hidden px-4 py-3 text-right lg:table-cell">{projected}</td>
                    <td className="hidden px-4 py-3 whitespace-nowrap lg:table-cell">{dateTime(request.submitted_at)}</td>
                    <td className="hidden px-4 py-3 whitespace-nowrap lg:table-cell">{dateTime(request.last_reminder_at)}</td>
                    <td className="col-span-2 row-start-4 pt-2 lg:table-cell lg:px-4 lg:py-3">
                      <p className="font-semibold text-zinc-800">{leaveStatusLabel(request.status)}</p>
                      <details open={selectedRequestId === request.id} className="mt-1 text-xs text-zinc-600">
                        <summary className="cursor-pointer font-semibold text-emerald-900">View</summary>
                        <div className="mt-1 grid gap-1 rounded-md bg-zinc-50 p-2">
                          <div className="mb-1 grid grid-cols-2 gap-2 lg:hidden">
                            <p><span className="font-semibold">Balance:</span> {request.current_balance}</p>
                            <p><span className="font-semibold">Projected:</span> {projected}</p>
                            <p className="col-span-2"><span className="font-semibold">Submitted:</span> {dateTime(request.submitted_at)}</p>
                            <p className="col-span-2"><span className="font-semibold">Reminder:</span> {dateTime(request.last_reminder_at)}</p>
                          </div>
                          <p><span className="font-semibold">Reason:</span> {request.reason || "—"}</p>
                          <p><span className="font-semibold">Handover:</span> {request.handover_note || "—"}</p>
                          {request.decision_reason ? <p><span className="font-semibold">Decision:</span> {request.decision_reason}</p> : null}
                          {request.return_reason ? <p><span className="font-semibold">Return:</span> {request.return_reason}</p> : null}
                          {request.cancellation_reason ? <p><span className="font-semibold">Cancellation:</span> {request.cancellation_reason}</p> : null}
                        </div>
                      </details>
                      {canApprove && request.status === "pending_approval" && request.profile_id !== currentProfileId ? (
                        <div className="mt-2 grid gap-2">
                          <form action={approveLeaveRequest.bind(null, request.id)}>
                            <PendingSubmitButton className="rounded-md bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white">Approve</PendingSubmitButton>
                          </form>
                          <form action={rejectLeaveRequest.bind(null, request.id)} className="flex gap-1">
                            <input required name="reason" placeholder="Rejection reason" className="h-8 min-w-0 rounded-md border border-zinc-200 px-2 text-xs" />
                            <PendingSubmitButton className="rounded-md border border-red-200 px-2 text-xs font-semibold text-red-700">Reject</PendingSubmitButton>
                          </form>
                          <form action={returnLeaveRequest.bind(null, request.id)} className="flex gap-1">
                            <input required name="reason" placeholder="Required changes" className="h-8 min-w-0 rounded-md border border-zinc-200 px-2 text-xs" />
                            <PendingSubmitButton className="rounded-md border border-violet-200 px-2 text-xs font-semibold text-violet-700">Return</PendingSubmitButton>
                          </form>
                        </div>
                      ) : null}
                      {canApprove && request.status === "pending_approval" && request.profile_id === currentProfileId ? (
                        <p className="mt-2 text-xs text-amber-700">Self-approval is not permitted.</p>
                      ) : null}
                      {canApprove && request.status === "approved" ? (
                        <form action={cancelApprovedLeaveRequest.bind(null, request.id)} className="mt-2 flex gap-1">
                          <input required name="reason" placeholder="Cancellation reason" className="h-8 min-w-0 rounded-md border border-zinc-200 px-2 text-xs" />
                          <PendingSubmitButton className="rounded-md border border-red-200 px-2 text-xs font-semibold text-red-700">Cancel Approved</PendingSubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
