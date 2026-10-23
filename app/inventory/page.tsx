import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireInventoryUser } from "@/lib/auth";

export default async function InventoryPage() {
  const { user, profile, displayName } = await requireInventoryUser();

  return (
    <ErpAppShell
      title="Inventory"
      description="Warehouse inventory workspace."
      role={profile?.role}
      userRole={profile?.role}
      userDisplayName={displayName}
      userEmail={user.email}
      userAvatarUrl={profile?.avatar_url}
    >
      <div className="p-4 lg:p-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Inventory - coming soon</h2>
        </section>
      </div>
    </ErpAppShell>
  );
}
