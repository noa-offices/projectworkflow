import type { ReactNode } from "react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { requireInventoryUser } from "@/lib/auth";

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const { user, profile, displayName } = await requireInventoryUser();
  return <ErpAppShell title="Inventory" description="Stock, products and warehouse inventory." role={profile?.role} userRole={profile?.role} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url}>
    <div className="mx-auto min-w-0 max-w-7xl p-4 lg:p-8"><InventoryNav />{children}</div>
  </ErpAppShell>;
}
