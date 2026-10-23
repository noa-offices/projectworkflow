'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { submitMovementRequest, type InventoryActionResult } from '@/lib/inventory/actions';
import { availableLocations, movementRequestPayload, requestButtons } from '@/lib/inventory/request-presentation';
import type { InventoryProduct, RequestType } from '@/lib/inventory/types';
import { RequestDialog } from './request-dialog';

const input = 'mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950';
const button = 'inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
export function ProductRequestActions({ product, role, preview = false, initialKind }: { product: InventoryProduct; role: string | null; preview?: boolean; initialKind?: RequestType }) {
  const [kind, setKind] = useState<RequestType | null>(initialKind ?? null), [success, setSuccess] = useState(false);
  const buttons = requestButtons(role);
  if (!product.is_active) return null;
  return <section className="my-4 min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" aria-label="Product requests">
    {buttons.takeMove || buttons.holdBook ? <><h2 className="mb-3 text-base font-semibold">Request stock</h2><div className="flex flex-wrap gap-2">
      {buttons.takeMove && <button className={button} onClick={() => { setKind('take'); setSuccess(false); }}>Take / Move stock</button>}
      {buttons.holdBook && <>{(['hold','book'] as const).map(value => <button className={button} key={value} onClick={() => { setKind(value); setSuccess(false); }}>{value === 'hold' ? 'Hold' : 'Book'}</button>)}</>}
    </div></> : <p className="text-sm text-zinc-600">Inventory requests are view only for your role.</p>}
    {success && <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Your request was sent for review.</p>}
    {kind && ((buttons.takeMove && (kind === 'take' || kind === 'move')) || (buttons.holdBook && (kind === 'hold' || kind === 'book'))) && <MovementRequestForm key={kind === 'take' || kind === 'move' ? 'stock' : kind} product={product} initialKind={kind} preview={preview} onClose={() => setKind(null)} onSuccess={() => { setKind(null); setSuccess(true); }} />}
  </section>;
}
export function MovementRequestForm({ product, initialKind, preview = false, onClose, onSuccess }: { product: InventoryProduct; initialKind: RequestType; preview?: boolean; onClose: () => void; onSuccess: () => void }) {
  const [kind, setKind] = useState(initialKind), [from, setFrom] = useState('warehouse'), [to, setTo] = useState('dubai_showroom');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), router = useRouter(), locations = availableLocations(product);
  const stock = kind === 'take' || kind === 'move', source = locations.find(row => row.location === from);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const data = new FormData(event.currentTarget);
    try {
      setError('');
      const payload = movementRequestPayload(product, { kind, from, to, quantity: String(data.get('quantity') ?? ''), note: String(data.get('note') ?? '') });
      lock.current = true; setBusy(true);
      const result: InventoryActionResult = preview ? {ok:true} : await submitMovementRequest(payload);
      if (!result.ok) { setError(result.error); return; }
      onSuccess(); if (!preview) router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send your request. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <RequestDialog title={stock ? 'Take / Move stock' : kind === 'hold' ? 'Hold stock' : 'Book stock'} onClose={onClose} busy={busy}>
    <p className="mb-4 break-words font-semibold">{product.item_name}</p>
    <form onSubmit={submit} onChange={() => { if (error) setError(''); }} className="min-w-0 space-y-4" aria-describedby={error ? 'movement-error' : undefined}>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {stock && <label className="block text-sm font-medium">Request type<select className={input} value={kind} onChange={event => setKind(event.target.value as RequestType)}><option value="take">Take stock out (Sold)</option><option value="move">Move between locations</option></select></label>}
        {stock && <label className="block text-sm font-medium">From location<select className={input} value={from} onChange={event => setFrom(event.target.value)}>{locations.map(row => <option key={row.location} value={row.location}>{row.label} — {row.available} available</option>)}</select><span className="mt-1 block text-sm text-zinc-500">{source?.available ?? 0} available in {source?.label}. Availability is checked again on approval.</span></label>}
        {kind === 'move' && <label className="block text-sm font-medium">To location<select className={input} value={to} onChange={event => setTo(event.target.value)}>{locations.map(row => <option disabled={row.location === from} key={row.location} value={row.location}>{row.label}</option>)}</select></label>}
        {kind === 'take' && <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-600">Approved take requests move stock to Sold.</p>}
        <label className="block text-sm font-medium">Quantity<input className={input} name="quantity" type="text" inputMode="numeric" pattern="[0-9]+" required defaultValue="1" aria-describedby="quantity-help" /><span id="quantity-help" className="mt-1 block text-sm text-zinc-500">Whole units{stock ? `, up to ${source?.available ?? 0} in this location` : '. Approval records the decision without changing stock'}.</span></label>
        <label className="block text-sm font-medium">Note (optional)<textarea name="note" maxLength={2000} rows={3} className={input} /></label>
      </fieldset>
      {error && <p id="movement-error" role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={busy} className="min-h-11 w-full rounded-md bg-emerald-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : preview ? 'Send sample request' : 'Send request'}</button>
    </form>
  </RequestDialog>;
}
