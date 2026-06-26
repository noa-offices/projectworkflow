import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { AvatarUpload } from "@/components/settings/avatar-upload";
import { ProfileActivity } from "@/components/settings/profile-activity";
import { updateMyProfile } from "@/app/settings/actions";
import { requireActiveUser } from "@/lib/auth";
import { loadProfileStats, loadTeamStats } from "@/lib/settings/profile-stats-loader";
import {
  userRoleLabel,
  userStatusBadgeClass,
  userStatusLabel,
} from "@/lib/user-management";

export const dynamic = "force-dynamic";

type ProfilePageProps = {
  searchParams?: Promise<{
    message?: string;
    messageScope?: string;
    messageType?: string;
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
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`h-10 rounded-md border px-3 text-sm outline-none transition ${
          readOnly
            ? "border-zinc-200 bg-zinc-100 text-zinc-500"
            : "border-zinc-200 bg-white text-zinc-800 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        }`}
      />
    </label>
  );
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const stats = await loadProfileStats(user.id);
  const isSystemOwner = profile?.role === "system_owner";
  const teamStats = isSystemOwner ? await loadTeamStats() : null;
  const params = (await searchParams) ?? {};
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
            <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Profile Details</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                    These details stay internal and help teammates recognize ownership across records and workflows.
                  </p>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                  Editable
                </span>
              </div>

              <div className="mt-6 mb-4">
                <AvatarUpload
                  currentAvatarUrl={profile?.avatar_url ?? null}
                  userId={user.id}
                  displayName={displayName}
                />
              </div>
              <form action={updateMyProfile} className="grid gap-4 md:grid-cols-2">
                <Field
                  name="full_name"
                  label="Full name"
                  defaultValue={profile?.full_name ?? ""}
                  placeholder="Your full name"
                />
                <Field
                  name="email"
                  label="Email"
                  defaultValue={profile?.email ?? user.email ?? ""}
                  type="email"
                  readOnly
                />
                <Field
                  name="phone"
                  label="Phone"
                  defaultValue={profile?.phone ?? ""}
                  placeholder="+971 ..."
                />
                <Field
                  name="job_title"
                  label="Job title"
                  defaultValue={profile?.job_title ?? ""}
                  placeholder="Sales Manager"
                />
                <div className="md:col-span-2">
                  <Field
                    name="department"
                    label="Department"
                    defaultValue={profile?.department ?? ""}
                    placeholder="Sales"
                  />
                </div>
                <div className="md:col-span-2 flex items-center justify-end">
                  <PendingSubmitButton
                    className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    pendingLabel="Saving profile..."
                  >
                    Save profile
                  </PendingSubmitButton>
                </div>
              </form>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-950">Account Summary</h2>
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

          <ProfileActivity
            totalQuotations={stats.totalQuotations}
            approvedQuotations={stats.approvedQuotations}
            totalValue={stats.totalValue}
            currency={stats.currency}
            role={profile?.role ?? null}
            recentActivity={stats.recentActivity}
            recentQuotations={stats.recentQuotations}
            teamStats={teamStats}
            monthlyData={stats.monthlyData}
          />
      </div>
    </ErpAppShell>
  );
}
