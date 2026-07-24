import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { RoleGuide } from "@/components/settings/role-guide";
import { requireSystemOwner } from "@/lib/auth";

export default async function RolesPage() {
  const { user, profile, displayName } = await requireSystemOwner();

  return (
    <ErpAppShell
      eyebrow="SYSTEM"
      title="Role Guide"
      description="Review effective feature permissions across application roles."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="px-5 py-6 sm:px-8">
        <Link
          href="/settings"
          className="mb-5 inline-flex text-sm font-semibold text-emerald-900 transition hover:text-emerald-800"
        >
          Back to settings
        </Link>
        <RoleGuide />
      </div>
    </ErpAppShell>
  );
}
