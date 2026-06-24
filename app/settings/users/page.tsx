import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import {
  type UserManagementProfileRow,
  UserManagementTable,
} from "@/components/settings/user-management-table";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type UsersPageProps = {
  searchParams?: Promise<{
    message?: string;
  }>;
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const { user, displayName } = await requireSystemOwner();
  const message = (await searchParams)?.message;
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,account_status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .returns<UserManagementProfileRow[]>();

  if (error) {
    console.error("USER MANAGEMENT PROFILE LIST ERROR", error.message);
  }

  return (
    <ErpAppShell
      eyebrow="SYSTEM"
      title="User Management"
      description="Approve users, manage roles, and control account access."
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
          {message ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
              {message}
            </p>
          ) : null}
        </div>
        <UserManagementTable currentUserId={user.id} profiles={profiles ?? []} />
      </div>
    </ErpAppShell>
  );
}
