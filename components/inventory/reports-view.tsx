"use client";
import { brandOptions } from "@/lib/inventory/brands";

import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, Search, X } from "lucide-react";
import { searchMovementProducts } from "@/lib/inventory/actions";
import { ACTION_FORM_LABELS, actionHistoryLabel, canUseManagerMovements } from "@/lib/inventory/movement-form";
import { inventoryIdentifier, inventoryLabel } from "@/lib/inventory/presentation";
import type { CurrentInventoryFilters, MovementReportFilters } from "@/lib/inventory/reports/params";
import { currentReportUrl, downloadName, movementsReportUrl, photoNote } from "@/lib/inventory/reports/urls";
import { saveFailureMessage } from "@/lib/inventory/save-errors";
import { ITEM_TYPES, LOCATION_LABELS, MOVEMENT_ACTIONS, PRODUCT_STATUSES, type InventoryBrand, type InventoryCategoryNode, type MovementPickerProduct } from "@/lib/inventory/types";
import { Banner, PageHeader, buttonClass, cardClass, fieldClass, focusRing } from "./inventory-ui";

type Busy = "current-xlsx" | "current-pdf" | "movements" | null;
const checkClass = `flex min-h-11 items-center gap-3 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 ${focusRing}`;

export function ReportsView({ brands, categories, role, defaultRange, preview = false, previewCatalog = [], previewState = "idle" }: { brands: InventoryBrand[]; categories: InventoryCategoryNode[]; role: string | null; defaultRange: { from: string; to: string }; preview?: boolean; previewCatalog?: MovementPickerProduct[]; previewState?: "idle" | "busy" | "error" }) {
  const [current, setCurrent] = useState<CurrentInventoryFilters>({ brand: "", category: "", itemType: "", location: "", status: "", includeSoldOut: false, photos: false, excelPhotos: true });
  const [moves, setMoves] = useState<MovementReportFilters>({ from: defaultRange.from, to: defaultRange.to, product: "", action: "", location: "", person: "", photos: true });
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null), [term, setTerm] = useState(""), [results, setResults] = useState<MovementPickerProduct[]>([]), [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<Busy>(previewState === "busy" ? "current-pdf" : null), [error, setError] = useState<{ id: string; text: string } | null>(previewState === "error" ? { id: "movements", text: "Too many movements for one file. Narrow the date range." } : null), [done, setDone] = useState(""), [note, setNote] = useState<string | null>(null);
  const lock = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!canUseManagerMovements(role)) return <p role="alert" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700">You do not have permission to see reports.</p>;

  async function download(kind: Exclude<Busy, null>, url: string, fallbackName: string) {
    if (lock.current) return;
    lock.current = true; setBusy(kind); setError(null); setDone(""); setNote(null);
    try {
      if (preview) { await new Promise(resolve => setTimeout(resolve, 600)); setDone("Preview only. No file was made."); return; }
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok || response.redirected) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError({ id: kind, text: body?.error ?? "The file could not be made. Please try again." });
        return;
      }
      const blob = await response.blob(), name = downloadName(response.headers.get("Content-Disposition"), fallbackName), link = document.createElement("a");
      link.href = URL.createObjectURL(blob); link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      setDone(`${name} is ready. Check your downloads.`); setNote(photoNote(response.headers));
    } catch (failure) { setError({ id: kind, text: saveFailureMessage(failure, "The file could not be made. Please try again.") }); }
    finally { lock.current = false; setBusy(null); }
  }
  function search(value: string) {
    setTerm(value);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        if (preview) setResults(previewCatalog.filter(row => [row.item_name, row.stock_ref, row.item_code, row.model_name].some(text => text?.toLowerCase().includes(value.trim().toLowerCase()))));
        else { const response = await searchMovementProducts(value); setResults(response.ok ? response.products : []); }
      } finally { setSearching(false); }
    }, preview ? 0 : 250);
  }
  const setC = <K extends keyof CurrentInventoryFilters>(key: K, value: CurrentInventoryFilters[K]) => setCurrent(previous => ({ ...previous, [key]: value }));
  const setM = <K extends keyof MovementReportFilters>(key: K, value: MovementReportFilters[K]) => setMoves(previous => ({ ...previous, [key]: value }));
  const spinner = <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  const rangeProblem = moves.from && moves.to && moves.to < moves.from ? "The end date must be on or after the start date." : !moves.from || !moves.to ? "Choose both dates." : null;
  const select = (id: string, label: string, value: string, onChange: (value: string) => void, options: (readonly [string, string])[], all: string) => <label htmlFor={id} className="block min-w-0 text-sm font-medium text-zinc-800">{label}
    <select id={id} value={value} onChange={event => onChange(event.target.value)} className={fieldClass}><option value="">{all}</option>{options.map(([optionValue, name]) => <option key={optionValue} value={optionValue}>{name}</option>)}</select></label>;
  const locations = Object.entries(LOCATION_LABELS) as [string, string][];
  return <div className="min-w-0 space-y-4">
    <PageHeader title="Reports" text="Download stock reports. Prices and costs are never included." />
    <p role="status" aria-live="polite" className="sr-only">{busy ? "Making your file…" : done}</p>
    {done && <Banner tone="success">{done}</Banner>}
    {done && note && <Banner tone="info">{note}</Banner>}

    <section aria-labelledby="report-current" className={`${cardClass} space-y-4`}>
      <div><h2 id="report-current" className="text-lg font-semibold text-zinc-950">Current inventory</h2><p className="mt-1 text-sm text-zinc-600">Stock by location for every item, with totals. Photos are added when there are 500 items or fewer.</p></div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {select("rc-brand", "Brand", current.brand, value => setC("brand", value), brandOptions(brands), "All brands")}
        {select("rc-category", "Category", current.category, value => setC("category", value), categories.map(row => [row.id, row.name] as const), "All categories")}
        {select("rc-type", "Item type", current.itemType, value => setC("itemType", value as CurrentInventoryFilters["itemType"]), ITEM_TYPES.map(value => [value, inventoryLabel(value)] as const), "All item types")}
        {select("rc-location", "Location with stock", current.location, value => setC("location", value as CurrentInventoryFilters["location"]), locations.map(([value, name]) => [value, name] as const), "All locations")}
        {select("rc-status", "Status", current.status, value => setC("status", value as CurrentInventoryFilters["status"]), PRODUCT_STATUSES.map(value => [value, inventoryLabel(value)] as const), "All statuses")}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={checkClass}><input type="checkbox" checked={current.includeSoldOut} onChange={event => setC("includeSoldOut", event.target.checked)} className="h-5 w-5 accent-emerald-800" />Include sold-out items</label>
        <label className={checkClass}><input type="checkbox" checked={current.excelPhotos} onChange={event => setC("excelPhotos", event.target.checked)} className="h-5 w-5 accent-emerald-800" />Include photos in Excel</label>
        <label className={checkClass}><input type="checkbox" checked={current.photos} onChange={event => setC("photos", event.target.checked)} className="h-5 w-5 accent-emerald-800" />Include photos in PDF</label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy !== null} onClick={() => download("current-xlsx", currentReportUrl(current, "xlsx"), "inventory-current.xlsx")} className={`${buttonClass.primary} w-full`}>{busy === "current-xlsx" ? <>{spinner}Making Excel file…</> : <><FileSpreadsheet size={18} aria-hidden="true" />Download Excel</>}</button>
        <button type="button" disabled={busy !== null} onClick={() => download("current-pdf", currentReportUrl(current, "pdf"), "inventory-current.pdf")} className={`${buttonClass.secondary} w-full`}>{busy === "current-pdf" ? <>{spinner}Making PDF…</> : <><FileText size={18} aria-hidden="true" />Download PDF</>}</button>
      </div>
      {error && (error.id === "current-xlsx" || error.id === "current-pdf") && <Banner tone="error">{error.text}</Banner>}
    </section>

    <section aria-labelledby="report-movements" className={`${cardClass} space-y-4`}>
      <div><h2 id="report-movements" className="text-lg font-semibold text-zinc-950">Movements history</h2><p className="mt-1 text-sm text-zinc-600">Every stock change in the dates you choose. Up to 20,000 rows per file.</p></div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="block min-w-0 text-sm font-medium text-zinc-800">From date *<input type="date" required value={moves.from} onChange={event => setM("from", event.target.value)} className={fieldClass} /></label>
        <label className="block min-w-0 text-sm font-medium text-zinc-800">To date *<input type="date" required value={moves.to} onChange={event => setM("to", event.target.value)} className={fieldClass} /></label>
        {select("rm-action", "Action", moves.action, value => setM("action", value as MovementReportFilters["action"]), MOVEMENT_ACTIONS.map(value => [value, `${actionHistoryLabel(value)} (${ACTION_FORM_LABELS[value]})`] as const), "All actions")}
        {select("rm-location", "Location", moves.location, value => setM("location", value as MovementReportFilters["location"]), locations.map(([value, name]) => [value, name] as const), "All locations")}
        <label className="block min-w-0 text-sm font-medium text-zinc-800 sm:col-span-2">Done by<input type="search" enterKeyHint="search" maxLength={100} value={moves.person} onChange={event => setM("person", event.target.value)} placeholder="Person name" className={fieldClass} /></label>
      </div>
      <div className="min-w-0 space-y-2">
        <label htmlFor="rm-product" className="block text-sm font-medium text-zinc-800">Product</label>
        {product ? <p className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-950"><span className="min-w-0 break-words py-2">{product.name}</span><button type="button" aria-label="Remove product filter" onClick={() => { setProduct(null); setM("product", ""); }} className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg ${focusRing}`}><X size={16} aria-hidden="true" /></button></p> : <>
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 focus-within:border-emerald-800"><Search size={18} aria-hidden="true" className="shrink-0 text-zinc-500" /><input id="rm-product" type="search" inputMode="search" enterKeyHint="search" value={term} maxLength={100} onChange={event => search(event.target.value)} placeholder="All products. Search to pick one." className="min-h-11 w-full min-w-0 bg-transparent text-base outline-none" /></div>
          {term.trim() && <div aria-live="polite" className="space-y-2">{searching && <p className="text-sm text-zinc-600">Searching…</p>}
            {!searching && results.length === 0 && <p className="text-sm text-zinc-600">No products found.</p>}
            {results.slice(0, 6).map(row => <button key={row.id} type="button" onClick={() => { setProduct({ id: row.id, name: `${row.item_name} · ${inventoryIdentifier(row)}` }); setM("product", row.id); setTerm(""); setResults([]); }} className={`block min-h-11 w-full break-words rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm hover:bg-zinc-50 ${focusRing}`}>{row.item_name}<span className="block text-emerald-800">{inventoryIdentifier(row)}</span></button>)}</div>}
        </>}
      </div>
      <label className={checkClass}><input type="checkbox" checked={moves.photos} onChange={event => setM("photos", event.target.checked)} className="h-5 w-5 accent-emerald-800" />Include photos in Excel</label>
      <p className="-mt-2 text-sm text-zinc-600">Photos are added when there are 2,000 movements or fewer.</p>
      {rangeProblem && <p role="status" className="text-sm text-zinc-700">{rangeProblem}</p>}
      <button type="button" disabled={busy !== null || !!rangeProblem} onClick={() => download("movements", movementsReportUrl(moves), "inventory-movements.xlsx")} className={`${buttonClass.primary} w-full`}>{busy === "movements" ? <>{spinner}Making Excel file…</> : <><FileSpreadsheet size={18} aria-hidden="true" />Download Excel</>}</button>
      {error && error.id === "movements" && <Banner tone="error">{error.text}</Banner>}
    </section>
  </div>;
}
