import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { ProfileDashboardShell } from "@/components/settings/profile-dashboard-shell";
import { DateRangeSelector } from "@/components/insights/date-range-selector";
import { updateMyProfile } from "@/app/settings/actions";
import { requireActiveUser } from "@/lib/auth";
import {
  loadProfileStats,
  loadTeamStats,
} from "@/lib/settings/profile-stats-loader";
import { resolveDateRange } from "@/lib/insights/date-ranges";
import { latestPrimaryQuotationsByFolder } from "@/lib/quotations/sales-attribution";
import { hasQualifyingProjectFile } from "@/lib/quotations/approval-display";
import {
  userRoleLabel,
  userStatusBadgeClass,
  userStatusLabel,
} from "@/lib/user-management";
import { createClient } from "@/lib/supabase/server";
import type { HrRow } from "@/app/hr/actions";

export const dynamic = "force-dynamic";

type ProfilePageProps = {
  searchParams?: Promise<{
    message?: string;
    messageScope?: string;
    messageType?: string;
    range?: string;
    from?: string;
    to?: string;
  }>;
};

function isProfileMessage(message: string) {
  return message === "Profile updated."
    || message === "Invalid profile details."
    || message.startsWith("Profile could not be updated");
}

function Field({
  defaultValue,
  label,
  name,
  placeholder,
  readOnly = false,
  type = "text",
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  placeholder?: string;
  readOnly?: boolean;
  type?: string;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`h-10 min-w-0 w-full rounded-md border px-3 text-sm outline-none transition ${
          readOnly
            ? "border-zinc-200 bg-zinc-100 text-zinc-500"
            : "border-zinc-200 bg-white text-zinc-800 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        }`}
      />
    </label>
  );
}

