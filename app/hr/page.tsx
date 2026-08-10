import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { HrManagementTable } from "@/components/settings/hr-management-table";
import { HrWorkersTable } from "@/components/settings/hr-workers-table";
import {
  LeaveRequestsAdminTable,
  type HrLeaveRequestRow,
} from "@/components/settings/leave-requests-admin-table";
import { requireSettingsManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { HrRow, WorkerHrRow } from "@/app/hr/actions";
import {
  leaveRequestDateBoundaries,
  normalizeLeaveBalance,
  type LeaveBalanceSummary,
  type LeaveRequestRow,
} from "@/lib/hr/leave-requests";

export const dynamic = "force-dynamic";

type HrPageProps = {
  searchParams?: Promise<{
    leaveRequest?: string;
    leaveEmployee?: string;
    leavePreviousPage?: string;
    leaveShowPrevious?: string;
    leaveStatus?: string;
    leaveYear?: string;
    message?: string;
    messageType?: string;
  }>;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
  account_status: string | null;
};

type LeaveBalanceRow = LeaveBalanceSummary & {
  profile_id: string | null;
  worker_id: string | null;
};

export default async function HrManagementPage({ searchParams }: HrPageProps) {
  const { user, profile, displayName } = await requireSettingsManager();
  const params = (await searchParams) ?? {};
  const message = params.message;
  const messageType = params.messageType;

  const adminResult = createAdminClient();
  if (!adminResult.client) {
    throw new Error(adminResult.error ?? "Admin client unavailable");
  }
  const adminClient = adminResult.client;
  const supabase = await createClient();

  const { data: profiles, error: profilesError } = await adminClient
    .from("profiles")
    .select("id,full_name,email,avatar_url,role,account_status")
    .neq("account_status", "pending")
    .order("full_name", { ascending: true })
    .returns<ProfileRow[]>();

  if (profilesError) {
    console.error("HR PAGE PROFILES ERROR", profilesError.message);
  }

  const profileList = profiles ?? [];
  const profileIds = profileList.map((p) => p.id);

  const { data: hrData, error: hrError } = profileIds.length
    ? await adminClient
        .from("profiles_hr")
        .select("*")
        .in("profile_id", profileIds)
        .returns<HrRow[]>()
    : { data: [] as HrRow[], error: null };

  if (hrError) {
    console.error("HR PAGE HR DATA ERROR", hrError.message);
  }

  const { data: workersHrData, error: workersHrError } = await adminClient
    .from("workers")
    .select(
      "id,full_name,date_of_joining,annual_leave_days,leave_taken_this_year,emirates_id_expiry,passport_expiry,emergency_contact_name,emergency_contact_phone,hr_notes,vacation_dates",
    )
    .order("full_name", { ascending: true })
    .returns<WorkerHrRow[]>();

  if (workersHrError) {
    console.error("HR PAGE WORKERS DATA ERROR", workersHrError.message);
  }

  const { data: approvedLeaveRequestsData, error: leaveRequestsError } = await adminClient
    .from("leave_requests")
    .select("profile_id,status,approved_vacation_entry_id,balance_deducted")
    .eq("status", "approved");

  if (leaveRequestsError) {
    console.error("HR PAGE LEAVE REQUESTS ERROR", leaveRequestsError.message);
  }

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
  const leaveStatus = params.leaveStatus && ["draft", "pending_approval", "approved", "rejected", "returned", "cancelled", "returned_early"].includes(params.leaveStatus) ? params.leaveStatus : "";
  const leaveYear = /^\d{4}$/.test(params.leaveYear ?? "") ? params.leaveYear! : "";
  const workerIds = (workersHrData ?? []).map((worker) => worker.id);
  const requestedSubject = params.leaveEmployee ?? "";
  const leaveEmployee = requestedSubject.startsWith("worker:") && workerIds.includes(requestedSubject.slice(7))
    ? requestedSubject
    : requestedSubject.startsWith("profile:") && profileIds.includes(requestedSubject.slice(8))
      ? requestedSubject
      : profileIds.includes(requestedSubject) ? `profile:${requestedSubject}` : "";
  const leaveShowPrevious = params.leaveShowPrevious === "1" || Boolean(params.leaveRequest);
  const leavePreviousPage = Math.max(1, Number.parseInt(params.leavePreviousPage ?? "1", 10) || 1);
  const leavePageSize = 10;
  let relevantLeaveQuery = adminClient.from("leave_requests").select("*").or(relevantFilter);
  let previousLeaveCountQuery = adminClient.from("leave_requests").select("id", { count: "exact", head: true }).or(previousFilter);
  let previousLeaveQuery = adminClient.from("leave_requests").select("*").or(previousFilter);
  if (leaveStatus) {
    relevantLeaveQuery = relevantLeaveQuery.eq("status", leaveStatus);
    previousLeaveCountQuery = previousLeaveCountQuery.eq("status", leaveStatus);
    previousLeaveQuery = previousLeaveQuery.eq("status", leaveStatus);
  }
  if (leaveYear) {
    const yearStart = `${leaveYear}-01-01`;
    const yearEnd = `${leaveYear}-12-31`;
    relevantLeaveQuery = relevantLeaveQuery.gte("start_date", yearStart).lte("start_date", yearEnd);
    previousLeaveCountQuery = previousLeaveCountQuery.gte("start_date", yearStart).lte("start_date", yearEnd);
    previousLeaveQuery = previousLeaveQuery.gte("start_date", yearStart).lte("start_date", yearEnd);
  }
  if (leaveEmployee) {
    const isWorker = leaveEmployee.startsWith("worker:");
    const subjectId = leaveEmployee.slice(isWorker ? 7 : 8);
    const subjectColumn = isWorker ? "worker_id" : "profile_id";
    relevantLeaveQuery = relevantLeaveQuery.eq(subjectColumn, subjectId);
    previousLeaveCountQuery = previousLeaveCountQuery.eq(subjectColumn, subjectId);
    previousLeaveQuery = previousLeaveQuery.eq(subjectColumn, subjectId);
  }
  const [{ data: relevantLeaveData }, { count: previousLeaveCount }, previousLeaveResult, { data: leaveBalanceData }] = await Promise.all([
    relevantLeaveQuery.order("created_at", { ascending: false }).returns<LeaveRequestRow[]>(),
    previousLeaveCountQuery,
    leaveShowPrevious
      ? previousLeaveQuery.order("created_at", { ascending: false }).range((leavePreviousPage - 1) * leavePageSize, leavePreviousPage * leavePageSize - 1).returns<LeaveRequestRow[]>()
      : Promise.resolve({ data: [] as LeaveRequestRow[] }),
    supabase.rpc("list_leave_balances", { p_year: Number(boundaries.today.slice(0, 4)) }),
  ]);

  const profileById = new Map(profileList.map((item) => [item.id, item]));
  const workerById = new Map((workersHrData ?? []).map((item) => [item.id, item]));
  const balanceRows = (leaveBalanceData ?? []) as LeaveBalanceRow[];
  const profileBalances = Object.fromEntries(balanceRows.filter((row) => row.profile_id).map((row) => [row.profile_id!, normalizeLeaveBalance(row)]));
  const workerBalances = Object.fromEntries(balanceRows.filter((row) => row.worker_id).map((row) => [row.worker_id!, normalizeLeaveBalance(row)]));
  const leaveRequests: HrLeaveRequestRow[] = [...(relevantLeaveData ?? []), ...(previousLeaveResult.data ?? [])].map((request) => {
    const employee = request.profile_id ? profileById.get(request.profile_id) : null;
    const worker = request.worker_id ? workerById.get(request.worker_id) : null;
    return {
      ...request,
      employee_name: worker?.full_name || employee?.full_name?.trim() || employee?.email || "Unknown employee",
      subject_kind: request.worker_id ? "worker" as const : "profile" as const,
      available_to_plan: request.worker_id
        ? workerBalances[request.worker_id]?.available_to_plan ?? 0
        : request.profile_id ? profileBalances[request.profile_id]?.available_to_plan ?? 0 : 0,
    };
  });

  const messageClassName =
    messageType === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-950";

  return (
    <ErpAppShell
      eyebrow="SYSTEM"
      title="HR Management"
      description="Manage leave balances and document expiry for all staff."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-4 py-4 sm:px-8 sm:py-6">
        <p className="mb-3 text-sm text-zinc-500 lg:hidden">Manage staff leave and documents.</p>
        <Link
          href="/settings"
          className="mb-5 inline-flex text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
        >
          Back to settings
        </Link>
        {message ? (
          <div className="mb-5">
            <p className={`rounded-md border px-3 py-2 text-sm ${messageClassName}`}>
              {message}
            </p>
          </div>
        ) : null}
        <LeaveRequestsAdminTable
          requests={leaveRequests}
          canApprove={profile?.role === "system_owner" || profile?.role === "admin_manager"}
          currentProfileId={user.id}
          employees={[
            ...profileList.map((employee) => ({ id: `profile:${employee.id}`, name: employee.full_name?.trim() || employee.email || "Unknown employee" })),
            ...(workersHrData ?? []).map((worker) => ({ id: `worker:${worker.id}`, name: `${worker.full_name} (Worker)` })),
          ]}
          filters={{ employee: leaveEmployee, showPrevious: leaveShowPrevious, status: leaveStatus, year: leaveYear }}
          previousCount={previousLeaveCount ?? 0}
          previousPage={leavePreviousPage}
          previousPageSize={leavePageSize}
          selectedRequestId={params.leaveRequest}
        />
        <HrManagementTable
          profiles={profileList}
          hrData={hrData ?? []}
          leaveRequests={approvedLeaveRequestsData ?? []}
          leaveBalances={profileBalances}
        />
        <div className="mt-8">
          <HrWorkersTable workers={workersHrData ?? []} leaveBalances={workerBalances} leaveRequests={leaveRequests.filter((request) => request.worker_id)} />
        </div>
      </div>
    </ErpAppShell>
  );
}
