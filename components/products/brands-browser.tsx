"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { brandCountText, brandFilterQuery, filterBrands, noBrandsMatchText, type BrandFilters, type BrandListRow, type BrandMethodFilter, type BrandStatusFilter } from "@/lib/products/brands-filter";
import type { PriceCheckMode } from "@/lib/products/manual-price-check";
import { PriceCheckModeLabel } from "./brand-price-check-method";

export type BrandCardRow = BrandListRow & { mainCount: number; subCount: number; openHref: string; editHref: string };

import { toolbarActions, toolbarRow, toolbarSearch, toolbarSelectWidth } from "./product-toolbar-styles";
const control = "h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10";
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
const actionLink = `inline-flex h-8 items-center justify-center rounded-md border px-3 text-xs font-semibold transition ${focusRing}`;
const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Right side drawer: traps focus, closes with Esc, the Close button or a click outside, and gives focus back to the button that opened it. */
function BrandDrawer({ title, onClose, returnFocusTo, children }: { title: string; onClose: () => void; returnFocusTo: () => HTMLElement | null; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const closeRef = useRef(onClose);
  const returnRef = useRef(returnFocusTo);
  useEffect(() => { closeRef.current = onClose; returnRef.current = returnFocusTo; });
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true)); // one calm slide; motion-reduce turns it off in the classes below
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("[data-drawer-close]")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(focusable)].filter((item) => item.offsetParent !== null || item === document.activeElement);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow;
      const target = returnRef.current(); if (target?.isConnected) target.focus();
    };
  }, []);
  return <div className="fixed inset-0 z-50">
    <div className={`absolute inset-0 bg-zinc-950/40 transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`} onMouseDown={() => closeRef.current()} aria-hidden="true" />
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={title} className={`absolute inset-y-0 right-0 flex w-full flex-col bg-zinc-50 shadow-xl transition-transform duration-200 motion-reduce:transition-none sm:max-w-3xl ${shown ? "translate-x-0" : "translate-x-full"}`}>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-6">
        <h2 className="min-w-0 truncate text-base font-semibold text-zinc-950">{title}</h2>
        <button type="button" data-drawer-close onClick={() => closeRef.current()} className={`h-9 shrink-0 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${focusRing}`}>Close</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
    </div>
  </div>;
}

/**
 * Brands page body: the toolbar, the card grid and the details drawer. Search and filters run in the browser on the loaded list
 * (the list is one row per Brand), keep ?q=, ?status= and ?method= in the address bar without reloading, and never call the server.
 * Opening a Brand is a normal soft navigation to ?brand=<id>, so the server sends that Brand's details for the drawer.
 */
