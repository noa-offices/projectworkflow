"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { SetupThumbnail } from "@/components/products/my-collection-list";
import { listPickerSetups, loadSetupForReplay, markSetupUsed } from "@/lib/products/saved-setups/actions";
import type { PickerSetup, SetupForUse } from "@/lib/products/saved-setups/saved-setups-service";

/**
 * "Add from My Collection": a picker of the user's own USABLE setups (Brand > Product > setups).
 * Choosing one hands the saved recipe to the Product Library selector, which opens the normal configurator
 * pre-filled. Nothing is added to the quotation here, and no price is read or shown.
 * `onChoose` returns an error message to keep the picker open with a notice, or null when it took over.
 */
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

  function openPicker() {
    setOpen(true);
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

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const visible = (setups ?? []).filter(
      (item) => !needle || [item.setupName, item.productName, item.brandName].some((value) => value.toLowerCase().includes(needle)),
    );
    const brands = new Map<string, Map<string, PickerSetup[]>>();
    for (const item of visible) {
      const products = brands.get(item.brandName) ?? new Map<string, PickerSetup[]>();
      products.set(item.productName, [...(products.get(item.productName) ?? []), item]);
      brands.set(item.brandName, products);
    }
    return Array.from(brands, ([brandName, products]) => ({ brandName, products: Array.from(products, ([productName, items]) => ({ productName, items })) }));
  }, [setups, search]);

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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/30 p-2 sm:p-6">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border border-zinc-300 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-950">My Collection</h2>
                <p className="text-xs text-zinc-500">Pick a saved setup. Prices are recalculated from the current price lists.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700">Close</button>
            </div>
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, product or brand"
                aria-label="Search My Collection"
                className="h-9 min-w-0 flex-1 border border-zinc-300 px-2 text-sm outline-none focus:border-emerald-800"
              />
              <Link href="/products/my-collection" className="shrink-0 text-xs font-semibold text-emerald-900 underline">
                Manage My Collection
              </Link>
            </div>
            {notice ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">{notice}</p> : null}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {setups === null || (pending && setups.length === 0) ? (
                <p className="text-sm text-zinc-500">Loading...</p>
              ) : grouped.length === 0 ? (
                <p className="text-sm text-zinc-500">{setups.length === 0 ? "No saved setups yet." : "No setup matches your search."}</p>
              ) : (
                grouped.map((brand) => (
                  <section key={brand.brandName}>
                    <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-900">{brand.brandName}</h3>
                    {brand.products.map((product) => (
                      <div key={product.productName} className="mb-2 border border-zinc-200">
                        <p className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-700">{product.productName}</p>
                        <ul>
                          {product.items.map((item) => (
                            <li key={item.id} className="border-t border-zinc-100 first:border-t-0">
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() => choose(item.id)}
                                className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-emerald-50 disabled:opacity-60"
                              >
                                <SetupThumbnail path={item.imagePath} alt={item.setupName} />
                                <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-900">{item.setupName}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
