import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { TopBar } from "@/components/top-bar";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AccountStatus, AppRole } from "@/lib/supabase/types";
import { updateUserRole, updateUserStatus } from "./actions";

export const dynamic = "force-dynamic";

type UsersPageProps = {
  searchParams?: Promise<{
    message?: string;
  }>;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  account_status: AccountStatus;
  created_at: string;
  updated_at: string;
};

const roles: AppRole[] = [
  "system_owner",
  "admin_manager",
  "sales_designer",
  "viewer",
];

const statuses: AccountStatus[] = ["pending", "active", "disabled"];

const statusStyles: Record<AccountStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-900",
  active: "border-emerald-200 bg-emerald-50 text-emerald-900",
  disabled: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const { user, displayName } = await requireSystemOwner();
  const message = (await searchParams)?.message;
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,account_status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .returns<ProfileRow[]>();

  if (error) {
    console.error("USER MANAGEMENT PROFILE LIST ERROR", error.message);
  }

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="User Management"
          description="Approve users and manage account roles."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <Link
              href="/settings"
              className="text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
            >
              Back to settings
            </Link>
            {message ? (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                {message}
              </p>
            ) : null}
          </div>
          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-zinc-950">Users</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Review signups, status, and role assignments.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">User</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Created</th>
                    <th className="px-5 py-3 font-semibold">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {(profiles ?? []).map((profile) => (
                    <tr key={profile.id} className="align-top">
                      <td className="px-5 py-4">
                        <p className="font-medium text-zinc-950">
                          {profile.full_name ?? "Unnamed user"}
                        </p>
                        <p className="mt-1 text-zinc-500">
                          {profile.email ?? "No email"}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <form
                          action={updateUserRole.bind(null, profile.id)}
                          className="flex min-w-48 gap-2"
                        >
                          <select
                            name="role"
                            defaultValue={profile.role}
                            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                          >
                            {roles.map((role) => (
                              <option key={role} value={role}>
                                {role}
                              </option>
                            ))}
                          </select>
                          <PendingSubmitButton
                            className="h-10 rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
                            pendingLabel="Saving..."
                          >
                            Save
                          </PendingSubmitButton>
                        </form>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex min-w-52 flex-col gap-3">
                          <span
                            className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[profile.account_status]}`}
                          >
                            {profile.account_status}
                          </span>
                          <form
                            action={updateUserStatus.bind(null, profile.id)}
                            className="flex gap-2"
                          >
                            <select
                              name="account_status"
                              defaultValue={profile.account_status}
                              className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                            >
                              {statuses.map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                            <PendingSubmitButton
                              className="h-10 rounded-md bg-emerald-900 px-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
                              pendingLabel="Saving..."
                            >
                              Save
                            </PendingSubmitButton>
                          </form>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-zinc-500">
                        {formatDate(profile.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-zinc-500">
                        {formatDate(profile.updated_at)}
                      </td>
                    </tr>
                  ))}
                  {!profiles?.length ? (
                    <tr>
                      <td className="px-5 py-8 text-center text-zinc-500" colSpan={5}>
                        No users found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
