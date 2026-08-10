import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { LeaveBalanceSummaryDisplay } from "@/components/settings/leave-balance-summary";
import { LeaveRequestForm } from "@/components/settings/leave-request-form";
import {
  cancelMyLeaveRequest,
  createLeaveRequest,
  remindLeaveRequest,
  submitLeaveRequest,
  updateLeaveRequest,
} from "@/app/settings/profile/vacation-requests/actions";
import { requireActiveUser } from "@/lib/auth";
import {
  formatLeaveDate,
  formatLeaveDays,
  leaveDisplayStatus,
  leaveRequestDateBoundaries,
  leaveRequestGroup,
  leaveTypeLabel,
  type LeaveRequestRow,
  normalizeLeaveBalance,
} from "@/lib/hr/leave-requests";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    message?: string;
    messageType?: string;
    previousPage?: string;
    request?: string;
    showPrevious?: string;
    status?: string;
    year?: string;
  }>;
};

type HrBalanceRow = {
  annual_leave_days: number;
  leave_taken_this_year: number;
};

type AuditRow = {
  id: string;
  entity_id: string;
  action: string;
  title: string;
  created_at: string;
};

function statusClass(status: string) {
  if (status === "approved") return "bg-emerald-50 text-emerald-800";
  if (status === "rejected" || status === "cancelled") return "bg-red-50 text-red-700";
  if (status === "pending_approval") return "bg-amber-50 text-amber-800";
  if (status === "returned") return "bg-violet-50 text-violet-700";
  return "bg-zinc-100 text-zinc-700";
}

