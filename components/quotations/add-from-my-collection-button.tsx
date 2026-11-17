"use client";

import Link from "next/link";
import { useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CustomItemPickerPane, CustomItemTargetContext } from "@/components/quotations/custom-item-picker-pane";
import { SetupThumbnail } from "@/components/products/my-collection-list";
import { listPickerSetups, loadSetupForReplay, markSetupUsed } from "@/lib/products/saved-setups/actions";
import { filterSetups, groupByBrandProduct, recentlyUsed, setupCountLabel, sortSetups } from "@/lib/products/saved-setups/collection-view";
import type { PickerSetup, SetupForUse } from "@/lib/products/saved-setups/saved-setups-service";

/**
 * "Add from My Collection": a picker of the user's own USABLE setups (Recently used, then Brand > Product > setups).
 * Choosing one hands the saved recipe to the Product Library selector, which opens the normal configurator
 * pre-filled. Nothing is added to the quotation here, and no price is read or shown.
 * `onChoose` returns an error message to keep the picker open with a notice, or null when it took over.
 */
function SetupPickCard({ disabled, item, onPick, showProduct }: { disabled: boolean; item: PickerSetup; onPick: (id: string) => void; showProduct: boolean }) {
  return (
    <li>
      {/* The whole card is the click target. Enter / Space select it, and it has hover and keyboard focus states. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(item.id)}
        className="flex h-full w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-sm transition hover:border-emerald-700 hover:bg-emerald-50 focus-visible:border-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:opacity-60"
      >
        <SetupThumbnail path={item.imagePath} alt={item.setupName} size={88} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-bold leading-snug text-zinc-900">{item.setupName}</span>
          {showProduct ? <span className="mt-1 block truncate text-xs text-zinc-500">{item.productName}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function AddFromMyCollectionButton({
  onChoose,
}: {
  onChoose: (setup: SetupForUse) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [setups, setSetups] = useState<PickerSetup[] | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const customTarget = useContext(CustomItemTargetContext);
  const [tab, setTab] = useState<"configured" | "custom">("configured");
  const showConfigured = tab === "configured" || !customTarget;
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function openPicker() {
    setOpen(true);
    setTab("configured");
    setNotice("");
    setSearch("");
    startTransition(async () => {
      try {
        setSetups(await listPickerSetups());
      } catch {
        setSetups([]);
        setNotice("Your collection could not be loaded.");
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

  const searching = search.trim().length > 0;
  const recent = useMemo(() => (searching ? [] : recentlyUsed(setups ?? [], 4)), [setups, searching]);
  const grouped = useMemo(() => groupByBrandProduct(sortSetups(filterSetups(setups ?? [], search), "recent")), [setups, search]);

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
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/30 p-4 sm:p-6"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="My Collection" className="flex max-h-[90vh] w-full max-w-[880px] flex-col overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-xl">
            <div className="sticky top-0 z-10 space-y-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">My Collection</h2>
                  <p className="text-xs text-zinc-500">Pick a saved setup. Prices are recalculated from the current price lists.</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">Close</button>
              </div>
              {customTarget ? (
                <div role="tablist" aria-label="My Collection" className="flex gap-2 border-b border-zinc-200">
                  {([["configured", "Configured products"], ["custom", "Custom items"]] as const).map(([value, label]) => (
                    <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`h-9 border-b-2 px-3 text-sm font-semibold transition ${tab === value ? "border-emerald-900 text-emerald-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`}>{label}</button>
                  ))}
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
                <Link href="/products/my-collection" className="shrink-0 text-xs font-semibold text-emerald-900 underline">
                  Manage My Collection
                </Link>
              </div>
              ) : null}
            </div>
            {!showConfigured && customTarget ? <CustomItemPickerPane target={customTarget} onClose={() => setOpen(false)} /> : null}
            {showConfigured ? (<>
            {notice ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-5">{notice}</p> : null}
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-5">
              {setups === null || (pending && setups.length === 0) ? (
                <p className="text-sm text-zinc-500">Loading...</p>
              ) : grouped.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                  {setups.length === 0 ? "No saved setups yet. Save a configured product from the Product Library and it appears here." : "No setup matches your search."}
                </p>
              ) : (
                <>
                  {recent.length > 0 ? (
                    <section aria-label="Recently used">
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">Recently used</h3>
                      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {recent.map((item) => <SetupPickCard key={`recent-${item.id}`} item={item} disabled={pending} onPick={choose} showProduct />)}
                      </ul>
                    </section>
                  ) : null}
                  {grouped.map((brand) => (
                    <section key={brand.brandName} aria-label={brand.brandName}>
                      <h3 className="border-b border-zinc-200 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
                        {brand.brandName} <span className="font-semibold text-zinc-500">· {setupCountLabel(brand.count)}</span>
                      </h3>
                      <div className="mt-3 space-y-4">
                        {brand.products.map((product) => (
                          <div key={product.productName}>
                            <p className="mb-2 text-sm font-semibold text-zinc-800">{product.productName}</p>
                            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {product.setups.map((item) => <SetupPickCard key={item.id} item={item} disabled={pending} onPick={choose} showProduct={false} />)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </>
              )}
            </div>
            </>) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
