import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
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
  leaveStatusLabel,
  leaveTypeLabel,
  type LeaveRequestRow,
} from "@/lib/hr/leave-requests";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ message?: string; messageType?: string; request?: string }>;
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

  const [{ data: requestsData }, { data: hrData }] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("*")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles_hr")
      .select("annual_leave_days,leave_taken_this_year")
      .eq("profile_id", user.id)
      .maybeSingle<HrBalanceRow>(),
  ]);

  const requests = (requestsData ?? []) as LeaveRequestRow[];
  const requestIds = requests.map((request) => request.id);
  const { data: historyData } = requestIds.length
    ? await supabase
        .from("audit_activity_log")
        .select("id,entity_id,action,title,created_at")
        .eq("entity_type", "leave_request")
        .in("entity_id", requestIds)
        .order("created_at", { ascending: false })
    : { data: [] as AuditRow[] };
  const history = (historyData ?? []) as AuditRow[];
  const currentBalance = hrData
    ? Number(hrData.annual_leave_days) - Number(hrData.leave_taken_this_year)
    : 0;
  const selectedRequest = requests.find((request) => request.id === params.request) ?? null;
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
              <p className="mt-1 text-sm text-zinc-500">Save a draft or submit it directly to the System Owner queue.</p>
            </div>
            <p className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">Balance: {currentBalance} days</p>
          </div>
          {hrData ? (
            <LeaveRequestForm action={createLeaveRequest} currentBalance={currentBalance} />
          ) : (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Your HR leave record must be set up before you can apply.</p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-zinc-950">My Requests</h2>
          {requests.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No vacation requests yet.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {requests.map((request) => {
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
                  <article key={request.id} id={request.id} className={`rounded-lg border p-4 ${selectedRequest?.id === request.id ? "border-emerald-500 ring-2 ring-emerald-100" : "border-zinc-200"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-zinc-950">{leaveTypeLabel(request.leave_type)}</p>
                        <p className="mt-1 text-sm text-zinc-600">{formatLeaveDate(request.start_date)} – {formatLeaveDate(request.end_date)} · {formatLeaveDays(Number(request.requested_days))}</p>
                        <p className="mt-1 text-xs text-zinc-500">Submitted: {request.submitted_at ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(request.submitted_at)) : "Not submitted"}</p>
                        {request.status === "draft" || request.status === "returned" || request.status === "pending_approval" ? (
                          <p className="mt-1 text-xs text-zinc-500">Current balance: {currentBalance} · Projected: {projectedBalance}</p>
                        ) : null}
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(request.status)}`}>{leaveStatusLabel(request.status)}</span>
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
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </ErpAppShell>
  );
}
