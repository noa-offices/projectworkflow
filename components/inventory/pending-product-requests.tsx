import { inventoryPersonName, formatInventoryDate, inventoryLabel } from '@/lib/inventory/presentation';
import { LOCATION_LABELS, type InventoryMovementRequest } from '@/lib/inventory/types';

export function PendingProductRequests({requests}: {requests:InventoryMovementRequest[]}) {
  return <section className="mt-5 min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"><h2 className="text-base font-semibold">Pending requests for this product</h2>
    {!requests.length ? <p className="mt-3 text-sm text-zinc-500">No pending requests.</p> : <ul className="mt-3 space-y-3">{requests.map(request => <li key={request.id} className="min-w-0 rounded-md border border-zinc-200 p-3 text-sm [overflow-wrap:anywhere]">
      <p className="font-semibold">{inventoryLabel(request.request_type)} · {request.quantity} units · Pending</p><p className="mt-1 text-zinc-600">{request.from_location ? LOCATION_LABELS[request.from_location] : 'No source location'}{request.to_location ? ` → ${LOCATION_LABELS[request.to_location]}` : ''}</p>
      <p className="mt-1 text-zinc-500">{inventoryPersonName(request.submitter_display_name)} · {formatInventoryDate(request.submitted_at)}</p>{request.note && <p className="mt-2 whitespace-pre-wrap">{request.note}</p>}
    </li>)}</ul>}
  </section>;
}
