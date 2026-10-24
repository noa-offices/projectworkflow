import { redirect } from "next/navigation";
import { MoveStockForm } from "@/components/inventory/move-stock-form";
import { requireInventoryUser } from "@/lib/auth";
import { canUseManagerMovements, toPickerProduct } from "@/lib/inventory/movement-form";
import { isInventoryProductId } from "@/lib/inventory/presentation";
import type { InventorySearchParams } from "@/lib/inventory/presentation";
import { getProduct } from "@/lib/inventory/queries";

export default async function InventoryMovePage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  const { profile } = await requireInventoryUser();
  if (!canUseManagerMovements(profile?.role)) redirect("/inventory");
  const value = (await searchParams).product, id = Array.isArray(value) ? value[0] : value;
  const product = id && isInventoryProductId(id) ? await getProduct(id.toLowerCase()) : null;
  return <MoveStockForm role={profile?.role ?? null} initialProduct={product?.is_active ? toPickerProduct(product) : null} />;
}
