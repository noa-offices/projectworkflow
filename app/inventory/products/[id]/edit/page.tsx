import { notFound, redirect } from "next/navigation";
import { ProductEditForm } from "@/components/inventory/product-edit-form";
import { requireInventoryUser } from "@/lib/auth";
import { isInventoryProductId } from "@/lib/inventory/presentation";
import { canUseProductTools } from "@/lib/inventory/product-edit";
import { getProduct, listActiveBrands, listCategories } from "@/lib/inventory/queries";

export default async function InventoryProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireInventoryUser();
  const { id } = await params;
  if (!isInventoryProductId(id)) notFound();
  const productHref = `/inventory/products/${id.toLowerCase()}`;
  if (!canUseProductTools(profile?.role)) redirect(productHref);
  const product = await getProduct(id.toLowerCase());
  if (!product) notFound();
  if (!product.is_active) redirect(productHref);
  const [brands, categories] = await Promise.all([listActiveBrands(), listCategories()]);
  return <ProductEditForm product={product} brands={brands} categories={categories} role={profile?.role ?? null} productHref={productHref} />;
}
