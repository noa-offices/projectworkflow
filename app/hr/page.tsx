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
import type { HrRow, WorkerHrRow } from "@/app/hr/actions";
import type { LeaveRequestRow } from "@/lib/hr/leave-requests";

export const dynamic = "force-dynamic";

type HrPageProps = {
  searchParams?: Promise<{
    leaveRequest?: string;
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

  const { data: leaveRequestsData, error: leaveRequestsError } = await adminClient
    .from("leave_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<LeaveRequestRow[]>();

  if (leaveRequestsError) {
    console.error("HR PAGE LEAVE REQUESTS ERROR", leaveRequestsError.message);
  }

  const profileById = new Map(profileList.map((item) => [item.id, item]));
  const hrByProfileId = new Map((hrData ?? []).map((item) => [item.profile_id, item]));
  const leaveRequests: HrLeaveRequestRow[] = (leaveRequestsData ?? []).map((request) => {
    const employee = profileById.get(request.profile_id);
    const employeeHr = hrByProfileId.get(request.profile_id);
    return {
      ...request,
      employee_name: employee?.full_name?.trim() || employee?.email || "Unknown employee",
      current_balance: employeeHr
        ? Number(employeeHr.annual_leave_days) - Number(employeeHr.leave_taken_this_year)
        : 0,
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
          canApprove={profile?.role === "system_owner"}
          currentProfileId={user.id}
          selectedRequestId={params.leaveRequest}
        />
        <HrManagementTable
          profiles={profileList}
          hrData={hrData ?? []}
          leaveRequests={leaveRequestsData ?? []}
        />
        <div className="mt-8">
          <HrWorkersTable workers={workersHrData ?? []} />
        </div>
      </div>
    </ErpAppShell>
  );
}
