"use client";

import { createContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addCustomItemToQuotation } from "@/app/quotations/actions";
import { listCustomItems, markCustomItemUsed } from "@/lib/products/saved-setups/saved-custom-items-actions";
import { BrandFilterList } from "@/components/products/brand-combobox";
import { CustomItemActionRow, CustomItemForm, CustomItemThumb, RenameBrand } from "@/components/products/my-collection-custom-items";
import type { CustomItemWithImage } from "@/lib/products/saved-setups/custom-item-image";
import { COLLECTION_SORT_OPTIONS, filterSetups, groupByBrand, itemCountLabel, recentlyUsed, sortSetups, type CollectionSortMode } from "@/lib/products/saved-setups/collection-view";
import { CUSTOM_BRAND_PAGE_SIZE, CUSTOM_BRAND_RECENT_LIMIT, distinctBrands, filterByBrand, normaliseBrandKey } from "@/lib/products/saved-setups/custom-brands";
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
function CustomPickCard({ disabled, entry, onPick, onEdit, onDeleted, onMessage }: { disabled: boolean; entry: CustomCollectionItem; onPick: (item: CustomItemListItem) => void; onEdit: (item: CustomItemWithImage) => void; onDeleted: (id: string) => void; onMessage: (message: string) => void }) {
  const { item } = entry;
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition hover:border-emerald-700">
      {/* The card body adds the item to the quote. Edit / Delete below are separate buttons that never trigger the add. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPick(item)}
        className="flex h-full w-full items-center gap-3 rounded-md text-left transition hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:cursor-wait disabled:opacity-60"
      >
        <CustomItemThumb imagePath={(item as CustomItemWithImage).imagePath} size={88} name={item.itemName} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-bold leading-snug text-zinc-900">{item.itemName}</span>
          {item.itemCode ? <span className="mt-1 block truncate text-xs text-zinc-500">{item.itemCode}</span> : null}
          <span className="mt-1 block text-xs font-semibold text-zinc-800">{customItemPriceLine(item)}</span>
          <span className="mt-1 block text-xs text-zinc-500">Unit: {item.unitLabel}</span>
        </span>
      </button>
      <CustomItemActionRow item={item} onEdit={() => onEdit(item as CustomItemWithImage)} onDeleted={onDeleted} onMessage={onMessage} />
    </li>
  );
}

export function CustomItemPickerPane({ target, onClose }: { target: CustomItemTarget; onClose: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<CustomItemWithImage[] | null>(null);
  // The add / edit form opens as an inline side panel INSIDE the popup (never a second modal).
  const [panel, setPanel] = useState<{ mode: "add" } | { mode: "edit"; item: CustomItemWithImage } | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CollectionSortMode>("recent");
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
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

  // After any change (add, edit, delete, rename brand) the list is read again, so the popup updates without closing.
  function reload() {
    listCustomItems()
      .then((list) => setItems(list))
      .catch(() => setNotice("Your custom items could not be refreshed."));
  }

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
  const brands = useMemo(() => distinctBrands(items ?? []), [items]);
  const activeBrand = brandFilter && brands.some((brand) => normaliseBrandKey(brand.brandName) === normaliseBrandKey(brandFilter)) ? brandFilter : null;
  const searching = search.trim().length > 0;
  // "Recently used" (up to 6) only when there is no search and All brands is selected.
  const recent = useMemo(
    () => (searching || activeBrand ? [] : recentlyUsed(entries, CUSTOM_BRAND_RECENT_LIMIT)),
    [entries, searching, activeBrand],
  );
  const grouped = useMemo(
    () => groupByBrand(sortSetups(filterSetups(filterByBrand(entries, activeBrand), search), sort)),
    [entries, activeBrand, search, sort],
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 sm:px-5">
        <input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, code or brand"
          aria-label="Search custom items"
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
        {search.trim() || activeBrand ? (
          <button type="button" onClick={() => { setSearch(""); setBrandFilter(null); }} className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900">Clear filters</button>
        ) : null}
        <button type="button" onClick={() => setPanel({ mode: "add" })} className="ml-auto h-10 rounded-md bg-emerald-900 px-4 text-xs font-semibold text-white transition hover:bg-emerald-800">+ Add custom item</button>
      </div>
      {notice ? <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-5">{notice}</p> : null}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 ${panel ? "hidden lg:block" : ""}`}>
        {items === null ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
            No custom items yet. Use &quot;+ Add custom item&quot; to add an item that is not in the Product Library, with your own price.
          </p>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="md:w-48 md:shrink-0">
              <BrandFilterList brands={brands} total={items.length} selected={activeBrand} onSelect={setBrandFilter} />
            </div>
            <div className="min-w-0 flex-1 space-y-6">
              {grouped.length === 0 ? (
                <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">No item matches your search.</p>
              ) : (
                <>
                  {recent.length > 0 ? (
                    <section aria-label="Recently used">
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">Recently used</h3>
                      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {recent.map((entry) => <CustomPickCard key={`recent-${entry.id}`} entry={entry} disabled={pending} onPick={pick} onEdit={(item) => setPanel({ mode: "edit", item })} onDeleted={reload} onMessage={setNotice} />)}
                      </ul>
                    </section>
                  ) : null}
                  {grouped.map((brand) => {
                    const limit = shown[normaliseBrandKey(brand.brandName)] ?? CUSTOM_BRAND_PAGE_SIZE;
                    const visible = brand.items.slice(0, limit);
                    return (
                      <section key={brand.brandName} aria-label={brand.brandName}>
                        <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
                          <span>{brand.brandName} <span className="font-semibold text-zinc-500">· {itemCountLabel(brand.count)}</span></span>
                          <RenameBrand
                            brand={brand.brandName}
                            onMessage={setNotice}
                            onDone={(newName, count) => {
                              setBrandFilter(activeBrand ? newName : null);
                              setNotice(`${count} ${count === 1 ? "item" : "items"} updated to brand "${newName}".`);
                              reload();
                            }}
                          />
                        </h3>
                        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {visible.map((entry) => <CustomPickCard key={entry.id} entry={entry} disabled={pending} onPick={pick} onEdit={(item) => setPanel({ mode: "edit", item })} onDeleted={reload} onMessage={setNotice} />)}
                        </ul>
                        {brand.items.length > visible.length ? (
                          <button
                            type="button"
                            onClick={() => setShown((current) => ({ ...current, [normaliseBrandKey(brand.brandName)]: limit + CUSTOM_BRAND_PAGE_SIZE }))}
                            className="mt-3 h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900"
                          >
                            Show more ({brand.items.length - visible.length} more)
                          </button>
                        ) : null}
                      </section>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {panel ? (
        <aside aria-label={panel.mode === "add" ? "Add custom item" : "Edit custom item"} className="min-h-0 overflow-y-auto border-t border-zinc-200 bg-zinc-50 px-4 py-4 sm:px-5 lg:w-[460px] lg:shrink-0 lg:border-l lg:border-t-0">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">{panel.mode === "add" ? "Add custom item" : "Edit custom item"}</h3>
          <CustomItemForm
            key={panel.mode === "edit" ? panel.item.id : "new"}
            item={panel.mode === "edit" ? panel.item : null}
            brands={brands}
            onDone={() => setPanel(null)}
            onSaved={() => { setPanel(null); reload(); }}
          />
        </aside>
      ) : null}
      </div>
    </>
  );
}
