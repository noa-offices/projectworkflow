"use client";

import { useState } from "react";
import { MyCollectionCustomItems } from "@/components/products/my-collection-custom-items";
import { MyCollectionList } from "@/components/products/my-collection-list";
import type { CustomItemListItem } from "@/lib/products/saved-setups/custom-item";
import type { SetupListItem } from "@/lib/products/saved-setups/saved-setups-service";

type Tab = "configured" | "custom";

// Two separate tabs. The Configured tab is the existing list, untouched (search, sort, Removed products inside it).
export function MyCollectionTabs({ items, customItems }: { items: SetupListItem[]; customItems: CustomItemListItem[] }) {
  const [tab, setTab] = useState<Tab>("configured");
  const tabClass = (active: boolean) =>
    `h-10 border-b-2 px-4 text-sm font-semibold transition ${active ? "border-emerald-900 text-emerald-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`;

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="My Collection" className="flex gap-2 border-b border-zinc-200">
        <button type="button" role="tab" aria-selected={tab === "configured"} onClick={() => setTab("configured")} className={tabClass(tab === "configured")}>
          Configured products
        </button>
        <button type="button" role="tab" aria-selected={tab === "custom"} onClick={() => setTab("custom")} className={tabClass(tab === "custom")}>
          Custom items
        </button>
      </div>
      <div role="tabpanel" hidden={tab !== "configured"}>
        <MyCollectionList items={items} />
      </div>
      <div role="tabpanel" hidden={tab !== "custom"}>
        <MyCollectionCustomItems items={customItems} />
      </div>
    </div>
  );
}
