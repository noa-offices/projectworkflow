"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  markQuotationImagePathFailed,
  normalizeProductImageSnapshotPath,
  resolveQuotationImageUrl,
} from "@/lib/quotation-image-path";
import { useEscapeLayer } from "@/components/products/escape-layer";
import { ShareControl } from "@/components/products/my-collection-share-send";
import { clearRemovedSetups, deleteSetup, renameSetup } from "@/lib/products/saved-setups/actions";
import {
  COLLECTION_SORT_OPTIONS,
  filterSetups,
  groupByBrandProduct,
  savedLine,
  setupCountLabel,
  sortSetups,
  type BrandGroup,
  type CollectionSortMode,
  type CountEntry,
} from "@/lib/products/saved-setups/collection-view";
import type { SetupListItem } from "@/lib/products/saved-setups/saved-setups-service";

// Picture. The stored path is resolved to a URL by the existing image helper (signed in the browser under the
// user's own session); no picture file is ever copied. No path or failure => neutral placeholder.
export function SetupThumbnail({ path, alt, size = 48 }: { path: string | null; alt: string; size?: number }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      window.queueMicrotask(() => {
        if (!cancelled) setUrl("");
      });
      return;
    }
    void resolveQuotationImageUrl(normalizeProductImageSnapshotPath(path) ?? path)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved);
      })
      .catch(() => {
        if (!cancelled) setUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          loading="lazy"
          width={size}
          height={size}
          onError={() => {
            if (path) markQuotationImagePathFailed(normalizeProductImageSnapshotPath(path) ?? path);
            setUrl("");
          }}
          className="block h-full w-full object-contain"
        />
      ) : (
        <span aria-hidden="true">No image</span>
      )}
    </div>
  );
}

const secondaryButton =
  "h-8 rounded-md border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition hover:border-emerald-800 hover:text-emerald-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800 disabled:opacity-60";
const dangerButton =
  "h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 disabled:opacity-60";

export type SetupCallbacks = {
  onRenamed?: (id: string, name: string) => void;
  onDeleted?: (id: string) => void;
};

// Rename (inline) and two-step delete for ONE setup. Shared by the My Collection page card and by the cards of the
// "Add from My Collection" popup. It uses the existing renameSetup / deleteSetup actions only. The callbacks let the
// popup update its own list at once; on the page the actions revalidate the route as before.
export function useSetupActions(item: { id: string; setupName: string }, onMessage: (message: string) => void, callbacks: SetupCallbacks = {}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.setupName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function cancelRename() {
    setEditing(false);
    setName(item.setupName);
  }

  function submitRename() {
    startTransition(async () => {
      const result = await renameSetup(item.id, name);
      if (result.ok) {
        setEditing(false);
        callbacks.onRenamed?.(item.id, name.trim());
      } else onMessage(result.error);
    });
  }

  function submitDelete() {
    startTransition(async () => {
      const result = await deleteSetup(item.id);
      if (!result.ok) onMessage(result.error);
      else callbacks.onDeleted?.(item.id);
      setConfirmingDelete(false);
    });
  }

  // Inside the popup, Escape closes an open rename or delete confirm first (not the whole popup).
  useEscapeLayer(editing, cancelRename);
  useEscapeLayer(confirmingDelete, () => setConfirmingDelete(false));

  return { pending, editing, setEditing, name, setName, confirmingDelete, setConfirmingDelete, cancelRename, submitRename, submitDelete };
}
export type SetupActions = ReturnType<typeof useSetupActions>;

export function SetupRenameInput({ actions }: { actions: SetupActions }) {
  return (
    <input
      value={actions.name}
      maxLength={120}
      autoFocus
      onChange={(event) => actions.setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") actions.submitRename();
        if (event.key === "Escape") { event.stopPropagation(); actions.cancelRename(); }
      }}
      aria-label="Setup name"
      className="h-9 w-full rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
    />
  );
}

