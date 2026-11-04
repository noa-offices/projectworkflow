"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { chipCounts, filterPriceUpdates, noPriceUpdatesText, priceUpdatesChips, priceUpdatesCountText, priceUpdatesFilterQuery, toggleStatusChip, type PriceUpdatesFilters, type PriceUpdatesMethod } from "@/lib/products/price-updates-filter";
import { PriceCheckModeLabel } from "./brand-price-check-method";
import { ManualPriceCheckPanel } from "./manual-price-check-panel";
import { badge, brandTone } from "./price-updates-brands";

export type PriceUpdatesCardData = {
  brandId: string; name: string; state: string; stateLabel: string; method: "codes" | "manual"; href: string; failed?: boolean;
  /** Brands with supplier codes only. */
  coded?: { priceLists: number; inProgress: number; upcoming: number; checked: number; applicable: number; needReview: number };
  /** Manual Brands only. Nothing from the supplier numbers is shown for them. */
  manual?: { latestRelease: string | null; countsText: string; canManage: boolean; today: string };
};

import { cardGridColumns, toolbarRow, toolbarSearch, toolbarSelectWidth } from "./product-toolbar-styles";
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800";
const control = `h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10`;
const dateText = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

/** One small Brand card. A manual Brand never shows the supplier list numbers. */
export function PriceUpdatesCard({ card, canEditBrand, onChanged }: { card: PriceUpdatesCardData; canEditBrand: boolean; onChanged?: () => void }) {
  if (card.failed) return <li className="flex h-full flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
    <p className="font-semibold text-zinc-950">{card.name}</p>
    <p className="text-xs text-amber-900">Could not load price status. Reload to try again.</p>
    <Link href={card.href} className={`mt-auto inline-flex text-xs font-semibold text-emerald-900 hover:text-emerald-800 ${focusRing}`}>Open Brand</Link>
  </li>;
  const { coded, manual } = card;
  return <li className="flex h-full flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
    <div className="flex items-start justify-between gap-2">
      <h3 className="min-w-0 truncate text-base font-semibold leading-tight text-zinc-950" title={card.name}>{card.name}</h3>
      <span className={`${badge} shrink-0 ${brandTone[card.state as keyof typeof brandTone] ?? brandTone.legacy_manual}`}>{card.state === "legacy_manual" ? "Manual" : card.stateLabel}</span>
    </div>
    <div><PriceCheckModeLabel mode={card.method === "manual" ? "manual" : "supplier_codes"} /></div>
    {manual ? <>
      <p className="text-xs text-zinc-700">{manual.latestRelease ? `Price list released ${dateText(manual.latestRelease)}` : "No price list released yet."}</p>
      {manual.latestRelease ? <p className="text-xs text-zinc-600">{manual.countsText}</p> : null}
      <ManualPriceCheckPanel brandId={card.brandId} brandName={card.name} manual releases={[]} canManage={manual.canManage} today={manual.today} compact onChanged={onChanged} />
    </> : coded ? <div className="space-y-0.5 text-xs text-zinc-600">
      <p>Families checked {coded.applicable ? `${coded.checked} / ${coded.applicable}` : "—"} · Need review {coded.needReview}</p>
      <p>Current lists {coded.priceLists} · In progress {coded.inProgress}{coded.upcoming ? ` · Upcoming ${coded.upcoming}` : ""}</p>
    </div> : null}
    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
      {canEditBrand ? <Link href={`/products/brands?brand=${card.brandId}&editBrand=${card.brandId}`} className={`text-xs font-semibold text-emerald-900 underline ${focusRing}`}>Edit brand</Link> : <span />}
      <Link href={card.href} aria-label={`Open ${card.name}`} className={`inline-flex h-8 items-center rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 ${focusRing}`}>Open Brand</Link>
    </div>
  </li>;
}

/**
 * Price Updates body: status chips, one toolbar row and a grid of small Brand cards. Search and the filters run in the browser on the
 * loaded list (one card per active Brand) and keep ?q=, ?status= and ?method= in the address bar without a reload.
 */
export function PriceUpdatesBrowser({ cards, initialFilters, statusOptions, canEditBrand }: { cards: PriceUpdatesCardData[]; initialFilters: PriceUpdatesFilters; statusOptions: Array<{ value: string; label: string }>; canEditBrand: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [filters, setFilters] = useState(initialFilters);
  const [typed, setTyped] = useState(initialFilters.q);
  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => current.q === typed.trim() ? current : { ...current, q: typed.trim() }), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  useEffect(() => {
    const next = `${window.location.pathname}${priceUpdatesFilterQuery(filters, window.location.search)}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [filters]);
  const rows = useMemo(() => cards.map((card) => ({ brandId: card.brandId, name: card.name, state: card.state, method: card.method, failed: card.failed })), [cards]);
  const shown = useMemo(() => new Set(filterPriceUpdates(rows, filters).map((row) => row.brandId)), [rows, filters]);
  const visible = cards.filter((card) => shown.has(card.brandId));
  const counts = useMemo(() => chipCounts(rows, filters), [rows, filters]);
  const refresh = () => startTransition(() => router.refresh()); // the card shows the new release without a full page reload

  return <div className="@container space-y-4">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
      {priceUpdatesChips.map((chip) => {
        const active = filters.status === chip.state;
        return <button key={chip.state} type="button" aria-pressed={active} onClick={() => setFilters((current) => toggleStatusChip(current, chip.state))}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${focusRing} ${active ? "border-emerald-800 bg-emerald-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"}`}>
          {chip.label}<span className="tabular-nums">{counts[chip.state] ?? 0}</span>
        </button>;
      })}
    </div>
    <div className={toolbarRow}>
      <label className="sr-only" htmlFor="pu-search">Search brands</label>
      <input id="pu-search" type="search" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Search by brand name" className={`${control} ${toolbarSearch}`} />
      <label className="sr-only" htmlFor="pu-status">Status</label>
      <select id="pu-status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className={`${control} ${toolbarSelectWidth}`}>
        <option value="">All statuses</option>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="pu-method">Price check method</label>
      <select id="pu-method" value={filters.method} onChange={(event) => setFilters((current) => ({ ...current, method: event.target.value as PriceUpdatesMethod }))} className={`${control} ${toolbarSelectWidth}`}>
        <option value="all">All price check methods</option><option value="codes">Codes</option><option value="manual">Manual</option>
      </select>
      <p className="text-sm text-zinc-500 @xl:ml-auto" role="status" aria-live="polite" data-testid="pu-count">{priceUpdatesCountText(visible.length, cards.length)}</p>
    </div>
    {visible.length ? <ul className={cardGridColumns} aria-label="Brands">
      {visible.map((card) => <PriceUpdatesCard key={card.brandId} card={card} canEditBrand={canEditBrand} onChanged={refresh} />)}
    </ul> : <div className="rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
      <p>{cards.length ? noPriceUpdatesText(filters.q) : "No brands yet."}</p>
      {cards.length ? <button type="button" onClick={() => { setTyped(""); setFilters({ q: "", status: "", method: "all" }); }} className={`mt-3 h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${focusRing}`}>Clear search</button> : null}
    </div>}
  </div>;
}
