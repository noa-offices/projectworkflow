"use client";

import { createContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addCustomItemToQuotation } from "@/app/quotations/actions";
import { listCustomItems, markCustomItemUsed } from "@/lib/products/saved-setups/saved-custom-items-actions";
import { filterSetups, groupByBrand, itemCountLabel, recentlyUsed, sortSetups } from "@/lib/products/saved-setups/collection-view";
import { customItemPriceLine, toCollectionItem, type CustomCollectionItem, type CustomItemListItem } from "@/lib/products/saved-setups/custom-item";

// Where a custom item picked in "Add from My Collection" goes. Provided by the quote builders around the Product
// Library selector, so the selector itself needs no change. No provider => the picker shows no Custom items tab.
//  - local:  the local builder adds an ordinary manual row to its workspace; returns a note (or null).
//  - server: the picker calls the addCustomItemToQuotation server action for this quotation and section.
export type CustomItemTarget =
  | { kind: "local"; onAdd: (item: CustomItemListItem) => string | null }
  | { kind: "server"; quotationId: string; sectionId: string | null };

export const CustomItemTargetContext = createContext<CustomItemTarget | null>(null);

export function CustomItemTargetProvider({ value, children }: { value: CustomItemTarget; children: ReactNode }) {
  return <CustomItemTargetContext.Provider value={value}>{children}</CustomItemTargetContext.Provider>;
}

// "Custom items" tab of the Add from My Collection picker. The saved price and its date are shown HERE ONLY.
// Choosing an item adds an ordinary manual row to the quote (local builder: via the builder callback;
// server builder: the addCustomItemToQuotation action). Nothing else about the quote changes.
function CustomPickCard({ disabled, entry, onPick }: { disabled: boolean; entry: CustomCollectionItem; onPick: (item: CustomItemListItem) => void }) {
  const { item } = entry;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(item)}
        className="flex h-full w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-sm transition hover:border-emerald-700 hover:bg-emerald-50 focus-visible:border-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden="true" style={{ width: 88, height: 88 }} className="flex shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400">No image</span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-bold leading-snug text-zinc-900">{item.itemName}</span>
          {item.itemCode ? <span className="mt-1 block truncate text-xs text-zinc-500">{item.itemCode}</span> : null}
          <span className="mt-1 block text-xs font-semibold text-zinc-800">{customItemPriceLine(item)}</span>
          <span className="mt-1 block text-xs text-zinc-500">Unit: {item.unitLabel}</span>
        </span>
      </button>
    </li>
  );
}

export function CustomItemPickerPane({ target, onClose }: { target: CustomItemTarget; onClose: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<CustomItemListItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    searchRef.current?.focus();
    listCustomItems()
      .then((list) => { if (!cancelled) setItems(list); })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setNotice("Your custom items could not be loaded.");
      });
    return () => { cancelled = true; };
  }, []);

  function pick(item: CustomItemListItem) {
    setNotice("");
    startTransition(async () => {
      try {
        if (target.kind === "local") {
          const note = target.onAdd(item);
          void markCustomItemUsed(item.id).catch(() => undefined); // best effort: never blocks the add
          // A foreign-currency item stays open with the conversion note; otherwise the picker closes.
          if (note) setNotice(`Added to the quote. ${note}`);
          else onClose();
          return;
        }
        const form = new FormData();
        form.set("quotation_id", target.quotationId);
        if (target.sectionId) form.set("section_id", target.sectionId);
        form.set("custom_item_id", item.id);
        const result = await addCustomItemToQuotation(form);
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        router.refresh();
        if (result.note) setNotice(`Added to the quote. ${result.note}`);
        else onClose();
      } catch {
        setNotice("This item could not be added.");
      }
    });
  }

  const entries = useMemo(() => (items ?? []).map(toCollectionItem), [items]);
  const searching = search.trim().length > 0;
  const recent = useMemo(() => (searching ? [] : recentlyUsed(entries, 4)), [entries, searching]);
  const grouped = useMemo(() => groupByBrand(sortSetups(filterSetups(entries, search), "recent")), [entries, search]);

  return (
    <>
      <div className="border-b border-zinc-200 px-4 py-3 sm:px-5">
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, code or brand"
          aria-label="Search custom items"
          className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
        />
      </div>
      {notice ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-5">{notice}</p> : null}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-5">
        {items === null ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : grouped.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
            {items.length === 0 ? "No custom items yet. Add an item that is not in the Product Library, with your own price." : "No item matches your search."}
          </p>
        ) : (
          <>
            {recent.length > 0 ? (
              <section aria-label="Recently used">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">Recently used</h3>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {recent.map((entry) => <CustomPickCard key={`recent-${entry.id}`} entry={entry} disabled={pending} onPick={pick} />)}
                </ul>
              </section>
            ) : null}
            {grouped.map((brand) => (
              <section key={brand.brandName} aria-label={brand.brandName}>
                <h3 className="border-b border-zinc-200 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
                  {brand.brandName} <span className="font-semibold text-zinc-500">· {itemCountLabel(brand.count)}</span>
                </h3>
                <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {brand.items.map((entry) => <CustomPickCard key={entry.id} entry={entry} disabled={pending} onPick={pick} />)}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}