// The buttons under a setup card. Separate buttons (never inside the card's own click target); each stops the click
// from reaching anything behind it, so renaming or deleting can never add the setup to a quote.
// extra: optional buttons shown after Rename / Delete (the page adds Share; the popup passes nothing).
export function SetupActionRow({ item, actions, extra }: { item: { setupName: string }; actions: SetupActions; extra?: ReactNode }) {
  const { pending, editing, confirmingDelete } = actions;
  const stop = (run: () => void) => (event: { stopPropagation: () => void }) => { event.stopPropagation(); run(); };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
      {editing ? (
        <>
          <button type="button" disabled={pending} onClick={stop(actions.submitRename)} className="h-8 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:bg-zinc-300">Save</button>
          <button type="button" disabled={pending} onClick={stop(actions.cancelRename)} className={secondaryButton}>Cancel</button>
        </>
      ) : confirmingDelete ? (
        <>
          <button type="button" disabled={pending} onClick={stop(actions.submitDelete)} className="h-8 rounded-md bg-red-700 px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:bg-zinc-300">Confirm delete</button>
          <button type="button" disabled={pending} onClick={stop(() => actions.setConfirmingDelete(false))} className={secondaryButton}>Keep</button>
        </>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={stop(() => actions.setEditing(true))} aria-label={`Rename ${item.setupName}`} className={secondaryButton}>Rename</button>
          <button type="button" disabled={pending} onClick={stop(() => actions.setConfirmingDelete(true))} aria-label={`Delete ${item.setupName}`} className={dangerButton}>Delete</button>
          {extra}
        </>
      )}
    </div>
  );
}

function SetupCard({ item, onMessage, callbacks }: { item: SetupListItem; onMessage: (message: string) => void; callbacks?: SetupCallbacks }) {
  const actions = useSetupActions(item, onMessage, callbacks);

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 gap-3">
        <SetupThumbnail path={item.imagePath} alt={item.setupName} size={104} />
        <div className="min-w-0 flex-1">
          {actions.editing ? <SetupRenameInput actions={actions} /> : (
            <p className="break-words text-base font-bold leading-snug text-zinc-900">{item.setupName}</p>
          )}
          <p className="mt-1 truncate text-xs text-zinc-500">{item.productName}</p>
          <p className="mt-1 text-xs text-zinc-500">{savedLine(item)}</p>
          {item.note ? <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.note}</p> : null}
          {!item.usable ? <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Unavailable</span> : null}
        </div>
      </div>
      <SetupActionRow item={item} actions={actions} extra={item.usable ? <ShareControl kind="setup" itemId={item.id} itemName={item.setupName} /> : null} />
    </li>
  );
}

