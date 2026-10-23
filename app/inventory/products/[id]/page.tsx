import { notFound } from "next/navigation";
import { ProductDetailView } from "@/components/inventory/product-detail-view";
import { ProductRequestActions } from "@/components/inventory/movement-request-form";
import { PendingProductRequests } from "@/components/inventory/pending-product-requests";
import { requireInventoryUser } from "@/lib/auth";
import { isInventoryProductId } from "@/lib/inventory/presentation";
import { getProduct, getPendingProductMovementRequests } from "@/lib/inventory/queries";

export default async function InventoryProductPage({ params }: { params: Promise<{ id: string }> }) {
  const {profile} = await requireInventoryUser();
  const { id } = await params;
  if (!isInventoryProductId(id)) notFound();
  const product = await getProduct(id.toLowerCase());
  if (!product) notFound();
  const requests = await getPendingProductMovementRequests(product.id);
  return <><ProductRequestActions product={product} role={profile?.role ?? null} /><ProductDetailView product={product} /><PendingProductRequests requests={requests} /></>;
}
