'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { searchInventoryProjects, submitMovementRequest, type InventoryActionResult } from '@/lib/inventory/actions';
import { availableLocations, movementRequestPayload, movementSubmitLabel, requestButtons } from '@/lib/inventory/request-presentation';
import { canManageInventory } from '@/lib/inventory/access';
import type { InventoryProduct, InventoryProjectOption, RequestType } from '@/lib/inventory/types';
import { RequestDialog } from './request-dialog';
import { ProductManagerTools } from './product-manager-tools';
import { StickyActionBar, buttonClass } from './inventory-ui';
import { NumberInput } from './number-input';
import { saveFailureMessage } from "@/lib/inventory/save-errors";

const input = 'mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950';
const button = 'inline-flex min-h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50';
const sampleProjects: InventoryProjectOption[] = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'PR-2026-042 — Marina office — Acme Interiors' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', label: 'PR-2026-043 — Downtown studio — North Design' },
];
export function ProductRequestActions({ product, role, preview = false, initialKind, initialRemove = false }: { product: InventoryProduct; role: string | null; preview?: boolean; initialKind?: RequestType; initialRemove?: boolean }) {
  const [kind, setKind] = useState<RequestType | null>(initialKind ?? null), [success, setSuccess] = useState(false);
  const buttons = requestButtons(role);
  if (!product.is_active) return null;
  return <section className="my-4 min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" aria-label="Product requests">
    {buttons.takeMove || buttons.holdBook ? <><h2 className="mb-3 text-base font-semibold">{canManageInventory(role) ? "Stock actions" : "Request stock"}</h2><div className="flex flex-wrap gap-2">
      {buttons.takeMove && <button className={button} onClick={() => { setKind('take'); setSuccess(false); }}>Take / Move stock</button>}
      <ProductManagerTools product={product} role={role} preview={preview} initialRemove={initialRemove} />
      {buttons.holdBook && <>{(['hold','book'] as const).map(value => <button className={button} key={value} onClick={() => { setKind(value); setSuccess(false); }}>{movementSubmitLabel(role, value)}</button>)}</>}
    </div></> : <p className="text-sm text-zinc-600">Inventory requests are view only for your role.</p>}
    {success && <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{canManageInventory(role) ? 'Done' : 'Your request was sent for review.'}</p>}
    {kind && ((buttons.takeMove && (kind === 'take' || kind === 'move')) || (buttons.holdBook && (kind === 'hold' || kind === 'book'))) && <MovementRequestForm key={kind === 'take' || kind === 'move' ? 'stock' : kind} product={product} role={role} initialKind={kind} preview={preview} onClose={() => setKind(null)} onSuccess={() => { setKind(null); setSuccess(true); }} />}
  </section>;
}
export function MovementRequestForm({ product, role = null, initialKind, preview = false, onClose, onSuccess }: { product: InventoryProduct; role?: string | null; initialKind: RequestType; preview?: boolean; onClose: () => void; onSuccess: () => void }) {
  const [kind, setKind] = useState(initialKind), [from, setFrom] = useState('warehouse'), [to, setTo] = useState('dubai_showroom');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [projectSearch, setProjectSearch] = useState(''), [project, setProject] = useState<InventoryProjectOption | null>(null);
  const [projects, setProjects] = useState<InventoryProjectOption[]>([]), [searching, setSearching] = useState(false), [projectError, setProjectError] = useState('');
  const lock = useRef(false), router = useRouter(), locations = availableLocations(product);
  const stock = kind === 'take' || kind === 'move', source = locations.find(row => row.location === from);
  useEffect(() => {
    if (stock || project) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true); setProjectError('');
      try {
        const result = preview
          ? { ok: true as const, projects: sampleProjects.filter(row => row.label.toLowerCase().includes(projectSearch.trim().toLowerCase())) }
          : await searchInventoryProjects(projectSearch);
        if (cancelled) return;
        if (result.ok) setProjects(result.projects);
        else { setProjects([]); setProjectError(result.error); }
      } catch {
        if (!cancelled) { setProjects([]); setProjectError('Unable to load projects. Try searching again or enter a reference.'); }
      } finally { if (!cancelled) setSearching(false); }
    }, preview ? 0 : 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [stock, project, projectSearch, preview]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return;
    const data = new FormData(event.currentTarget);
    try {
      setError('');
      const holdUntil = kind === 'hold' ? String(data.get('holdUntil') ?? '') : '';
      const payload = movementRequestPayload(product, { kind, from, to, quantity: String(data.get('quantity') ?? ''), note: String(data.get('note') ?? ''),
        projectId: stock ? null : project?.id ?? null, referenceNote: stock ? null : String(data.get('referenceNote') ?? ''),
        expiresAt: holdUntil ? new Date(holdUntil).toISOString() : null });
      lock.current = true; setBusy(true);
      const result: InventoryActionResult = preview ? {ok:true} : await submitMovementRequest(payload);
      if (!result.ok) { setError(result.error); return; }
      onSuccess(); if (!preview) router.refresh();
    } catch (cause) { setError(saveFailureMessage(cause, cause instanceof Error ? cause.message : 'Unable to send your request. Please try again.')); }
    finally { lock.current = false; setBusy(false); }
  }
  return <RequestDialog title={stock ? 'Take / Move stock' : kind === 'hold' ? 'Hold stock' : 'Book stock'} onClose={onClose} busy={busy}>
    <p className="mb-4 break-words font-semibold">{product.item_name}</p>
    <form onSubmit={submit} onChange={() => { if (error) setError(''); }} className="min-w-0 space-y-4" aria-describedby={error ? 'movement-error' : undefined}>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        {stock && <label className="block text-sm font-medium">Request type<select className={input} value={kind} onChange={event => setKind(event.target.value as RequestType)}><option value="take">Take stock out (Sold)</option><option value="move">Move between locations</option></select></label>}
        {stock && <label className="block text-sm font-medium">From location<select className={input} value={from} onChange={event => setFrom(event.target.value)}>{locations.map(row => <option key={row.location} value={row.location}>{row.label} — {row.available} available</option>)}</select><span className="mt-1 block text-sm text-zinc-500">{source?.available ?? 0} available in {source?.label}. {product.reserved_quantity} units are reserved across locations. Availability is checked again when applied.</span></label>}
        {kind === 'move' && <label className="block text-sm font-medium">To location<select className={input} value={to} onChange={event => setTo(event.target.value)}>{locations.map(row => <option disabled={row.location === from} key={row.location} value={row.location}>{row.label}</option>)}</select></label>}
        {kind === 'take' && <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-600">Approved take requests move stock to Sold.</p>}
        <label className="block text-sm font-medium">Quantity<NumberInput className={input} name="quantity" maxLength={10} required defaultValue="1" aria-describedby="quantity-help" /><span id="quantity-help" className="mt-1 block text-sm text-zinc-500">Whole units, up to {stock ? `${source?.available ?? 0} available in this location` : `${product.available_quantity} available`}.{!stock && ' Approved holds and bookings reserve these units.'}</span></label>
        {!stock && <div className="min-w-0 space-y-3 rounded-md border border-zinc-200 p-3">
          <p className="text-sm text-zinc-600">{kind === 'book' ? 'Choose a project or enter a reference for this booking.' : 'Optionally link this hold to a project or reference.'}</p>
          {project ? <div className="min-w-0"><p className="break-words text-sm font-medium">{project.label}</p><button type="button" className={`${button} mt-2`} onClick={() => { setProject(null); setProjectSearch(''); }}>Change project</button></div> : <>
            <label className="block text-sm font-medium">Search projects<input type="search" className={input} value={projectSearch} maxLength={200} onChange={event => { setProjectSearch(event.target.value); setProjects([]); }} placeholder="Project number, name or client" /></label>
            <div aria-live="polite" className="min-w-0 space-y-2">
              {searching && <p className="text-sm text-zinc-500">Searching projects…</p>}
              {projectError && <p role="alert" className="text-sm text-red-800">{projectError}</p>}
              {!searching && !projectError && projects.length === 0 && <p className="text-sm text-zinc-500">No projects found. You can enter a reference below.</p>}
              {projects.map(row => <button key={row.id} type="button" className="min-h-11 w-full break-words rounded-md border border-zinc-200 bg-white p-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setProject(row); setSearching(false); }}>{row.label}</button>)}
            </div>
          </>}
          <label className="block text-sm font-medium">Reference {kind === 'book' && !project ? '(required without a project)' : '(optional)'}<input className={input} name="referenceNote" maxLength={2000} required={kind === 'book' && !project} placeholder="Client, delivery or other reference" /></label>
          {kind === 'hold' && <label className="block text-sm font-medium">Hold until (optional)<input className={input} name="holdUntil" type="datetime-local" /><span className="mt-1 block text-sm text-zinc-500">Your local date and time. The units become available after this time.</span></label>}
        </div>}
        <label className="block text-sm font-medium">Note (optional)<textarea name="note" maxLength={2000} rows={3} className={input} /></label>
      </fieldset>
      {error && <p id="movement-error" role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <StickyActionBar><button disabled={busy} className={buttonClass.primary + ' w-full'}>{busy ? 'Sending…' : movementSubmitLabel(role, kind, preview)}</button></StickyActionBar>
    </form>
  </RequestDialog>;
}
