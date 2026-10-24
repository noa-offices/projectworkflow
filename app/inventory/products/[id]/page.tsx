import { notFound } from "next/navigation";
import { ProductDetailView } from "@/components/inventory/product-detail-view";
import { ProductRequestActions } from "@/components/inventory/movement-request-form";
import { PendingProductRequests } from "@/components/inventory/pending-product-requests";
import { requireInventoryUser } from "@/lib/auth";
import { isInventoryProductId } from "@/lib/inventory/presentation";
import { getProduct, getPendingProductMovementRequests } from "@/lib/inventory/queries";

export default async function InventoryProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ photoFailures?: string | string[]; saved?: string | string[] }> }) {
  const {profile,user} = await requireInventoryUser();
  const { id } = await params;
  if (!isInventoryProductId(id)) notFound();
  const product = await getProduct(id.toLowerCase());
  if (!product) notFound();
  const requests = await getPendingProductMovementRequests(product.id);
  const query = await searchParams, photoFailures = query?.photoFailures, saved = query?.saved === '1';
  const showPhotoWarning = typeof photoFailures === 'string' && /^[1-3]$/.test(photoFailures);
  return <>{saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Changes saved.</p>}{showPhotoWarning && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Your item was added, but some photos could not be attached. Please check the product photos.</p>}<ProductRequestActions product={product} role={profile?.role ?? null} /><ProductDetailView product={product} role={profile?.role ?? null} userId={user.id} /><PendingProductRequests requests={requests} /></>;
}
