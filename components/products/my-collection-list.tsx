"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  markQuotationImagePathFailed,
  normalizeProductImageSnapshotPath,
  resolveQuotationImageUrl,
} from "@/lib/quotation-image-path";
import { clearRemovedSetups, deleteSetup, renameSetup } from "@/lib/products/saved-setups/actions";
import type { SetupListItem } from "@/lib/products/saved-setups/saved-setups-service";

type ProductGroup = { productName: string; setups: SetupListItem[] };
type BrandGroup = { brandName: string; products: ProductGroup[] };

function groupSetups(items: SetupListItem[]): BrandGroup[] {
  const brands = new Map<string, Map<string, SetupListItem[]>>();
  for (const item of items) {
    const products = brands.get(item.brandName) ?? new Map<string, SetupListItem[]>();
    products.set(item.productName, [...(products.get(item.productName) ?? []), item]);
    brands.set(item.brandName, products);
  }
  return Array.from(brands, ([brandName, products]) => ({
    brandName,
    products: Array.from(products, ([productName, setups]) => ({ productName, setups })),
  }));
}

// Small fixed-size picture. The stored path is resolved to a URL by the existing image helper (signed in the
// browser under the user's own session); no picture file is ever copied. No path or failure => placeholder.
function SetupThumbnail({ path, alt }: { path: string | null; alt: string }) {
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
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-200 bg-zinc-50 text-[9px] text-zinc-400">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          loading="lazy"
          width={48}
          height={48}
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

function SetupRow({ item, onMessage }: { item: SetupListItem; onMessage: (message: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.setupName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function submitRename() {
    startTransition(async () => {
      const result = await renameSetup(item.id, name);
      if (result.ok) setEditing(false);
      else onMessage(result.error);
    });
  }

  function submitDelete() {
    startTransition(async () => {
      const result = await deleteSetup(item.id);
      if (!result.ok) onMessage(result.error);
      setConfirmingDelete(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-3 py-2 first:border-t-0">
      {editing ? (
        <>
          <input
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            aria-label="Setup name"
            className="h-8 min-w-48 flex-1 rounded-md border border-zinc-300 px-2 text-sm outline-none focus:border-emerald-800"
          />
          <button type="button" disabled={pending} onClick={submitRename} className="h-8 rounded-md bg-emerald-900 px-3 text-xs font-semibold text-white disabled:bg-zinc-300">Save</button>
          <button type="button" disabled={pending} onClick={() => { setEditing(false); setName(item.setupName); }} className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700">Cancel</button>
        </>
      ) : (
        <>
          <SetupThumbnail path={item.imagePath} alt={item.setupName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-zinc-900">{item.setupName}</p>
            {item.note ? <p className="truncate text-xs text-zinc-500">{item.note}</p> : null}
          </div>
          {!item.usable ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Unavailable</span> : null}
          <button type="button" disabled={pending} onClick={() => setEditing(true)} className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700">Rename</button>
          {confirmingDelete ? (
            <>
              <button type="button" disabled={pending} onClick={submitDelete} className="h-8 rounded-md bg-red-700 px-3 text-xs font-semibold text-white disabled:bg-zinc-300">Confirm delete</button>
              <button type="button" disabled={pending} onClick={() => setConfirmingDelete(false)} className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700">Keep</button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirmingDelete(true)} className="h-8 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700">Delete</button>
          )}
        </>
      )}
    </li>
  );
}

export function MyCollectionList({ items }: { items: SetupListItem[] }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const available = useMemo(() => groupSetups(items.filter((item) => item.usable)), [items]);
  const removed = useMemo(() => groupSetups(items.filter((item) => !item.usable)), [items]);
  const removedCount = items.filter((item) => !item.usable).length;

  function clearRemoved() {
    startTransition(async () => {
      const result = await clearRemovedSetups();
      if (!result.ok) setMessage(result.error);
      setConfirmingClear(false);
    });
  }

  return (
    <div className="space-y-6">
      {message ? <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{message}</p> : null}

      {available.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-500">
          No saved setups yet. In the Product Library, configure a product and choose &quot;Save to My Collection&quot;.
        </p>
      ) : (
        available.map((brand) => (
          <section key={brand.brandName}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-emerald-900">{brand.brandName}</h2>
            <div className="space-y-3">
              {brand.products.map((product) => (
                <div key={product.productName} className="rounded-lg border border-zinc-200 bg-white">
                  <h3 className="border-b border-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-800">{product.productName}</h3>
                  <ul>{product.setups.map((item) => <SetupRow key={item.id} item={item} onMessage={setMessage} />)}</ul>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {removedCount > 0 ? (
        <details className="rounded-lg border border-zinc-200 bg-zinc-50">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-700">Removed products ({removedCount})</summary>
          <div className="space-y-3 px-3 pb-3">
            <p className="text-xs text-zinc-600">These products are no longer available. You can clear them from here.</p>
            {confirmingClear ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-700">Delete {removedCount} removed setup{removedCount === 1 ? "" : "s"}?</span>
                <button type="button" disabled={pending} onClick={clearRemoved} className="h-8 rounded-md bg-red-700 px-3 text-xs font-semibold text-white disabled:bg-zinc-300">Yes, clear</button>
                <button type="button" disabled={pending} onClick={() => setConfirmingClear(false)} className="h-8 rounded-md border border-zinc-300 px-3 text-xs font-semibold text-zinc-700">Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmingClear(true)} className="h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700">Clear removed</button>
            )}
            {removed.map((brand) => (
              <div key={brand.brandName}>
                <p className="text-xs font-bold uppercase text-zinc-500">{brand.brandName}</p>
                {brand.products.map((product) => (
                  <div key={product.productName} className="mt-1 rounded-md border border-zinc-200 bg-white">
                    <p className="border-b border-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700">{product.productName}</p>
                    <ul>{product.setups.map((item) => <SetupRow key={item.id} item={item} onMessage={setMessage} />)}</ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
