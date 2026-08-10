import Link from "next/link";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import {
  approveLeaveRequest,
  cancelActiveLeave,
  cancelApprovedLeaveRequest,
  correctLeaveActualDates,
  editManagedLeaveRequest,
  recordLeaveEarlyReturn,
  rejectLeaveRequest,
  returnLeaveRequest,
} from "@/app/hr/actions";
import {
  formatLeaveDate,
  formatLeaveDays,
  leaveDisplayStatus,
  leaveRequestDateBoundaries,
  leaveRequestGroup,
  leaveTypeLabel,
  type LeaveRequestRow,
} from "@/lib/hr/leave-requests";

export type HrLeaveRequestRow = LeaveRequestRow & {
  employee_name: string;
  available_to_plan: number;
  subject_kind: "profile" | "worker";
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function LeaveRequestsAdminTable({
  canApprove,
  currentProfileId,
  employees,
  filters,
  previousCount,
  previousPage,
  previousPageSize,
  requests,
  selectedRequestId,
}: {
  canApprove: boolean;
  currentProfileId: string;
  employees: Array<{ id: string; name: string }>;
  filters: { employee: string; showPrevious: boolean; status: string; year: string };
  previousCount: number;
  previousPage: number;
  previousPageSize: number;
  requests: HrLeaveRequestRow[];
  selectedRequestId?: string;
}) {
  const pendingCount = requests.filter((request) => request.status === "pending_approval").length;
  const boundaries = leaveRequestDateBoundaries();
  const sortedRequests = [...requests].sort((left, right) => {
    const order = { current: 0, recent: 1, previous: 2 };
    return order[leaveRequestGroup(left, boundaries)] - order[leaveRequestGroup(right, boundaries)];
  });
  const currentCount = requests.filter((request) => leaveRequestGroup(request, boundaries) === "current").length;
  const previousPages = Math.max(1, Math.ceil(previousCount / previousPageSize));
  const requestsUrl = (showPrevious: boolean, page?: number) => {
    const query = new URLSearchParams();
    if (filters.status) query.set("leaveStatus", filters.status);
    if (filters.year) query.set("leaveYear", filters.year);
    if (filters.employee) query.set("leaveEmployee", filters.employee);
    if (showPrevious) query.set("leaveShowPrevious", "1");
    if (page && page > 1) query.set("leavePreviousPage", String(page));
    return `/hr${query.size ? `?${query.toString()}` : ""}`;
  };

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm lg:mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">Vacation Requests</h2>
          <p className="mt-1 hidden text-sm text-zinc-500 sm:block">{canApprove ? "System Owner and Admin Manager approval queue." : "Read-only vacation queue."}</p>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">{pendingCount} pending</span>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3 sm:px-5">
        <select name="leaveStatus" defaultValue={filters.status} aria-label="Filter vacation requests by status" className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs">
          <option value="">All statuses</option><option value="draft">Draft</option><option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="returned">Returned</option><option value="cancelled">Cancelled</option><option value="returned_early">Returned early</option>
        </select>
        <input type="number" name="leaveYear" defaultValue={filters.year} min="1900" max={Number(boundaries.today.slice(0, 4)) + 1} placeholder="All years" aria-label="Filter vacation requests by year" className="h-8 w-24 rounded-md border border-zinc-200 bg-white px-2 text-xs" />
        <select name="leaveEmployee" defaultValue={filters.employee} aria-label="Filter vacation requests by employee" className="h-8 max-w-48 rounded-md border border-zinc-200 bg-white px-2 text-xs">
          <option value="">All employees</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600"><input type="checkbox" name="leaveShowPrevious" value="1" defaultChecked={filters.showPrevious} /> Show previous requests</label>
        <button className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700">Apply</button>
      </form>

      {currentCount === 0 ? <p className="px-5 pt-4 text-sm text-zinc-500">No current or pending vacation requests.</p> : null}
      {requests.length > 0 ? (
        <div className="lg:overflow-x-auto">
          <table className="block w-full text-left text-sm lg:table lg:min-w-[1024px]">
            <thead className="hidden bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 lg:table-header-group">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Leave</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3 text-right">Days</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Available After</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="grid gap-3 p-3 lg:table-row-group lg:p-0">
              {sortedRequests.flatMap((request, index) => {
                const group = leaveRequestGroup(request, boundaries);
                const previousGroup = index > 0 ? leaveRequestGroup(sortedRequests[index - 1], boundaries) : null;
                const heading = group === "current" ? "Current & Pending" : group === "recent" ? "Recent" : "Previous Requests";
                const isPendingAnnual = request.status === "pending_approval" && request.leave_type === "annual_leave";
                const availableAfter = isPendingAnnual
                  ? request.available_to_plan - Number(request.requested_days)
                  : request.available_to_plan;
                const approvedStart = request.start_date;
                const approvedEnd = request.end_date;
                const today = boundaries.today;
                const isFuture = approvedStart > today;
                const isActive = request.status === "approved" && approvedStart <= today && approvedEnd >= today;
                return [
                  group !== previousGroup ? <tr key={`${group}-heading`} className="block lg:table-row"><th colSpan={8} className="block px-1 pt-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 lg:table-cell lg:bg-zinc-50 lg:px-4 lg:py-2">{heading}</th></tr> : null,
                  <tr key={request.id} id={request.id} className={`grid grid-cols-1 rounded-lg border border-zinc-200 p-3 align-top lg:table-row lg:border-0 lg:p-0 ${selectedRequestId === request.id ? "bg-emerald-50/60" : ""}`}>
                    <td className="min-w-0 pb-1 lg:table-cell lg:px-4 lg:py-3"><p className="truncate font-semibold text-zinc-950">{request.employee_name}</p><p className="mt-0.5 text-xs text-zinc-500 lg:hidden">{leaveTypeLabel(request.leave_type)} · {formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)}</p></td>
                    <td className="hidden lg:table-cell lg:px-4 lg:py-3">
                      <span className="block text-[10px] font-semibold uppercase text-zinc-400 lg:hidden">Leave</span>
                      {leaveTypeLabel(request.leave_type)}
                    </td>
                    <td className="hidden whitespace-nowrap lg:table-cell lg:px-4 lg:py-3">
                      <span className="block text-[10px] font-semibold uppercase text-zinc-400 lg:hidden">Dates</span>
                      {formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)}
                    </td>
                    <td className="hidden text-right lg:table-cell lg:px-4 lg:py-3">
                      <span className="block text-[10px] font-semibold uppercase text-zinc-400 lg:hidden">Days</span>
                      {formatLeaveDays(Number(request.requested_days))}
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell"><span className="font-semibold text-zinc-800">{leaveDisplayStatus(request)}</span></td>
                    <td className="hidden px-4 py-3 text-right lg:table-cell"><span className="font-medium text-zinc-800">{formatLeaveDays(availableAfter)}</span>{isPendingAnnual ? <span className="block text-[10px] text-zinc-500">if approved</span> : null}</td>
                    <td className="hidden px-4 py-3 whitespace-nowrap lg:table-cell">{dateTime(request.submitted_at)}</td>
                    <td className="lg:table-cell lg:px-4 lg:py-3">
                      <p className="text-xs text-zinc-500 lg:hidden">{leaveDisplayStatus(request)} · {formatLeaveDays(Number(request.actual_days ?? request.requested_days))}</p>
                      <p className="mt-1 text-xs font-medium text-zinc-700 lg:hidden">{isPendingAnnual ? `Available now: ${formatLeaveDays(request.available_to_plan)} · If approved: ${formatLeaveDays(availableAfter)}` : `Available after: ${formatLeaveDays(availableAfter)}`}</p>
                      <details open={selectedRequestId === request.id} className="mt-1 text-xs text-zinc-600">
                        <summary className="cursor-pointer font-semibold text-emerald-900">View</summary>
                        <div className="mt-1 grid gap-1 rounded-md bg-zinc-50 p-2">
                          <p><span className="font-semibold">Current available:</span> {formatLeaveDays(request.available_to_plan)}</p>
                          {isPendingAnnual ? <p><span className="font-semibold">Would leave:</span> {formatLeaveDays(availableAfter)} if approved</p> : null}
                          <p className="lg:hidden"><span className="font-semibold">Submitted:</span> {dateTime(request.submitted_at)}</p>
                          <p><span className="font-semibold">Reminder:</span> {dateTime(request.last_reminder_at)}</p>
                          <p><span className="font-semibold">Reason:</span> {request.reason || "—"}</p>
                          <p><span className="font-semibold">Handover:</span> {request.handover_note || "—"}</p>
                          {request.decision_reason ? <p><span className="font-semibold">Decision:</span> {request.decision_reason}</p> : null}
                          {request.return_reason ? <p><span className="font-semibold">Return:</span> {request.return_reason}</p> : null}
                          {request.cancellation_reason ? <p><span className="font-semibold">Cancellation:</span> {request.cancellation_reason}</p> : null}
                          {request.early_return_reason ? <p><span className="font-semibold">Early return:</span> {request.early_return_reason}</p> : null}
                          {request.approved_start_date ? <p><span className="font-semibold">Original approved:</span> {formatLeaveDate(request.approved_start_date)} – {formatLeaveDate(request.approved_end_date ?? request.approved_start_date)}</p> : null}
                          {request.actual_start_date ? <p><span className="font-semibold">Actual:</span> {formatLeaveDate(request.actual_start_date)} – {formatLeaveDate(request.actual_end_date ?? request.actual_start_date)}</p> : null}
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
                      {canApprove && request.status === "approved" && isFuture ? (
                        <form action={cancelApprovedLeaveRequest.bind(null, request.id)} className="mt-2 flex gap-1">
                          <input required name="reason" placeholder="Cancellation reason" className="h-8 min-w-0 rounded-md border border-zinc-200 px-2 text-xs" />
                          <PendingSubmitButton className="rounded-md border border-red-200 px-2 text-xs font-semibold text-red-700">Cancel Approved</PendingSubmitButton>
                        </form>
                      ) : null}
                      {canApprove && request.status === "approved" && isFuture ? (
                        <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-emerald-900">Edit dates</summary><form action={editManagedLeaveRequest.bind(null, request.id)} className="mt-1 grid grid-cols-2 gap-1"><input required name="start_date" type="date" defaultValue={request.start_date} className="h-8 rounded border border-zinc-200 px-1" /><input required name="end_date" type="date" defaultValue={request.end_date} className="h-8 rounded border border-zinc-200 px-1" /><input type="hidden" name="duration_type" value={request.duration_type} /><input required name="reason" placeholder="Required edit reason" className="col-span-2 h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-emerald-300 font-semibold text-emerald-900">Save dates</button></form></details>
                      ) : null}
                      {canApprove && request.status === "approved" && approvedStart <= today ? (
                        <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-amber-800">Record Early Return</summary><form action={recordLeaveEarlyReturn.bind(null, request.id)} className="mt-1 grid grid-cols-2 gap-1"><input required name="actual_end_date" type="date" aria-label="Actual last leave date" className="h-8 rounded border border-zinc-200 px-1" /><input required name="return_to_work_date" type="date" aria-label="Return to work date" className="h-8 rounded border border-zinc-200 px-1" /><input required name="reason" placeholder="Required reason" className="col-span-2 h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-amber-300 font-semibold text-amber-800">Record return</button></form></details>
                      ) : null}
                      {canApprove && isActive ? (
                        <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-red-700">Cancel Active Leave</summary><form action={cancelActiveLeave.bind(null, request.id)} className="mt-1 grid grid-cols-2 gap-1"><input required name="actual_end_date" type="date" aria-label="Actual last leave date for cancellation" className="h-8 rounded border border-zinc-200 px-1" /><input required name="return_to_work_date" type="date" aria-label="Return to work date for cancellation" className="h-8 rounded border border-zinc-200 px-1" /><input required name="reason" placeholder="Required reason" className="col-span-2 h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-red-200 font-semibold text-red-700">Cancel active leave</button></form></details>
                      ) : null}
                      {canApprove && ["approved", "returned_early", "cancelled"].includes(request.status) ? (
                        <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold text-zinc-700">Correct Actual Dates</summary><form action={correctLeaveActualDates.bind(null, request.id)} className="mt-1 grid grid-cols-2 gap-1"><input required name="actual_start_date" type="date" defaultValue={request.actual_start_date ?? approvedStart} className="h-8 rounded border border-zinc-200 px-1" /><input required name="actual_end_date" type="date" defaultValue={request.actual_end_date ?? approvedEnd} className="h-8 rounded border border-zinc-200 px-1" /><input name="return_to_work_date" type="date" defaultValue={request.return_to_work_date ?? ""} className="h-8 rounded border border-zinc-200 px-1" /><input required name="reason" placeholder="Required reason" className="h-8 rounded border border-zinc-200 px-2" /><button className="col-span-2 h-8 rounded border border-zinc-300 font-semibold">Save correction</button></form></details>
                      ) : null}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
        {filters.showPrevious ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs"><span className="font-semibold text-zinc-700">Previous Requests ({previousCount}) · Page {Math.min(previousPage, previousPages)} of {previousPages}</span><div className="flex gap-3">{previousPage > 1 ? <Link href={requestsUrl(true, previousPage - 1)} className="font-semibold text-emerald-900">Previous</Link> : null}{previousPage < previousPages ? <Link href={requestsUrl(true, previousPage + 1)} className="font-semibold text-emerald-900">Next</Link> : null}<Link href={requestsUrl(false)} className="font-semibold text-emerald-900">Close</Link></div></div>
        ) : (
          <Link href={requestsUrl(true)} className="flex items-center justify-between text-sm font-semibold text-emerald-900"><span>Previous Requests ({previousCount})</span><span aria-hidden="true">›</span></Link>
        )}
        {filters.showPrevious && previousCount === 0 ? <p className="mt-2 text-sm text-zinc-500">No previous vacation requests.</p> : null}
      </div>
    </section>
  );
}
