"use client";

import Link from "next/link";
import { useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { EscapeLayerProvider, useEscapeLayerRegistry } from "@/components/products/escape-layer";
import { ShareControl } from "@/components/products/my-collection-share-send";
import { SharedWithYouTab } from "@/components/products/my-collection-shared";
import { CustomItemPickerPane, CustomItemTargetContext } from "@/components/quotations/custom-item-picker-pane";
import { ConfiguredFilterColumn, RemovedProducts, SetupActionRow, SetupRenameInput, SetupThumbnail, useSetupActions, type SetupCallbacks } from "@/components/products/my-collection-list";
import { listPickerSetups, loadSetupForReplay, markSetupUsed } from "@/lib/products/saved-setups/actions";
import { listRemovedSetups } from "@/lib/products/saved-setups/saved-setups-list-actions";
import { sharedTabLabel, type ShareKind } from "@/lib/products/saved-setups/shares";
import { pendingShareCountAction } from "@/lib/products/saved-setups/shares-actions";
import {
  COLLECTION_SORT_OPTIONS,
  CONFIGURED_PAGE_SIZE,
  CONFIGURED_RECENT_LIMIT,
  brandsWithCounts,
  filterConfigured,
  groupByBrandProduct,
  hasActiveFilters,
  productsForBrand,
  recentlyUsed,
  setupCountLabel,
  showMoreSlice,
  sortSetups,
  type CollectionSortMode,
} from "@/lib/products/saved-setups/collection-view";
import type { PickerSetup, SetupForUse, SetupListItem } from "@/lib/products/saved-setups/saved-setups-service";

/**
 * "Add from My Collection": the user's own USABLE setups (Recently used, then Brand > Product > setups) and custom items,
 * with every control inside this one popup (rename, delete, removed products, add / edit custom items). Choosing a setup
 * hands the saved recipe to the Product Library selector, which opens the normal configurator pre-filled. Nothing is added
 * to the quotation here, and no price is read or shown.
 * `onChoose` returns an error message to keep the picker open with a notice, or null when it took over.
 */
function SetupPickCard({ disabled, item, onPick, showProduct, onMessage, callbacks }: { disabled: boolean; item: PickerSetup; onPick: (id: string) => void; showProduct: boolean; onMessage: (message: string) => void; callbacks: SetupCallbacks }) {
  const actions = useSetupActions(item, onMessage, callbacks);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition hover:border-emerald-700">
      {actions.editing ? (
        <SetupRenameInput actions={actions} />
      ) : (
        /* The card body is the click target that picks the setup. Rename / Delete below are separate buttons. */
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPick(item.id)}
          className="flex h-full w-full items-center gap-3 rounded-md text-left transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:opacity-60"
        >
          <SetupThumbnail path={item.imagePath} alt={item.setupName} size={88} />
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-bold leading-snug text-zinc-900">{item.setupName}</span>
            {showProduct ? <span className="mt-1 block truncate text-xs text-zinc-500">{item.productName}</span> : null}
            {item.productCode ? <span className="mt-1 block truncate text-xs text-zinc-400">{item.productCode}</span> : null}
          </span>
        </button>
      )}
      <SetupActionRow item={item} actions={actions} extra={<ShareControl kind="setup" itemId={item.id} itemName={item.setupName} />} />
    </li>
  );
}

