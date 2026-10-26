import { notFound, redirect } from "next/navigation";
import { ProductPhotoManager } from "@/components/inventory/product-photo-manager";
import { requireInventoryUser } from "@/lib/auth";
import { isInventoryProductId } from "@/lib/inventory/presentation";
import { canUseProductTools } from "@/lib/inventory/product-edit";
import { getProduct } from "@/lib/inventory/queries";

export default async function InventoryProductPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireInventoryUser();
  const { id } = await params;
  if (!isInventoryProductId(id)) notFound();
  const productHref = `/inventory/products/${id.toLowerCase()}`;
  if (!canUseProductTools(profile?.role)) redirect(productHref);
  const product = await getProduct(id.toLowerCase());
  if (!product) notFound();
  if (!product.is_active) redirect(productHref);
  return <ProductPhotoManager productId={product.id} productName={product.item_name} identifiers={{stock_ref:product.stock_ref,item_code:product.item_code,model_name:product.model_name}} images={product.images} role={profile?.role ?? null} productHref={productHref} />;
}