export function BrandsBrowser({ rows, initialFilters, selectedBrandId, drawer, cardActions, addForm, addHref, backHref, message }: {
  rows: BrandCardRow[]; initialFilters: BrandFilters; selectedBrandId: string; drawer: ReactNode; cardActions: Record<string, ReactNode>; addForm: ReactNode; addHref: string; backHref: string; message: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [typed, setTyped] = useState(initialFilters.q);
  const [activeId, setActiveId] = useState(selectedBrandId);
  const triggerRef = useRef<HTMLElement | null>(null);

  // When the server sends a different selected brand (a link, Back, or a finished action), follow it.
  const [syncedSelected, setSyncedSelected] = useState(selectedBrandId);
  if (syncedSelected !== selectedBrandId) { setSyncedSelected(selectedBrandId); setActiveId(selectedBrandId); }
  // Short delay while typing; status and method apply at once.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => current.q === typed.trim() ? current : { ...current, q: typed.trim() }), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  // Keep the address bar in step without a reload or a new history entry.
  useEffect(() => {
    const next = `${window.location.pathname}${brandFilterQuery(filters, window.location.search)}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [filters]);

  const shown = useMemo(() => filterBrands(rows, filters), [rows, filters]);
  const closeDrawer = useCallback(() => {
    setActiveId("");
    const params = new URLSearchParams(window.location.search);
    for (const key of ["brand", "category", "editBrand", "addBrand", "message"]) params.delete(key);
    startTransition(() => router.replace(`${window.location.pathname}${brandFilterQuery(filters, params)}`, { scroll: false }));
  }, [filters, router]);
  const activeRow = rows.find((row) => row.id === activeId);
  const open = (id: string) => (event: { currentTarget: HTMLElement }) => { triggerRef.current = event.currentTarget; setActiveId(id); };
  const clearSearch = () => { setTyped(""); setFilters((current) => ({ ...current, q: "" })); };

  return <div className="@container px-5 py-5 sm:px-8">
    <div className={toolbarRow}>
      <label className="sr-only" htmlFor="brand-search">Search brands</label>
      <input id="brand-search" type="search" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Search by name, code or origin" className={`${control} ${toolbarSearch}`} />
      <label className="sr-only" htmlFor="brand-status">Status</label>
      <select id="brand-status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as BrandStatusFilter }))} className={`${control} ${toolbarSelectWidth}`}>
        <option value="all">All statuses</option><option value="active">Active</option><option value="archived">Archived</option>
      </select>
      <label className="sr-only" htmlFor="brand-method">Price check method</label>
      <select id="brand-method" value={filters.method} onChange={(event) => setFilters((current) => ({ ...current, method: event.target.value as BrandMethodFilter }))} className={`${control} ${toolbarSelectWidth}`}>
        <option value="all">All price check methods</option><option value="codes">Codes</option><option value="manual">Manual</option>
      </select>
      <div className={toolbarActions}>
        <Link href={backHref} className={`inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${focusRing}`}>Back to products</Link>
        <Link href={addHref} className={`inline-flex h-10 items-center justify-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 ${focusRing}`}>+ Add Brand</Link>
      </div>
    </div>
    <p className="mt-3 text-sm text-zinc-500" role="status" aria-live="polite" data-testid="brand-count">{brandCountText(shown.length, rows.length)}</p>
    {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">{message}</p> : null}
    {addForm ? <div className="mt-4">{addForm}</div> : null}

    {shown.length ? <div className="mt-4 grid auto-rows-fr gap-4 @min-[640px]:grid-cols-2 @min-[1200px]:grid-cols-3">
      {shown.map((brand) => <article key={brand.id} className={`flex h-full flex-col rounded-lg border bg-white p-4 shadow-sm ${brand.id === activeId ? "border-emerald-200 bg-emerald-50/70" : "border-zinc-200"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-zinc-950">{brand.name}</h3>
              {brand.code ? <span className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">Code: {brand.code}</span> : null}
              <PriceCheckModeLabel mode={(brand.method === "manual" ? "manual" : "supplier_codes") satisfies PriceCheckMode} />
            </div>
            <p className="mt-2 text-sm text-zinc-500">Origin: {brand.origin ?? "-"}</p>
            <p className="mt-1 text-sm text-zinc-500">{brand.mainCount} categories · {brand.subCount} subcategories</p>
          </div>
          <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${brand.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-zinc-200 bg-zinc-100 text-zinc-600"}`}>{brand.isActive ? "active" : "inactive"}</span>
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          <Link href={brand.openHref} onClick={open(brand.id)} className={`${actionLink} border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100`}>Open</Link>
          <Link href={brand.editHref} onClick={open(brand.id)} className={`${actionLink} border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50`}>Edit</Link>
          {cardActions[brand.id]}
        </div>
      </article>)}
    </div> : <div className="mt-6 rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
      {rows.length ? <>
        <p>{noBrandsMatchText(filters.q)}</p>
        <button type="button" onClick={clearSearch} className={`mt-3 h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${focusRing}`}>Clear search</button>
      </> : <>
        <p>No brands yet.</p>
        <p className="mt-2">Create a brand to start adding product templates, material groups, and finishes.</p>
      </>}
    </div>}

    {activeId ? <BrandDrawer title={activeRow?.name ?? "Brand details"} onClose={closeDrawer} returnFocusTo={() => triggerRef.current}>
      {selectedBrandId === activeId ? drawer : <p className="text-sm text-zinc-500" role="status">Loading brand…</p>}
    </BrandDrawer> : null}
  </div>;
}
