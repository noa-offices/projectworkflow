'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { releaseReservation, fulfilReservation } from '@/lib/inventory/actions';
import { canManageInventory } from '@/lib/inventory/access';
import { canReleaseReservation } from '@/lib/inventory/reservations';
import { inventoryIdentifier, inventoryPersonName, formatInventoryDate, formatInventoryNumber, inventoryLabel } from '@/lib/inventory/presentation';
import { LOCATION_LABELS, LOCATION_QUANTITY_COLUMNS, type InventoryProductDetail, type InventoryReservation, type InventoryLocation } from '@/lib/inventory/types';
import { RequestDialog } from './request-dialog';

const input = 'mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950';
const button = 'min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-800 disabled:opacity-50';
const locations = (Object.keys(LOCATION_LABELS) as InventoryLocation[]).filter(location => location !== 'sold');

export function ProductReservations({ product, role, userId, preview = false }: { product: InventoryProductDetail; role?: string | null; userId?: string | null; preview?: boolean }) {
  const [selected, setSelected] = useState<{ reservation: InventoryReservation; action: 'release' | 'fulfil' } | null>(null);
  const [completed, setCompleted] = useState<string[]>([]), [message, setMessage] = useState('');
  const reservations = product.reservations.filter(row => !completed.includes(row.id));
  return <section aria-labelledby="reservations-heading" className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
    <h2 id="reservations-heading" className="text-base font-semibold text-zinc-950">Reservations</h2>
    <p className="mt-2 text-sm text-zinc-600">Reserved {formatInventoryNumber(product.reserved_quantity)} · Available {formatInventoryNumber(product.available_quantity)}</p>
    <p className="mt-1 text-sm text-zinc-500">Active holds and bookings reduce the stock available to take or move.</p>
    {message && <p role="status" className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {reservations.length ? <ol className="mt-4 divide-y divide-zinc-100">{reservations.map(row => <li key={row.id} className="min-w-0 space-y-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-semibold">{inventoryLabel(row.kind)}</p><p className="text-sm font-semibold">{formatInventoryNumber(row.quantity)} units</p></div>
      <p className="text-sm font-semibold text-zinc-950 [overflow-wrap:anywhere]">{product.item_name}</p><p className="text-sm text-emerald-800 [overflow-wrap:anywhere]">{inventoryIdentifier(row.product ?? product)}</p>
      <p className="break-words text-sm text-zinc-700">{row.project_label || row.reference_note || 'No project or reference'}</p>
      {row.project_label && row.reference_note && <p className="break-words text-sm text-zinc-600">{row.reference_note}</p>}
      <p className="break-words text-sm text-zinc-500">{inventoryPersonName(row.creator_display_name)} · <time dateTime={row.created_at}>{formatInventoryDate(row.created_at)}</time></p>
      {row.expires_at && <p className="text-sm text-zinc-600">Hold until <time dateTime={row.expires_at}>{formatInventoryDate(row.expires_at)}</time></p>}
      {row.note && <p className="whitespace-pre-wrap break-words text-sm text-zinc-600">{row.note}</p>}
      <div className="flex flex-wrap gap-2">
        {canReleaseReservation(role,userId,row.created_by) && <button className={button} onClick={() => setSelected({reservation:row,action:'release'})}>Release</button>}
        {canManageInventory(role) && <button className={button} onClick={() => setSelected({reservation:row,action:'fulfil'})}>Fulfil</button>}
      </div>
    </li>)}</ol> : <p className="mt-4 text-sm text-zinc-500">No active reservations.</p>}
    {selected && <ReservationActionForm key={`${selected.reservation.id}-${selected.action}`} {...selected} product={product} preview={preview} onClose={() => setSelected(null)} onSuccess={() => { setCompleted(previous => [...previous,selected.reservation.id]); setMessage(selected.action === 'release' ? 'Reservation released.' : 'Reservation fulfilled.'); setSelected(null); }} />}
  </section>;
}

function ReservationActionForm({ reservation, action, product, preview, onClose, onSuccess }: { reservation: InventoryReservation; action: 'release' | 'fulfil'; product: InventoryProductDetail; preview: boolean; onClose: () => void; onSuccess: () => void }) {
  const [actionType,setActionType] = useState<'sale' | 'internal_transfer'>('sale');
  const [fromLocation,setFromLocation] = useState<InventoryLocation>(locations.find(location => product[LOCATION_QUANTITY_COLUMNS[location]] >= reservation.quantity) ?? 'warehouse');
  const [toLocation,setToLocation] = useState<InventoryLocation>(locations.find(location => location !== fromLocation) ?? 'dubai_showroom');
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const lock = useRef(false), router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const note = String(new FormData(event.currentTarget).get('note') ?? '').trim();
    if (action === 'fulfil' && actionType === 'internal_transfer' && fromLocation === toLocation) { setError('Choose different source and destination locations.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const result = preview ? {ok:true as const} : action === 'release' ? await releaseReservation({reservationId:reservation.id,note}) : await fulfilReservation({reservationId:reservation.id,actionType,fromLocation,toLocation:actionType === 'sale' ? 'sold' : toLocation,note});
      if (!result.ok) { setError(result.error); return; }
      onSuccess(); if (!preview) router.refresh();
    } catch { setError('Unable to update this reservation. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <RequestDialog title={action === 'release' ? 'Release reservation' : 'Fulfil reservation'} onClose={onClose} busy={busy}>
    <div className="mb-4 text-sm [overflow-wrap:anywhere]"><p>{product.item_name}</p><p className="mt-1 text-emerald-800">{inventoryIdentifier(product)}</p><p>{reservation.quantity} reserved units</p></div>
    <form onSubmit={submit} className="min-w-0 space-y-4">
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {action === 'fulfil' && <>
          <label className="block text-sm font-medium">Action<select className={input} value={actionType} onChange={event=>setActionType(event.target.value as typeof actionType)}><option value="sale">Take stock out (Sold)</option><option value="internal_transfer">Move between locations</option></select></label>
          <label className="block text-sm font-medium">From location<select className={input} value={fromLocation} onChange={event=>setFromLocation(event.target.value as InventoryLocation)}>{locations.map(location=><option key={location} value={location} disabled={product[LOCATION_QUANTITY_COLUMNS[location]] < reservation.quantity}>{LOCATION_LABELS[location]} · {product[LOCATION_QUANTITY_COLUMNS[location]]} units</option>)}</select></label>
          {actionType === 'internal_transfer' && <label className="block text-sm font-medium">To location<select className={input} value={toLocation} onChange={event=>setToLocation(event.target.value as InventoryLocation)}>{locations.map(location=><option key={location} value={location} disabled={location === fromLocation}>{LOCATION_LABELS[location]}</option>)}</select></label>}
          <p className="text-sm text-zinc-500">Fulfils all {reservation.quantity} reserved units in one stock movement.</p>
        </>}
        <label className="block text-sm font-medium">Note (optional)<textarea className={input} name="note" maxLength={2000} rows={3} /></label>
      </fieldset>
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button className="min-h-11 w-full rounded-md bg-emerald-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}>{busy ? 'Saving…' : action === 'release' ? 'Release reservation' : 'Fulfil reservation'}</button>
    </form>
  </RequestDialog>;
}

