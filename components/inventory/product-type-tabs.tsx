"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatInventoryNumber, inventoryProductsHref } from "@/lib/inventory/presentation";
import type { ProductUrlState } from "@/lib/inventory/presentation";
import { ITEM_TYPES } from "@/lib/inventory/types";
import type { ItemType, ProductTypeCounts } from "@/lib/inventory/types";

const labels: Record<ItemType, string> = { product: "Products", accessory: "Accessories", temporary: "Temporary" };

export function ProductTypeTabs({ state, counts, baseHref = "/inventory/products" }: { state: ProductUrlState; counts: ProductTypeCounts; baseHref?: string }) {
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current, selected = nav?.querySelector('[aria-current="page"]');
    if (!nav || !selected) return;
    const viewport = nav.getBoundingClientRect(), tab = selected.getBoundingClientRect();
    if (tab.right > viewport.right) nav.scrollLeft += tab.right - viewport.right + 4;
    else if (tab.left < viewport.left) nav.scrollLeft -= viewport.left - tab.left + 4;
  }, [state.itemType]);
  return <nav ref={navRef} aria-label="Item types" className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
    <div className="flex w-max min-w-full gap-1">
      {(["all", ...ITEM_TYPES] as const).map(type => {
        const selected = type === "all" ? !state.itemType : state.itemType === type;
        return <Link key={type} href={inventoryProductsHref(state, { itemType: type === "all" ? "" : type, page: 1 }, baseHref)} aria-current={selected ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold ${selected ? "bg-emerald-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}>
          {type === "all" ? "All" : labels[type]}<span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${selected ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-600"}`}>{formatInventoryNumber(counts[type])}</span>
        </Link>;
      })}
    </div>
  </nav>;
}
