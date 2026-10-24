"use client";

import Link from "next/link";
import { formatInventoryNumber, inventoryProductsHref } from "@/lib/inventory/presentation";
import type { ProductUrlState } from "@/lib/inventory/presentation";
import { ITEM_TYPES } from "@/lib/inventory/types";
import type { ItemType, ProductTypeCounts } from "@/lib/inventory/types";
import { focusRing } from "./inventory-ui";
import { ScrollTabs } from "./inventory-ui-client";

const labels: Record<ItemType, string> = { product: "Products", accessory: "Accessories", temporary: "Temporary" };

export function ProductTypeTabs({ state, counts, baseHref = "/inventory/products" }: { state: ProductUrlState; counts: ProductTypeCounts; baseHref?: string }) {
  return <ScrollTabs label="Item types" currentKey={state.itemType} className="rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
    <div className="flex w-max min-w-full gap-1">
      {(["all", ...ITEM_TYPES] as const).map(type => {
        const selected = type === "all" ? !state.itemType : state.itemType === type;
        return <Link key={type} href={inventoryProductsHref(state, { itemType: type === "all" ? "" : type, page: 1 }, baseHref)} aria-current={selected ? "page" : undefined} className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-semibold ${focusRing} ${selected ? "bg-emerald-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`}>
          {type === "all" ? "All" : labels[type]}<span className={`rounded-full px-1.5 text-sm tabular-nums ${selected ? "bg-white/15 text-white" : "bg-zinc-100 text-zinc-700"}`}>{formatInventoryNumber(counts[type])}</span>
        </Link>;
      })}
    </div>
  </ScrollTabs>;
}
