import type { ReactNode } from "react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { InventoryFrame } from "@/components/inventory/inventory-frame";
import { InventoryNav } from "@/components/inventory/inventory-nav";
import { requireInventoryUser } from "@/lib/auth";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";

export default async function InventoryLayout({ children }: { children: ReactNode }) {
  const { user, profile, displayName } = await requireInventoryUser();
  return <ErpAppShell compactHeader title="Inventory" description="Stock, products and warehouse inventory." role={profile?.role} userRole={profile?.role} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url}>
    <InventoryFrame><InventoryNav showMovements={canUseManagerMovements(profile?.role)} />{children}</InventoryFrame>
  </ErpAppShell>;
}
