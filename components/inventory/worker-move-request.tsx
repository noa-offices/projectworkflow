"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { StickyActionBar, buttonClass } from "./inventory-ui";
import { NumberInput } from "./number-input";
import { ProductSummary } from "./move-stock-form";
import { searchRequestProducts, submitMovementRequest } from "@/lib/inventory/actions";
import { availableLocations, movementSubmitLabel } from "@/lib/inventory/request-presentation";
import { defaultFromLocation, sendWorkerRequest, workerToLocation } from "@/lib/inventory/worker-move";
import { saveFailureMessage } from "@/lib/inventory/save-errors";
import { LOCATION_LABELS, type MovementPickerProduct, type RequestType } from "@/lib/inventory/types";

const field = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const card = "min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";
const STEPS = ["Find the item", "Choose what to do", "Request sent"] as const;
export const REQUESTS_HREF = "/inventory/requests?tab=movements&mine=1";

/** Warehouse Staff: find an item, choose Take or Move, send a request. A manager approves it later. */
export function WorkerMoveRequest({ initialProduct = null, preview = false, previewCatalog = [] }: { initialProduct?: MovementPickerProduct | null; preview?: boolean; previewCatalog?: MovementPickerProduct[] }) {
  const [product, setProduct] = useState<MovementPickerProduct | null>(initialProduct);
  const [term, setTerm] = useState(""), [results, setResults] = useState<MovementPickerProduct[]>([]), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState("");
  const [kind, setKind] = useState<Extract<RequestType, "take" | "move">>("take"), [from, setFrom] = useState("warehouse"), [to, setTo] = useState("dubai_showroom");
  const [quantity, setQuantity] = useState("1"), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    if (product) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true); setSearchError("");
      try {
        const needle = term.trim().toLowerCase();
        const result = preview
          ? { ok: true as const, products: previewCatalog.filter(row => !needle || [row.item_name, row.stock_ref, row.item_code, row.model_name].some(value => value?.toLowerCase().includes(needle))) }
          : await searchRequestProducts(term);
        if (cancelled) return;
        if (result.ok) setResults(result.products); else { setResults([]); setSearchError(result.error); }
      } catch { if (!cancelled) { setResults([]); setSearchError("Could not load items. Check your internet and try again."); } }
      finally { if (!cancelled) setSearching(false); }
    }, preview ? 0 : 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, product, preview, previewCatalog]);

  const step = sent ? 3 : product ? 2 : 1;
  const stockProduct = product ? { ...product, is_active: true } : null;
  const locations = stockProduct ? availableLocations(stockProduct) : [];
  const source = locations.find(row => row.location === from);
  const toValue = product ? workerToLocation(product, from, to) : to;

  function choose(row: MovementPickerProduct) {
    setProduct(row); setFrom(defaultFromLocation(row)); setQuantity("1"); setNote(""); setError("");
  }
  function reset() { setProduct(null); setSent(false); setError(""); setQuantity("1"); setNote(""); setKind("take"); setTerm(""); }
  async function send() {
    if (!product || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await sendWorkerRequest(product, { kind, from, to, quantity, note }, async payload => preview ? { ok: true } : submitMovementRequest(payload));
      if (!result.ok) { setError(result.error); return; }
      setSent(true);
    } catch (cause) { setError(saveFailureMessage(cause, "Unable to send your request. Please try again.")); }
    finally { lock.current = false; setBusy(false); }
  }

  return <div className="min-w-0 space-y-4">
    <header className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Take / Move stock</h1>
      <p className="text-sm text-zinc-600">Send a request. A manager will approve it before stock changes.</p>
      <p data-step={step} className="pt-1 text-sm font-semibold text-emerald-900">Step {step} of 3 · {STEPS[step - 1]}</p>
    </header>

    {step === 1 && <section className={card} aria-label="Find the item">
      <label className="block text-sm font-medium text-zinc-700" htmlFor="request-search">Search by name, Stock ref, item code or model
        <div className="mt-1 flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 focus-within:border-emerald-800"><Search size={18} aria-hidden="true" className="shrink-0 text-zinc-500" /><input id="request-search" type="search" value={term} maxLength={100} onChange={event => setTerm(event.target.value)} placeholder="Start typing" className="min-h-11 w-full min-w-0 bg-transparent text-base text-zinc-900 outline-none" /></div>
      </label>
      <div aria-live="polite" className="min-w-0 space-y-2">
        {searching && <p className="text-sm text-zinc-500">Searching…</p>}
        {searchError && <p role="alert" className="text-sm text-red-700">{searchError}</p>}
        {!searching && !searchError && results.length === 0 && <p className="text-sm text-zinc-500">No items found.</p>}
        {results.map(row => <button key={row.id} type="button" onClick={() => choose(row)} className="block min-h-11 w-full rounded-md border border-zinc-200 bg-white p-3 text-left hover:border-emerald-400 hover:bg-emerald-50/40 focus-visible:outline-2 focus-visible:outline-emerald-700"><ProductSummary product={row} /></button>)}
      </div>
    </section>}

    {step === 2 && product && <>
      <section className={card} aria-label="Item">
        <ProductSummary product={product} />
        <button type="button" disabled={busy} onClick={reset} className={`${buttonClass.secondary} w-full`}>Change item</button>
      </section>
      <section className={card} aria-label="Request">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <label className="block text-sm font-medium text-zinc-700">What do you want to do?<select className={field} value={kind} onChange={event => { setKind(event.target.value as "take" | "move"); setError(""); }}><option value="take">Take stock out (Sold)</option><option value="move">Move between locations</option></select></label>
          <label className="block text-sm font-medium text-zinc-700">From location<select className={field} value={from} onChange={event => { setFrom(event.target.value); setError(""); }}>{locations.map(row => <option key={row.location} value={row.location}>{row.label} — {row.available} available</option>)}</select>
            <span className="mt-1 block text-sm text-zinc-500">{source?.available ?? 0} available in {source?.label}. {product.reserved_quantity} units are reserved across locations. Availability is checked again when applied.</span></label>
          {kind === "move" && <label className="block text-sm font-medium text-zinc-700">To location<select className={field} value={toValue} onChange={event => setTo(event.target.value)}>{locations.map(row => <option disabled={row.location === from} key={row.location} value={row.location}>{LOCATION_LABELS[row.location]}</option>)}</select></label>}
          {kind === "take" && <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-600">Approved take requests move stock to Sold.</p>}
          <label className="block text-sm font-medium text-zinc-700">Quantity<NumberInput maxLength={10} value={quantity} onValueChange={text => { setQuantity(text); setError(""); }} className={field} aria-describedby="request-quantity-help" /><span id="request-quantity-help" className="mt-1 block text-sm text-zinc-500">Whole units, up to {source?.available ?? 0} available in this location.</span></label>
          <label className="block text-sm font-medium text-zinc-700">Reason or note (optional)<textarea rows={3} maxLength={2000} value={note} onChange={event => setNote(event.target.value)} className={field} /></label>
        </fieldset>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </section>
      <StickyActionBar><button type="button" onClick={send} disabled={busy} className={`${buttonClass.primary} w-full`}>{busy ? <><Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Sending…</> : movementSubmitLabel("warehouse_staff", kind, preview)}</button></StickyActionBar>
    </>}

    {step === 3 && <section className={card} aria-label="Request sent">
      <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-950">Request sent. A manager will approve it.</p>
      <Link href={REQUESTS_HREF} className={`${buttonClass.primary} w-full`}>See my requests</Link>
      <button type="button" onClick={reset} className={`${buttonClass.secondary} w-full`}>Send another request</button>
    </section>}
  </div>;
}