export function AddFromMyCollectionButton({
  onChoose,
  initialTab = "configured",
}: {
  onChoose: (setup: SetupForUse) => string | null;
  /** Other places can open the popup straight on a tab. The default is unchanged ("configured"). */
  initialTab?: "configured" | "custom" | "shared";
}) {
  const [open, setOpen] = useState(false);
  const [setups, setSetups] = useState<PickerSetup[] | null>(null);
  const [removed, setRemoved] = useState<SetupListItem[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CollectionSortMode>("recent");
  const [brand, setBrand] = useState<string | null>(null);
  const [product, setProduct] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const customTarget = useContext(CustomItemTargetContext);
  const [tab, setTab] = useState<"configured" | "custom" | "shared">(initialTab);
  const [pendingShares, setPendingShares] = useState(0);
  const showConfigured = tab === "configured" || !customTarget;
  const searchRef = useRef<HTMLInputElement>(null);
  const { layers, closeTop } = useEscapeLayerRegistry();

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Escape closes the innermost open thing (an edit panel, a rename, a delete confirm) and the popup only when nothing
  // inside is open. This also works when focus is not inside the popup (for example right after a button was replaced).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!closeTop()) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeTop]);

  function openPicker() {
    setOpen(true);
    setTab(initialTab);
    setNotice("");
    setSearch("");
    setSort("recent");
    setBrand(null);
    setProduct(null);
    setShown({});
    startTransition(async () => {
      try {
        const waiting = await pendingShareCountAction(); // one light count; a failure just shows no count
        setPendingShares(waiting.ok ? waiting.count : 0);
      } catch {
        setPendingShares(0);
      }
      try {
        setSetups(await listPickerSetups());
      } catch {
        setSetups([]);
        setNotice("Your collection could not be loaded.");
      }
      try {
        setRemoved(await listRemovedSetups());
      } catch {
        setRemoved([]);
      }
    });
  }

  function choose(id: string) {
    setNotice("");
    startTransition(async () => {
      try {
        const result = await loadSetupForReplay(id);
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        const problem = onChoose(result.setup);
        if (problem) {
          setNotice(problem);
          return;
        }
        setOpen(false);
        void markSetupUsed(id).catch(() => undefined); // best effort: never blocks the user
      } catch {
        setNotice("This setup could not be opened.");
      }
    });
  }

  // A shared setup that was just added shows up in the Configured list at once (the Custom tab reads its list when it opens).
  function afterShareAccepted(kind: ShareKind) {
    if (kind !== "setup") return;
    startTransition(async () => {
      try {
        setSetups(await listPickerSetups());
      } catch {
        // the list refreshes the next time the popup opens
      }
    });
  }

  // After a rename or delete the list changes at once; the popup stays open.
  const setupCallbacks: SetupCallbacks = {
    onRenamed: (id, name) => setSetups((current) => current?.map((item) => (item.id === id ? { ...item, setupName: name } : item)) ?? current),
    onDeleted: (id) => setSetups((current) => current?.filter((item) => item.id !== id) ?? current),
  };
  const removedCallbacks: SetupCallbacks = {
    onRenamed: (id, name) => setRemoved((current) => current.map((item) => (item.id === id ? { ...item, setupName: name } : item))),
    onDeleted: (id) => setRemoved((current) => current.filter((item) => item.id !== id)),
  };

  const searching = search.trim().length > 0;
  const brands = useMemo(() => brandsWithCounts(setups ?? []), [setups]);
  // A brand or product that no longer exists (after a delete) falls back to "all".
  const activeBrand = brand && brands.some((entry) => entry.name === brand) ? brand : null;
  const products = useMemo(() => productsForBrand(setups ?? [], activeBrand), [setups, activeBrand]);
  const activeProduct = activeBrand && product && products.some((entry) => entry.name === product) ? product : null;
  const filter = { brand: activeBrand, product: activeProduct, query: search };
  const filtered = useMemo(() => filterConfigured(setups ?? [], { brand: activeBrand, product: activeProduct, query: search }), [setups, activeBrand, activeProduct, search]);
  // "Recently used" (up to 6) only with no search and All brands selected.
  const recent = useMemo(() => (searching || activeBrand ? [] : recentlyUsed(setups ?? [], CONFIGURED_RECENT_LIMIT)), [setups, searching, activeBrand]);
  const grouped = useMemo(() => groupByBrandProduct(sortSetups(filtered, sort)), [filtered, sort]);

  function clearFilters() {
    setSearch("");
    setBrand(null);
    setProduct(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="border border-zinc-300 bg-white px-3 py-2 text-xs font-bold text-emerald-900 transition hover:bg-emerald-50"
      >
        Add from My Collection
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-stretch justify-center bg-zinc-950/30 p-0 sm:items-center sm:p-[3vw]"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              if (!closeTop()) setOpen(false);
            }
          }}
        >
          {/* Phones: full screen. Wider screens: up to 1200px (94vw) wide and 90vh tall. One modal only: forms open as a panel inside it. */}
          <EscapeLayerProvider value={layers}>
          <div role="dialog" aria-modal="true" aria-label="My Collection" className="flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-[90vh] sm:w-[min(1200px,94vw)] sm:max-w-[1200px] sm:rounded-lg sm:border sm:border-zinc-300">
            <div className="sticky top-0 z-10 space-y-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">My Collection</h2>
                  <p className="text-xs text-zinc-500">Pick a saved setup. Prices are recalculated from the current price lists.</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Link href="/products/my-collection" className="hidden text-xs font-semibold text-emerald-900 underline sm:inline">
                    Open My Collection page
                  </Link>
                  <button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">Close</button>
                </div>
              </div>
              {customTarget ? (
                <div role="tablist" aria-label="My Collection" className="flex gap-2 border-b border-zinc-200">
                  {([["configured", "Configured products"], ["custom", "Custom items"]] as const).map(([value, label]) => (
                    <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`h-9 border-b-2 px-3 text-sm font-semibold transition ${tab === value ? "border-emerald-900 text-emerald-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>{label}</button>
                  ))}
                  {pendingShares > 0 || tab === "shared" ? (
                    <button type="button" role="tab" aria-selected={tab === "shared"} onClick={() => setTab("shared")} className={`h-9 border-b-2 px-3 text-sm font-semibold transition ${tab === "shared" ? "border-emerald-900 text-emerald-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>{sharedTabLabel(pendingShares)}</button>
                  ) : null}
                </div>
              ) : null}
              {showConfigured ? (
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, product or brand"
                  aria-label="Search My Collection"
                  className="h-10 min-w-0 flex-1 basis-56 rounded-md border border-zinc-300 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
                />
                <label className="flex items-center gap-2 text-xs font-semibold uppercase text-zinc-500">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as CollectionSortMode)}
                    className="h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm font-normal normal-case text-zinc-800 outline-none focus:border-emerald-800"
                  >
                    {COLLECTION_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {hasActiveFilters(filter) ? (
                  <button type="button" onClick={clearFilters} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900">Clear filters</button>
                ) : null}
                <Link href="/products/my-collection" className="shrink-0 text-xs font-semibold text-emerald-900 underline sm:hidden">
                  Open My Collection page
                </Link>
              </div>
              ) : null}
            </div>
            {!showConfigured && customTarget && tab === "custom" ? <CustomItemPickerPane target={customTarget} onClose={() => setOpen(false)} /> : null}
            {!showConfigured && customTarget && tab === "shared" ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
                {/* The SAME component and actions as the My Collection page. Accepting here refreshes this popup's own lists,
                    never the quotation page. */}
                <SharedWithYouTab
                  onPendingChange={setPendingShares}
                  onOpenTab={(next) => { if (next === "configured" || next === "custom") setTab(next); }}
                  refreshPage={false}
                  showBack
                  onAccepted={afterShareAccepted}
                />
                <p className="text-xs text-zinc-500">
                  <Link href="/products/my-collection?tab=sent" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-900 underline">View sent shares</Link> (opens My Collection in a new tab)
                </p>
              </div>
            ) : null}
            {showConfigured ? (<>
            {notice ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-5">{notice}</p> : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
              {setups === null || (pending && setups.length === 0) ? (
                <p className="px-4 py-4 text-sm text-zinc-500 sm:px-5">Loading...</p>
              ) : setups.length === 0 && removed.length === 0 ? (
                <p className="m-4 flex-1 rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 sm:m-5">
                  No saved setups yet. Save a configured product from the Product Library and it appears here.
                </p>
              ) : (
                <>
                  <div className="px-4 pt-4 md:w-64 md:shrink-0 md:overflow-y-auto md:pb-4 md:pl-5 md:pr-0">
                    <ConfiguredFilterColumn
                      brands={brands}
                      products={products}
                      total={setups.length}
                      selectedBrand={activeBrand}
                      selectedProduct={activeProduct}
                      onSelectBrand={(value) => { setBrand(value); setProduct(null); }}
                      onSelectProduct={setProduct}
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-6 px-4 py-4 sm:px-5 md:overflow-y-auto">
                    {grouped.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                        <p>{setups.length === 0 ? "All your saved setups are for products that are no longer available (see Removed products below)." : "No setup matches your search or filters."}</p>
                        {hasActiveFilters(filter) ? <button type="button" onClick={clearFilters} className="mt-3 h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900">Clear filters</button> : null}
                      </div>
                    ) : (
                      <>
                        {recent.length > 0 ? (
                          <section aria-label="Recently used">
                            <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">Recently used</h3>
                            <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                              {recent.map((item) => <SetupPickCard key={`recent-${item.id}`} item={item} disabled={pending} onPick={choose} showProduct onMessage={setNotice} callbacks={setupCallbacks} />)}
                            </ul>
                          </section>
                        ) : null}
                        {grouped.map((group) => (
                          <section key={group.brandName} aria-label={group.brandName}>
                            <h3 className="border-b border-zinc-200 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
                              {group.brandName} <span className="font-semibold text-zinc-500">· {setupCountLabel(group.count)}</span>
                            </h3>
                            <div className="mt-3 space-y-4">
                              {group.products.map((entry) => {
                                const key = `${group.brandName}||${entry.productName}`;
                                const limit = shown[key] ?? CONFIGURED_PAGE_SIZE;
                                const { visible, remaining } = showMoreSlice(entry.setups, limit);
                                return (
                                  <div key={entry.productName}>
                                    <p className="mb-2 text-sm font-semibold text-zinc-800">{entry.productName}</p>
                                    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                      {visible.map((item) => <SetupPickCard key={item.id} item={item} disabled={pending} onPick={choose} showProduct={false} onMessage={setNotice} callbacks={setupCallbacks} />)}
                                    </ul>
                                    {remaining > 0 ? (
                                      <button type="button" onClick={() => setShown((current) => ({ ...current, [key]: limit + CONFIGURED_PAGE_SIZE }))} className="mt-3 h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900">
                                        Show more ({remaining} more)
                                      </button>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </>
                    )}
                    <RemovedProducts items={removed} onMessage={setNotice} onCleared={() => setRemoved([])} callbacks={removedCallbacks} />
                  </div>
                </>
              )}
            </div>
            </>) : null}
          </div>
          </EscapeLayerProvider>
        </div>
      ) : null}
    </>
  );
}
