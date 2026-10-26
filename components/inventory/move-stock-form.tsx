"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, Package, Search } from "lucide-react";
import { StickyActionBar, buttonClass } from "./inventory-ui";
import { NumberInput } from "./number-input";
import { recordDirectMovement, searchMovementProducts } from "@/lib/inventory/actions";
import { ACTION_FORM_LABELS, actionFields, canUseManagerMovements, fromChoices, movementPayload, previewMovement } from "@/lib/inventory/movement-form";
import { LIVE_LOCATIONS } from "@/lib/inventory/movement-form";
import { inventoryIdentifier, formatInventoryNumber } from "@/lib/inventory/presentation";
import { LOCATION_LABELS, LOCATION_QUANTITY_COLUMNS, MOVEMENT_ACTIONS, type InventoryLocation, type MovementAction, type MovementPickerProduct } from "@/lib/inventory/types";
import { saveFailureMessage } from "@/lib/inventory/save-errors";

const field = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const card = "min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5";
const stockOf = (product: MovementPickerProduct, location: InventoryLocation) => product[LOCATION_QUANTITY_COLUMNS[location]];

export function ProductSummary({ product }: { product: MovementPickerProduct }) {
  return <div className="flex min-w-0 items-start gap-3">
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-zinc-100">
      {product.main_image_url ? <Image src={product.main_image_url} alt="" fill unoptimized className="object-cover" sizes="64px" /> : <div className="flex h-full items-center justify-center text-zinc-400"><Package size={22} aria-hidden="true" /></div>}
    </div>
    <div className="min-w-0 flex-1">
      <p className="break-words font-semibold text-zinc-950">{product.item_name}</p>
      <p className="text-sm text-emerald-800 [overflow-wrap:anywhere]">{inventoryIdentifier(product)}</p>
      <p className="mt-1 text-sm text-zinc-600">{LIVE_LOCATIONS.filter(location => stockOf(product, location) > 0).map(location => `${LOCATION_LABELS[location]} ${stockOf(product, location)}`).join(" · ") || "No live stock"}</p>
      <p className="mt-1 text-sm text-zinc-600">Total {formatInventoryNumber(product.quantity)} · Reserved {formatInventoryNumber(product.reserved_quantity)} · Available {formatInventoryNumber(product.available_quantity)}</p>
    </div>
  </div>;
}

