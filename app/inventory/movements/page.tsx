import { inventoryIdentifier } from "@/lib/inventory/presentation";
import { redirect } from "next/navigation";
import { MovementsView } from "@/components/inventory/movements-view";
import { requireInventoryUser } from "@/lib/auth";
import { canUseManagerMovements } from "@/lib/inventory/movement-form";
import { movementsHref, parseMovementParams } from "@/lib/inventory/movement-history";
import { InventoryPageRangeError } from "@/lib/inventory/page-range-error";
import type { InventorySearchParams } from "@/lib/inventory/presentation";
import { getProduct, listMovements } from "@/lib/inventory/queries";

export default async function InventoryMovementsPage({ searchParams }: { searchParams: Promise<InventorySearchParams> }) {
  const { profile } = await requireInventoryUser();
  if (!canUseManagerMovements(profile?.role)) redirect("/inventory");
  const { state, filters, page } = parseMovementParams(await searchParams);
  const result = await listMovements(filters, page).catch(error => {
    if (page > 1 && error instanceof InventoryPageRangeError) redirect(movementsHref(state, { page: 1 }));
    throw error;
  });
  if (page > Math.max(1, result.page_count)) redirect(movementsHref(state, { page: Math.max(1, result.page_count) }));
  const product = state.product ? await getProduct(state.product) : null;
  return <MovementsView result={result} state={state} role={profile?.role ?? null} productName={product?.item_name ?? null} productIdentifier={inventoryIdentifier(product)} />;
}
