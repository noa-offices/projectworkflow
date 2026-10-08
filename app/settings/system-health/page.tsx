import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { SupplierCapacityPanel } from "@/components/products/supplier-capacity";
import { requireSystemOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const { user, profile, displayName } = await requireSystemOwner();

  return (
    <ErpAppShell
      eyebrow="SYSTEM & MAINTENANCE"
      title="Database & Storage Health"
      description="Monitor database size, storage usage, growth, and reclaimable space."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url ?? null}
      userRole={profile?.role ?? null}
    >
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6 sm:px-8">
        <Link href="/settings" className="w-fit text-sm font-semibold text-emerald-900 hover:text-emerald-800">Back to settings</Link>
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
          <SupplierCapacityPanel />
        </section>
      </div>
    </ErpAppShell>
  );
}
