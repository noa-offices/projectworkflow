import { notFound } from "next/navigation";
import { ProductDetailView } from "@/components/inventory/product-detail-view";
import { requireInventoryUser } from "@/lib/auth";
import { isInventoryProductId } from "@/lib/inventory/presentation";
import { getProduct } from "@/lib/inventory/queries";

export default async function InventoryProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInventoryUser();
  const { id } = await params;
  if (!isInventoryProductId(id)) notFound();
  const product = await getProduct(id.toLowerCase());
  if (!product) notFound();
  return <ProductDetailView product={product} />;
}