export default async function VacationRequestsPage({ searchParams }: PageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const params = (await searchParams) ?? {};
  const supabase = await createClient();
  const boundaries = leaveRequestDateBoundaries();
  const recentCutoffTimestamp = `${boundaries.recentCutoff}T00:00:00.000Z`;
  const relevantFilter = [
    "status.in.(draft,pending_approval,returned)",
    `and(status.eq.approved,end_date.gte.${boundaries.recentCutoff})`,
    `and(status.in.(rejected,cancelled,returned_early),updated_at.gte.${recentCutoffTimestamp})`,
  ].join(",");
  const previousFilter = [
    `and(status.eq.approved,end_date.lt.${boundaries.recentCutoff})`,
    `and(status.in.(rejected,cancelled,returned_early),updated_at.lt.${recentCutoffTimestamp})`,
  ].join(",");
  const status = params.status && ["draft", "pending_approval", "approved", "rejected", "returned", "cancelled", "returned_early"].includes(params.status)
    ? params.status
    : "";
  const year = /^\d{4}$/.test(params.year ?? "") ? params.year! : "";
  const showPrevious = params.showPrevious === "1" || Boolean(params.request);
  const previousPage = Math.max(1, Number.parseInt(params.previousPage ?? "1", 10) || 1);
  const pageSize = 10;

  let relevantQuery = supabase
    .from("leave_requests")
    .select("*")
    .eq("profile_id", user.id)
    .or(relevantFilter);
  let previousCountQuery = supabase
    .from("leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .or(previousFilter);
  let previousQuery = supabase
    .from("leave_requests")
    .select("*")
    .eq("profile_id", user.id)
    .or(previousFilter);
  if (status) {
    relevantQuery = relevantQuery.eq("status", status);
    previousCountQuery = previousCountQuery.eq("status", status);
    previousQuery = previousQuery.eq("status", status);
  }
  if (year) {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    relevantQuery = relevantQuery.gte("start_date", yearStart).lte("start_date", yearEnd);
    previousCountQuery = previousCountQuery.gte("start_date", yearStart).lte("start_date", yearEnd);
    previousQuery = previousQuery.gte("start_date", yearStart).lte("start_date", yearEnd);
  }

  const [{ data: requestsData }, { data: hrData }, { count: previousCount }, { data: balanceData }] = await Promise.all([
    relevantQuery.order("created_at", { ascending: false }),
    supabase
      .from("profiles_hr")
      .select("annual_leave_days,leave_taken_this_year")
      .eq("profile_id", user.id)
      .maybeSingle<HrBalanceRow>(),
    previousCountQuery,
    supabase.rpc("get_leave_balance", {
      p_profile_id: user.id,
      p_worker_id: null,
      p_year: Number(boundaries.today.slice(0, 4)),
    }),
  ]);
  const { data: previousData } = showPrevious
    ? await previousQuery
        .order("created_at", { ascending: false })
        .range((previousPage - 1) * pageSize, previousPage * pageSize - 1)
    : { data: [] };
  const requests = (requestsData ?? []) as LeaveRequestRow[];
  const previousRequests = (previousData ?? []) as LeaveRequestRow[];
  const visibleRequests = [...requests, ...previousRequests];
  const requestIds = visibleRequests.map((request) => request.id);
  const { data: historyData } = requestIds.length
    ? await supabase
        .from("audit_activity_log")
        .select("id,entity_id,action,title,created_at")
        .eq("entity_type", "leave_request")
        .in("entity_id", requestIds)
        .order("created_at", { ascending: false })
    : { data: [] as AuditRow[] };
  const history = (historyData ?? []) as AuditRow[];
  const leaveBalance = normalizeLeaveBalance(Array.isArray(balanceData) ? balanceData[0] : balanceData);
  const currentBalance = leaveBalance.available_to_plan;
  const selectedRequest = visibleRequests.find((request) => request.id === params.request) ?? null;
  const currentRequests = requests.filter((request) => leaveRequestGroup(request, boundaries) === "current");
  const recentRequests = requests.filter((request) => leaveRequestGroup(request, boundaries) === "recent");
  const previousTotal = previousCount ?? 0;
  const previousPages = Math.max(1, Math.ceil(previousTotal / pageSize));
  const requestUrl = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ status: status || undefined, year: year || undefined, ...overrides })) {
      if (value) query.set(key, value);
    }
    return `/settings/profile/vacation-requests${query.size ? `?${query.toString()}` : ""}`;
  };
  const messageClass = params.messageType === "error"
    ? "border-red-200 bg-red-50 text-red-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <ErpAppShell
      eyebrow="SYSTEM"
      title="Vacation Requests"
      description="Apply for leave and follow your approval status."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-6 sm:px-8">
        <Link href="/settings/profile" className="w-fit text-sm font-semibold text-emerald-900">Back to My Profile</Link>
        {params.message ? <p className={`rounded-md border px-3 py-2 text-sm ${messageClass}`}>{params.message}</p> : null}

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Apply for Vacation</h2>
              <p className="mt-1 text-sm text-zinc-500">Save a draft or submit it to the HR approval queue.</p>
            </div>
            <details className="min-w-52 rounded-md bg-emerald-50 px-3 py-2 text-sm">
              <summary className="cursor-pointer list-none">
                <LeaveBalanceSummaryDisplay balance={leaveBalance} />
                <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Full breakdown</span>
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-emerald-100 pt-2 text-xs text-zinc-600">
                <span>Remaining entitlement</span><strong className="text-right text-zinc-800">{leaveBalance.remaining_entitlement}</strong>
                <span>Requested</span><strong className="text-right text-zinc-800">{leaveBalance.requested}</strong>
                <span>Planned</span><strong className="text-right text-zinc-800">{leaveBalance.planned}</strong>
                <span>On Leave</span><strong className="text-right text-zinc-800">{leaveBalance.active}</strong>
                <span>Taken</span><strong className="text-right text-zinc-800">{leaveBalance.taken}</strong>
              </div>
            </details>
          </div>
          {hrData ? (
            <LeaveRequestForm action={createLeaveRequest} currentBalance={currentBalance} />
          ) : (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Your HR leave record must be set up before you can apply.</p>
          )}
          {leaveBalance.approval_risk ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Pending requests would exceed the available annual entitlement if all were approved.</p> : null}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-zinc-950">My Requests</h2>
            <form className="flex flex-wrap items-center gap-2" method="get">
              <select name="status" defaultValue={status} aria-label="Filter by status" className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs">
                <option value="">All statuses</option>
                <option value="draft">Draft</option><option value="pending_approval">Pending approval</option><option value="approved">Approved</option>
                <option value="rejected">Rejected</option><option value="returned">Returned</option><option value="cancelled">Cancelled</option><option value="returned_early">Returned early</option>
              </select>
              <input type="number" name="year" defaultValue={year} min="1900" max={Number(boundaries.today.slice(0, 4)) + 1} placeholder="All years" aria-label="Filter by year" className="h-8 w-24 rounded-md border border-zinc-200 bg-white px-2 text-xs" />
              <label className="flex items-center gap-1.5 text-xs text-zinc-600"><input type="checkbox" name="showPrevious" value="1" defaultChecked={showPrevious} /> Show previous requests</label>
              <button className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700">Apply</button>
            </form>
          </div>
          {currentRequests.length === 0 ? <p className="mt-4 text-sm text-zinc-500">No current or pending vacation requests.</p> : null}
          {(["Current & Pending", "Recent"] as const).map((heading) => {
            const groupedRequests = heading === "Current & Pending" ? currentRequests : recentRequests;
            if (!groupedRequests.length) return null;
            return <div key={heading} className="mt-5"><h3 className="text-sm font-semibold text-zinc-800">{heading}</h3><div className="mt-2 grid gap-3">
              {groupedRequests.map((request) => {
                const canEdit = request.status === "draft" || request.status === "returned";
                const canCancel = request.status === "draft" || request.status === "pending_approval";
                const reminderAt = request.last_reminder_at
                  ? new Date(new Date(request.last_reminder_at).getTime() + 86_400_000)
                  : null;
                const canRemind = request.status === "pending_approval" && (!reminderAt || reminderAt <= new Date());
                const requestHistory = history.filter((entry) => entry.entity_id === request.id);
                const projectedBalance = request.leave_type === "annual_leave"
                  ? currentBalance - Number(request.requested_days)
                  : currentBalance;

                return (
                  <article key={request.id} id={request.id} className={`rounded-lg border p-3 sm:p-4 ${selectedRequest?.id === request.id ? "border-emerald-500 ring-2 ring-emerald-100" : "border-zinc-200"}`}>
                    <details open={selectedRequest?.id === request.id} className="group sm:contents">
                      <summary className="cursor-pointer list-none sm:hidden">
                        <div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate font-semibold text-zinc-950">{leaveTypeLabel(request.leave_type)} · {formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)}</p><span aria-hidden="true" className="shrink-0 text-zinc-400 transition group-open:rotate-90">›</span></div>
                        <p className="mt-1 text-xs text-zinc-500">{leaveDisplayStatus(request)} · {formatLeaveDays(Number(request.actual_days ?? request.requested_days))}</p>
                      </summary>
                    <div className="mt-3 hidden sm:!mt-0 sm:!block">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-zinc-950">{leaveTypeLabel(request.leave_type)}</p>
                        <p className="mt-1 text-sm text-zinc-600">{formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)} · {formatLeaveDays(Number(request.requested_days))}</p>
                        <p className="mt-1 text-xs text-zinc-500">Submitted: {request.submitted_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.submitted_at)) : "Not submitted"}</p>
                        {request.status === "draft" || request.status === "returned" || request.status === "pending_approval" ? (
                          <p className="mt-1 text-xs text-zinc-500">Current balance: {currentBalance} · Projected: {projectedBalance}</p>
                        ) : null}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(request.status)}`}>{leaveDisplayStatus(request)}</span>
                    </div>

                    {request.decision_reason ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Decision: {request.decision_reason}</p> : null}
                    {request.return_reason ? <p className="mt-3 rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-700">Changes requested: {request.return_reason}</p> : null}
                    {request.cancellation_reason ? <p className="mt-3 text-sm text-zinc-600">Cancellation: {request.cancellation_reason}</p> : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {request.status === "draft" ? (
                        <form action={submitLeaveRequest.bind(null, request.id)}><PendingSubmitButton className="rounded-md bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white">Submit</PendingSubmitButton></form>
                      ) : null}
                      {request.status === "pending_approval" ? (
                        <form action={remindLeaveRequest.bind(null, request.id)}><PendingSubmitButton disabled={!canRemind} className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800">{canRemind ? "Send Reminder" : `Reminder after ${reminderAt?.toLocaleString()}`}</PendingSubmitButton></form>
                      ) : null}
                      {canCancel ? (
                        <form action={cancelMyLeaveRequest.bind(null, request.id)} className="flex gap-2">
                          <input name="reason" aria-label="Cancellation reason" placeholder="Cancellation reason (optional)" className="h-8 rounded-md border border-zinc-200 px-2 text-xs" />
                          <PendingSubmitButton className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700">Cancel</PendingSubmitButton>
                        </form>
                      ) : null}
                    </div>

                    {canEdit ? (
                      <details className="mt-4 border-t border-zinc-100 pt-3">
                        <summary className="cursor-pointer text-sm font-semibold text-emerald-900">Edit request</summary>
                        <div className="mt-3"><LeaveRequestForm action={updateLeaveRequest.bind(null, request.id)} currentBalance={currentBalance} request={request} /></div>
                      </details>
                    ) : null}

                    <details className="mt-3 border-t border-zinc-100 pt-3">
                      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500">Request history</summary>
                      <ul className="mt-2 grid gap-1 text-sm text-zinc-600">
                        {requestHistory.map((entry) => <li key={entry.id}>{entry.title} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at))}</li>)}
                      </ul>
                    </details>
                    </div>
                    </details>
                  </article>
                );
              })}
            </div></div>;
          })}

          <div className="mt-5 border-t border-zinc-100 pt-4">
            {showPrevious ? (
              <>
                <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-zinc-800">Previous Requests ({previousTotal})</h3><Link href={requestUrl({ showPrevious: undefined, previousPage: undefined })} className="text-xs font-semibold text-emerald-900">Close</Link></div>
                {previousRequests.length ? <div className="mt-2 grid gap-2">{previousRequests.map((request) => {
                  const requestHistory = history.filter((entry) => entry.entity_id === request.id);
                  return <details key={request.id} className="group rounded-md border border-zinc-200 px-3 py-2"><summary className="cursor-pointer list-none"><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate font-semibold text-zinc-900">{leaveTypeLabel(request.leave_type)} · {formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)}</p><span aria-hidden="true" className="shrink-0 text-zinc-400 transition group-open:rotate-90">›</span></div><p className="mt-1 text-xs text-zinc-500">{leaveDisplayStatus(request)} · {formatLeaveDays(Number(request.actual_days ?? request.requested_days))}</p></summary><div className="mt-3 border-t border-zinc-100 pt-2 text-sm text-zinc-600">{request.decision_reason ? <p>Decision: {request.decision_reason}</p> : null}{request.cancellation_reason ? <p>Cancellation: {request.cancellation_reason}</p> : null}{request.early_return_reason ? <p>Early return: {request.early_return_reason}</p> : null}<p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Request history</p><ul className="mt-1 grid gap-1">{requestHistory.map((entry) => <li key={entry.id}>{entry.title} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at))}</li>)}</ul></div></details>;
                })}</div> : <p className="mt-3 text-sm text-zinc-500">No previous vacation requests.</p>}
                {previousPages > 1 ? <div className="mt-3 flex items-center justify-between text-xs"><span>Page {Math.min(previousPage, previousPages)} of {previousPages}</span><div className="flex gap-2">{previousPage > 1 ? <Link href={requestUrl({ showPrevious: "1", previousPage: String(previousPage - 1) })} className="font-semibold text-emerald-900">Previous</Link> : null}{previousPage < previousPages ? <Link href={requestUrl({ showPrevious: "1", previousPage: String(previousPage + 1) })} className="font-semibold text-emerald-900">Next</Link> : null}</div></div> : null}
              </>
            ) : (
              <Link href={requestUrl({ showPrevious: "1", previousPage: undefined })} className="flex w-full items-center justify-between text-sm font-semibold text-emerald-900"><span>Previous Requests ({previousTotal})</span><span aria-hidden="true">›</span></Link>
            )}
          </div>
        </section>
      </div>
    </ErpAppShell>
  );
}
