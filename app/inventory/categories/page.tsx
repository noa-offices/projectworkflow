import { redirect } from "next/navigation";
import { CategoryManager } from "@/components/inventory/category-manager";
import { requireInventoryUser } from "@/lib/auth";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";
import { listCategoryOverview } from "@/lib/inventory/queries";

export default async function InventoryCategoriesPage() {
  const { profile } = await requireInventoryUser();
  if (!canUseManagerMovements(profile?.role)) redirect("/inventory");
  return <CategoryManager categories={await listCategoryOverview()} role={profile?.role ?? null} />;
}
