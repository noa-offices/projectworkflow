import { redirect } from "next/navigation";
import { ReportsView } from "@/components/inventory/reports-view";
import { requireInventoryUser } from "@/lib/auth";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";
import { listActiveBrands, listCategories } from "@/lib/inventory/queries";
import { defaultMovementRange } from "@/lib/inventory/reports/params";

export default async function InventoryReportsPage() {
  const { profile } = await requireInventoryUser();
  if (!canUseManagerMovements(profile?.role)) redirect("/inventory");
  const [brands, categories] = await Promise.all([listActiveBrands(), listCategories()]);
  return <ReportsView brands={brands} categories={categories} role={profile?.role ?? null} defaultRange={defaultMovementRange()} />;
}