function BrandSections({ groups, onMessage, callbacks }: { groups: BrandGroup<SetupListItem>[]; onMessage: (message: string) => void; callbacks?: SetupCallbacks }) {
  return (
    <div className="space-y-8">
      {groups.map((brand) => (
        <section key={brand.brandName} aria-label={brand.brandName}>
          <h2 className="border-b border-zinc-200 pb-2 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
            {brand.brandName} <span className="font-semibold text-zinc-500">· {setupCountLabel(brand.count)}</span>
          </h2>
          <div className="mt-4 space-y-6">
            {brand.products.map((product) => (
              <div key={product.productName}>
                <h3 className="mb-2 text-sm font-semibold text-zinc-800">{product.productName}</h3>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {product.setups.map((item) => <SetupCard key={item.id} item={item} onMessage={onMessage} callbacks={callbacks} />)}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// "Removed products": setups whose product no longer exists. Shared by the page and the popup. clearRemovedSetups is the
// existing action; onCleared / callbacks let the popup update its list at once.
export function RemovedProducts({ items, onMessage, onCleared, callbacks }: { items: SetupListItem[]; onMessage: (message: string) => void; onCleared?: () => void; callbacks?: SetupCallbacks }) {
  const [pending, startTransition] = useTransition();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const removed = useMemo(() => groupByBrandProduct(sortSetups(items, "name")), [items]);
  useEscapeLayer(confirmingClear, () => setConfirmingClear(false));

  function clearRemoved() {
    startTransition(async () => {
      const result = await clearRemovedSetups();
      if (!result.ok) onMessage(result.error);
      else onCleared?.();
      setConfirmingClear(false);
    });
  }

  if (items.length === 0) return null;
  return (
    <details className="rounded-lg border border-zinc-200 bg-zinc-50">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-700">Removed products ({items.length})</summary>
      <div className="space-y-4 px-4 pb-4">
        <p className="text-xs text-zinc-600">These products are no longer available. You can clear them from here.</p>
        {confirmingClear ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-700">Delete {items.length} removed setup{items.length === 1 ? "" : "s"}?</span>
            <button type="button" disabled={pending} onClick={clearRemoved} className="h-8 rounded-md bg-red-700 px-3 text-xs font-semibold text-white transition hover:bg-red-800 disabled:bg-zinc-300">Yes, clear</button>
            <button type="button" disabled={pending} onClick={() => setConfirmingClear(false)} className={secondaryButton}>Cancel</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingClear(true)} className={dangerButton}>Clear removed</button>
        )}
        <BrandSections groups={removed} onMessage={onMessage} callbacks={callbacks} />
      </div>
    </details>
  );
}

// Left column of the popup Configured tab: "All brands" with the setup count of each brand; picking a brand shows a
// second list under it with that brand's products and counts ("All products" first). Stacks above the list on phones.
export function ConfiguredFilterColumn({ brands, products, selectedBrand, selectedProduct, total, onSelectBrand, onSelectProduct }: {
  brands: CountEntry[];
  products: CountEntry[];
  selectedBrand: string | null;
  selectedProduct: string | null;
  total: number;
  onSelectBrand: (brand: string | null) => void;
  onSelectProduct: (product: string | null) => void;
}) {
  const row = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm transition ${active ? "bg-emerald-900 font-semibold text-white" : "text-zinc-800 hover:bg-zinc-100"}`;
  const subRow = (active: boolean) =>
    `flex w-full items-center justify-between gap-2 rounded-md px-3 py-1 text-left text-xs transition ${active ? "bg-emerald-100 font-semibold text-emerald-900" : "text-zinc-700 hover:bg-zinc-100"}`;
  return (
    <nav aria-label="Brands" className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 md:max-h-full">
      <button type="button" aria-pressed={selectedBrand === null} onClick={() => onSelectBrand(null)} className={row(selectedBrand === null)}>
        <span>All brands</span>
        <span className="text-xs opacity-80">{total}</span>
      </button>
      {brands.map((brand) => (
        <div key={brand.name}>
          <button type="button" aria-pressed={selectedBrand === brand.name} onClick={() => onSelectBrand(brand.name)} className={row(selectedBrand === brand.name)}>
            <span className="truncate">{brand.name}</span>
            <span className="shrink-0 text-xs opacity-80">{brand.count}</span>
          </button>
          {selectedBrand === brand.name && products.length > 0 ? (
            <div aria-label={`${brand.name} products`} className="mb-1 ml-3 mt-1 space-y-0.5 border-l border-zinc-200 pl-2">
              <button type="button" aria-pressed={selectedProduct === null} onClick={() => onSelectProduct(null)} className={subRow(selectedProduct === null)}>
                <span>All products</span>
                <span className="opacity-80">{brand.count}</span>
              </button>
              {products.map((product) => (
                <button key={product.name} type="button" aria-pressed={selectedProduct === product.name} onClick={() => onSelectProduct(product.name)} className={subRow(selectedProduct === product.name)}>
                  <span className="truncate">{product.name}</span>
                  <span className="shrink-0 opacity-80">{product.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

export function MyCollectionList({ items }: { items: SetupListItem[] }) {
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CollectionSortMode>("recent");

  const usable = useMemo(() => items.filter((item) => item.usable), [items]);
  const removedItems = useMemo(() => items.filter((item) => !item.usable), [items]);
  const available = useMemo(() => groupByBrandProduct(sortSetups(filterSetups(usable, search), sort)), [usable, search, sort]);

  return (
    <div className="space-y-6">
      {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}

      {usable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, product or brand"
            aria-label="Search My Collection"
            className="h-10 min-w-0 flex-1 basis-56 rounded-md border border-zinc-200 px-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10"
          />
          <label className="flex items-center gap-2 text-xs font-semibold uppercase text-zinc-500">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as CollectionSortMode)}
              className="h-10 rounded-md border border-zinc-200 bg-white px-2 text-sm font-normal normal-case text-zinc-800 outline-none focus:border-emerald-800"
            >
              {COLLECTION_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {usable.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          Save a configured product from the Product Library and it appears here.
        </p>
      ) : available.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-500">
          No setup matches your search.
        </p>
      ) : (
        <BrandSections groups={available} onMessage={setMessage} />
      )}

      <RemovedProducts items={removedItems} onMessage={setMessage} />
    </div>
  );
}