function formatHrDate(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function hrExpiryTone(dateStr: string | null): string | undefined {
  if (!dateStr) return undefined;
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
  if (days <= 10) return "text-red-700 font-semibold";
  if (days <= 30) return "text-amber-700 font-semibold";
  if (days <= 60) return "text-yellow-700";
  return undefined;
}

function hrLeaveBalanceTone(balance: number): string | undefined {
  if (balance <= 5) return "text-red-700 font-semibold";
  if (balance <= 10) return "text-amber-700";
  return "text-emerald-700";
}

function HrSummaryField({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <p className={`mt-2 text-sm font-medium text-zinc-950 ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const params = (await searchParams) ?? {};

  const resolvedRange = resolveDateRange(params.range, params.from, params.to);
  const dateRange = { from: resolvedRange.from.toISOString(), to: resolvedRange.to.toISOString() };

  const isSystemOwner = profile?.role === "system_owner";

  const supabase = await createClient();

  const [stats, teamStats, allQuotationsResult] = await Promise.all([
    loadProfileStats(user.id, dateRange, profile?.role ?? null),
    isSystemOwner ? loadTeamStats(dateRange) : Promise.resolve(null),
    supabase
      .from("quotations")
      .select("id,quotation_no,option_no,revision_no,status,status_updated_at,created_at,layout_settings,client_id,grand_total,company_name:clients(company_name)")
      .eq("salesperson_id", user.id)
      .eq("is_active", true)
      .gte("created_at", dateRange.from)
      .lte("created_at", dateRange.to)
      .limit(500),
  ]);

  type AllQuotationRow = {
    id: string;
    quotation_no: string | null;
    option_no: number | null;
    revision_no: number | null;
    status: string;
    status_updated_at: string | null;
    created_at: string;
    layout_settings: unknown;
    client_id: string | null;
    grand_total: number | null;
    company_name: { company_name: string | null } | null;
  };

  const allRows = latestPrimaryQuotationsByFolder(
    (allQuotationsResult.data as AllQuotationRow[] | null) ?? [],
  );

  const allQuotations = allRows.map((quotation) => ({
    status: quotation.status === "client_confirmed"
      ? (hasQualifyingProjectFile(quotation.layout_settings) ? "client_approved" : "client_confirmed_pending")
      : quotation.status,
  }));

  // Compute top 5 clients by total value
  const clientTotals: Record<string, { clientName: string; total: number; count: number }> = {};
  for (const q of allRows) {
    const clientName = q.company_name?.company_name?.trim() || "Unknown Client";
    if (!clientTotals[clientName]) {
      clientTotals[clientName] = { clientName, total: 0, count: 0 };
    }
    clientTotals[clientName].total += q.grand_total ?? 0;
    clientTotals[clientName].count += 1;
  }
  const topClients = Object.values(clientTotals)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const [{ data: hrData }, { count: pendingLeaveRequests }] = await Promise.all([
    supabase
      .from("profiles_hr")
      .select("*")
      .eq("profile_id", user.id)
      .maybeSingle<HrRow>(),
    supabase
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .eq("status", "pending_approval"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const upcomingVacation = [...(hrData?.vacation_dates ?? [])]
    .filter((entry) => entry.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null;

  const showMessage = params.messageScope === "profile"
    && typeof params.message === "string"
    && isProfileMessage(params.message);
  const messageClassName = params.messageType === "error"
    ? "border-red-200 bg-red-50 text-red-900"
    : "border-emerald-200 bg-emerald-50 text-emerald-950";

  return (
    <ErpAppShell
      eyebrow="SYSTEM"
      title="My Profile"
      description="Review your account details and keep your contact information up to date."
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <Link
              href="/settings"
              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
            >
              Back to settings
            </Link>
            {showMessage ? (
              <p className={`rounded-md border px-3 py-2 text-sm ${messageClassName}`}>
                {params.message}
              </p>
            ) : null}
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-4 xl:sticky xl:top-6">
          <div className="space-y-4">
            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-950">{displayName}</h2>
              <p className="mt-1 text-xs text-zinc-500">{profile?.job_title ?? "Account summary"}</p>
              <div className="mt-4 grid gap-4 text-sm">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Role
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-950">
                    {userRoleLabel(profile?.role)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Status
                  </p>
                  <span
                    className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${userStatusBadgeClass(profile?.account_status)}`}
                  >
                    {userStatusLabel(profile?.account_status)}
                  </span>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Email
                  </p>
                  <p className="mt-2 break-all text-zinc-700">
                    {profile?.email ?? user.email ?? "No email"}
                  </p>
                </div>
              </div>
            </section>
          </div>

          {hrData ? (
            <details className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-950">HR summary</summary>
              <div className="mt-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">My HR Summary</h2>
                  <p className="mt-1 text-sm text-zinc-500">Managed by your HR team.</p>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                  Read only
                </span>
              </div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <HrSummaryField label="Date of Joining" value={hrData.date_of_joining ? formatHrDate(hrData.date_of_joining) : "—"} />
                <HrSummaryField
                  label="Leave Balance"
                  value={`${hrData.annual_leave_days - hrData.leave_taken_this_year} of ${hrData.annual_leave_days} days`}
                  tone={hrLeaveBalanceTone(hrData.annual_leave_days - hrData.leave_taken_this_year)}
                />
                <HrSummaryField label="Pending Requests" value={String(pendingLeaveRequests ?? 0)} />
                <HrSummaryField
                  label="Upcoming Vacation"
                  value={upcomingVacation ? `${formatHrDate(upcomingVacation.start_date)} – ${formatHrDate(upcomingVacation.end_date)}` : "None"}
                />
                <HrSummaryField
                  label="Emirates ID Expiry"
                  value={hrData.emirates_id_expiry ? formatHrDate(hrData.emirates_id_expiry) : "—"}
                  tone={hrExpiryTone(hrData.emirates_id_expiry)}
                />
                <HrSummaryField
                  label="Passport Expiry"
                  value={hrData.passport_expiry ? formatHrDate(hrData.passport_expiry) : "—"}
                  tone={hrExpiryTone(hrData.passport_expiry)}
                />
                {hrData.emergency_contact_name ? (
                  <HrSummaryField label="Emergency Contact" value={hrData.emergency_contact_name} />
                ) : null}
                {hrData.emergency_contact_phone ? (
                  <HrSummaryField label="Emergency Phone" value={hrData.emergency_contact_phone} />
                ) : null}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/settings/profile/vacation-requests" className="rounded-md bg-emerald-900 px-3 py-2 text-xs font-semibold text-white">Apply for Vacation</Link>
                <Link href="/settings/profile/vacation-requests" className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700">My Requests</Link>
              </div>
              </div>
            </details>
          ) : (
            <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
              Your HR details have not been set up yet.
            </p>
          )}

          </aside>
          <main className="min-w-0">
          <div className="mb-4 flex justify-end">
            <DateRangeSelector current={resolvedRange.range} customFrom={resolvedRange.validCustom ? params.from : undefined} customTo={resolvedRange.validCustom ? params.to : undefined} />
          </div>
          <details className="mb-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <summary className="cursor-pointer text-base font-semibold text-zinc-950">Edit profile details</summary>
            <div className="mt-5">
              <div className="mb-5">
                <AvatarUpload currentAvatarUrl={profile?.avatar_url ?? null} userId={user.id} displayName={displayName} />
              </div>
              <form action={updateMyProfile} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field name="full_name" label="Full name" defaultValue={profile?.full_name ?? ""} placeholder="Your full name" />
                <Field name="email" label="Email" defaultValue={profile?.email ?? user.email ?? ""} type="email" readOnly />
                <Field name="phone" label="Phone" defaultValue={profile?.phone ?? ""} placeholder="+971 ..." />
                <Field name="job_title" label="Job title" defaultValue={profile?.job_title ?? ""} placeholder="Sales Manager" />
                <div className="md:col-span-2">
                  <Field name="department" label="Department" defaultValue={profile?.department ?? ""} placeholder="Sales" />
                </div>
                <div className="flex justify-end md:col-span-2">
                  <PendingSubmitButton className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800" pendingLabel="Saving profile...">
                    Save profile
                  </PendingSubmitButton>
                </div>
              </form>
            </div>
          </details>
          <ProfileDashboardShell
            totalQuotations={stats.totalQuotations}
            quotationsPrepared={stats.quotationsPrepared}
            revisionsPrepared={stats.revisionsPrepared}
            optionsPrepared={stats.optionsPrepared}
            personalActivityCount={stats.personalActivityCount}
            approvedQuotations={stats.approvedQuotations}
            totalValue={stats.totalValue}
            currency={stats.currency}
            role={profile?.role ?? null}
            recentActivity={stats.recentActivity}
            salesActivity={stats.salesActivity}
            recentQuotations={stats.recentQuotations}
            recentPreparedQuotations={stats.recentPreparedQuotations}
            teamStats={teamStats}
            monthlyData={stats.monthlyData}
            allQuotations={allQuotations}
            topClients={topClients}
            projects={stats.projects}
            projectSummary={stats.projectSummary}
            commissions={stats.commissions}
          />
          </main>
          </div>
      </div>
    </ErpAppShell>
  );
}