export function MoveStockForm({ role, initialProduct = null, preview = false, previewCatalog = [], movementsHref = "/inventory/movements", initialAction = "internal_transfer", initialQuantity = "" }: { role: string | null; initialProduct?: MovementPickerProduct | null; preview?: boolean; previewCatalog?: MovementPickerProduct[]; movementsHref?: string; initialAction?: MovementAction; initialQuantity?: string }) {
  const [product, setProduct] = useState<MovementPickerProduct | null>(initialProduct);
  const [term, setTerm] = useState(""), [results, setResults] = useState<MovementPickerProduct[]>([]), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState("");
  const [action, setAction] = useState<MovementAction>(initialAction), [from, setFrom] = useState("warehouse"), [to, setTo] = useState("dubai_showroom");
  const [quantity, setQuantity] = useState(initialQuantity), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState<{ productId: string; text: string } | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (product || !canUseManagerMovements(role)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true); setSearchError("");
      try {
        const needle = term.trim().toLowerCase();
        const result = preview
          ? { ok: true as const, products: previewCatalog.filter(row => !needle || [row.item_name, row.stock_ref, row.item_code, row.model_name].some(value => value?.toLowerCase().includes(needle))) }
          : await searchMovementProducts(term);
        if (cancelled) return;
        if (result.ok) setResults(result.products); else { setResults([]); setSearchError(result.error); }
      } catch { if (!cancelled) { setResults([]); setSearchError("Could not load products. Try again."); } }
      finally { if (!cancelled) setSearching(false); }
    }, preview ? 0 : 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, product, preview, previewCatalog, role]);
  if (!canUseManagerMovements(role)) return <p role="alert" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">You do not have permission to move stock.</p>;

  const fields = actionFields(action), sources = fromChoices(action);
  const effectiveFrom = sources.includes(from as never) ? from : sources[0];
  const draft = { action, from: effectiveFrom, to, quantity, note };
  const result = product ? previewMovement(product, draft) : null;
  const showPreview = !!product && quantity.trim() !== "";
  async function save() {
    if (!product || !result || result.blocked || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setDone(null);
    try {
      const response = preview ? { ok: true as const } : await recordDirectMovement(movementPayload(product.id, draft));
      if (!response.ok) { setError(response.error); return; }
      const next = { ...product };
      for (const row of result.rows) (next as Record<string, number | string | null>)[LOCATION_QUANTITY_COLUMNS[row.location]] = row.after;
      next.quantity = result.totalAfter; next.available_quantity = result.totalAfter - next.reserved_quantity;
      setProduct(next); setQuantity(""); setNote("");
      setDone({ productId: product.id, text: preview ? "Preview only. Nothing was saved." : "Movement saved." });
    } catch (failure) { setError(saveFailureMessage(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  const locationOption = (location: InventoryLocation, disabled = false) => <option key={location} value={location} disabled={disabled}>{LOCATION_LABELS[location]} ({product ? stockOf(product, location) : 0})</option>;
  return <div className="min-w-0 space-y-4">
    <header className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Move stock</h1><p className="text-sm text-zinc-600">Changes apply straight away and are saved in the movement history.</p></header>
    <section className={card} aria-label="Product">
      <h2 className="font-semibold text-zinc-900">Product</h2>
      {product ? <>
        <ProductSummary product={product} />
        <button type="button" disabled={busy} onClick={() => { setProduct(null); setDone(null); setError(""); setQuantity(""); }} className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">Change product</button>
      </> : <>
        <label className="block text-sm font-medium text-zinc-700" htmlFor="move-search">Search by name, stock ref, item code or model
          <div className="mt-1 flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 focus-within:border-emerald-800"><Search size={18} aria-hidden="true" className="shrink-0 text-zinc-500" /><input id="move-search" type="search" value={term} maxLength={100} onChange={event => setTerm(event.target.value)} placeholder="Start typing" className="min-h-11 w-full min-w-0 bg-transparent text-base outline-none" /></div>
        </label>
        <div aria-live="polite" className="min-w-0 space-y-2">
          {searching && <p className="text-sm text-zinc-500">Searching…</p>}
          {searchError && <p role="alert" className="text-sm text-red-700">{searchError}</p>}
          {!searching && !searchError && results.length === 0 && <p className="text-sm text-zinc-500">No products found.</p>}
          {results.map(row => <button key={row.id} type="button" onClick={() => { setProduct(row); setDone(null); }} className="block min-h-11 w-full rounded-md border border-zinc-200 bg-white p-3 text-left hover:border-emerald-400 hover:bg-emerald-50/40 focus-visible:outline-2 focus-visible:outline-emerald-700"><ProductSummary product={row} /></button>)}
        </div>
      </>}
    </section>
    {product && <section className={card} aria-label="Movement">
      <h2 className="font-semibold text-zinc-900">Movement</h2>
      <label className="block text-sm font-medium text-zinc-700">Action
        <select value={action} disabled={busy} onChange={event => { setAction(event.target.value as MovementAction); setError(""); setDone(null); }} className={field}>{MOVEMENT_ACTIONS.map(value => <option key={value} value={value}>{ACTION_FORM_LABELS[value]}</option>)}</select>
      </label>
      {action === "adjustment" && <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Adjust stock sets Warehouse to the number you enter and clears the other live locations. Use Move between locations to keep them.</p>}
      {fields.from && <label className="block text-sm font-medium text-zinc-700">From location
        <select value={effectiveFrom} disabled={busy} onChange={event => setFrom(event.target.value)} className={field}>{sources.map(location => locationOption(location))}</select>
      </label>}
      {fields.to && <label className="block text-sm font-medium text-zinc-700">To location
        <select value={to} disabled={busy} onChange={event => setTo(event.target.value)} className={field}>{LIVE_LOCATIONS.map(location => locationOption(location, location === effectiveFrom))}</select>
      </label>}
      {!fields.to && fields.fixedTo && <p className="text-sm text-zinc-600">{action === "sale" ? "Sold units move to Sold." : `Stock goes to ${LOCATION_LABELS[fields.fixedTo]}.`}</p>}
      <label className="block text-sm font-medium text-zinc-700">{action === "adjustment" ? "New stock (whole number, 0 or more)" : "Quantity (whole number)"}
        <NumberInput maxLength={10} value={quantity} disabled={busy} onValueChange={text => { setQuantity(text); setDone(null); setError(""); }} className={field} />
      </label>
      <label className="block text-sm font-medium text-zinc-700">Note (optional)
        <textarea rows={3} maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} className={field} />
      </label>
      {showPreview && result && (result.error
        ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{result.error}</p>
        : <div role="status" aria-label="Preview" className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p className="font-semibold">After saving</p>
          {result.rows.length ? result.rows.map(row => <p key={row.location} className="flex flex-wrap items-center gap-1">{row.label} <span className="tabular-nums">{row.before}</span><ArrowRight size={14} aria-hidden="true" /><span className="font-semibold tabular-nums">{row.after}</span></p>) : <p>No change to stock.</p>}
          <p className="pt-1 text-emerald-900">Live total {result.totalBefore} → {result.totalAfter}</p>
        </div>)}
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {done && <p role="status" className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950"><span className="block font-semibold">{done.text}</span><Link href={`${movementsHref}${movementsHref.includes("?") ? "&" : "?"}product=${done.productId}`} className="inline-flex min-h-11 items-center font-semibold text-emerald-900 underline underline-offset-4">View movement</Link></p>}
    </section>}
    {product && <StickyActionBar reason={!showPreview ? "Enter a quantity to continue." : result?.blocked ? "Fix the problem above to save." : null}>
      <button type="button" onClick={save} disabled={busy || !result || result.blocked} className={`${buttonClass.primary} w-full`}>{busy ? <><Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Saving…</> : "Save movement"}</button>
    </StickyActionBar>}
  </div>;
}
