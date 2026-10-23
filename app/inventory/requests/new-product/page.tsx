import { redirect } from 'next/navigation';
import { ProductRequestForm } from '@/components/inventory/product-request-form';
import { requireInventoryUser } from '@/lib/auth';
import { requestButtons } from '@/lib/inventory/request-presentation';
import { listActiveBrands, listCategories } from '@/lib/inventory/queries';

export default async function NewProductRequestPage() {
  const {profile} = await requireInventoryUser();
  if (!requestButtons(profile?.role).add) redirect('/inventory/requests');
  const [brands,categories] = await Promise.all([listActiveBrands(),listCategories()]);
  return <ProductRequestForm brands={brands} categories={categories} role={profile?.role ?? null} />;
}
