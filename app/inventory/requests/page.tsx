import { redirect } from 'next/navigation';
import { RequestsView } from '@/components/inventory/requests-view';
import { requireInventoryUser } from '@/lib/auth';
import { canManageInventory } from '@/lib/inventory/access';
import { InventoryPageRangeError } from '@/lib/inventory/page-range-error';
import type { InventorySearchParams } from '@/lib/inventory/presentation';
import { parseRequestParams } from '@/lib/inventory/request-presentation';
import { listMovementRequests, listProductRequests } from '@/lib/inventory/queries';

export default async function RequestsPage({searchParams}: {searchParams:Promise<InventorySearchParams>}) {
  const {user,profile} = await requireInventoryUser();
  const state = parseRequestParams(await searchParams,canManageInventory(profile?.role));
  const filters = {request_status:state.status === 'all' ? undefined : state.status, submitted_by:state.mine ? user.id : undefined, page:state.page};
  const firstPage = `/inventory/requests?tab=${state.tab}&status=${state.status}${state.mine ? '&mine=1' : ''}`;
  let products, movements;
  try {
    if (state.tab === 'products') products = await listProductRequests(filters);
    else movements = await listMovementRequests(filters);
  } catch(error) {
    if (state.page > 1 && error instanceof InventoryPageRangeError) redirect(firstPage);
    throw error;
  }
  const result = products ?? movements!;
  if (state.page > Math.max(1,result.page_count)) redirect(firstPage);
  return <RequestsView products={products?.items ?? []} movements={movements?.items ?? []} {...state} userId={user.id} role={profile?.role ?? null} pageCount={result.page_count} total={result.total} />;
}
