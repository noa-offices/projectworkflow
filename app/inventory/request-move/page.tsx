import { redirect } from "next/navigation";
import { WorkerMoveRequest } from "@/components/inventory/worker-move-request";
import { requireInventoryUser } from "@/lib/auth";
import { toPickerProduct } from "@/lib/inventory/movement-form";
import { isInventoryProductId } from "@/lib/inventory/presentation";
import type { InventorySearchParams } from "@/lib/inventory/presentation";
import { getProduct } from "@/lib/inventory/queries";
import { moveRequestAccess } from "@/lib/inventory/request-presentation";

export const dynamic = "force-dynamic";

/** Worker take/move request. Managers use the direct Move stock page; everyone else goes back to Inventory. */
export default async function WorkerMoveRequestPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  const { profile } = await requireInventoryUser();
  const value = (await searchParams).product, id = Array.isArray(value) ? value[0] : value;
  const access = moveRequestAccess(profile?.role);
  if (access === "manager") redirect(id && isInventoryProductId(id) ? `/inventory/move?product=${id.toLowerCase()}` : "/inventory/move");
  if (access === "none") redirect("/inventory");
  const product = id && isInventoryProductId(id) ? await getProduct(id.toLowerCase()) : null;
  return <WorkerMoveRequest initialProduct={product?.is_active ? toPickerProduct(product) : null} />;
}
