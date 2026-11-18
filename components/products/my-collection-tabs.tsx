"use client";

import { useMemo, useState } from "react";
import { MyCollectionCustomItems } from "@/components/products/my-collection-custom-items";
import { MyCollectionList } from "@/components/products/my-collection-list";
import { SentTab, SharedWithYouTab } from "@/components/products/my-collection-shared";
import { distinctBrands } from "@/lib/products/saved-setups/custom-brands";
import type { CustomItemListItem } from "@/lib/products/saved-setups/custom-item";
import type { SetupListItem } from "@/lib/products/saved-setups/saved-setups-service";
import { sharedTabLabel, type CollectionTab } from "@/lib/products/saved-setups/shares";

// Tabs: the two lists (unchanged), "Shared with you (N)" (hidden when nothing is waiting) and "Sent".
// The first tab comes from ?tab= (the page parses it); after that, changing tabs is client state as before.
export function MyCollectionTabs({
  items,
  customItems,
  initialTab = "configured",
  pendingShares = 0,
}: {
  items: SetupListItem[];
  customItems: CustomItemListItem[];
  initialTab?: CollectionTab;
  pendingShares?: number;
}) {
  const [tab, setTab] = useState<CollectionTab>(initialTab);
  const [pending, setPending] = useState(pendingShares);
  const brands = useMemo(() => distinctBrands(customItems), [customItems]);
  const tabClass = (active: boolean) =>
    `h-10 border-b-2 px-4 text-sm font-semibold transition ${active ? "border-emerald-900 text-emerald-900" : "border-transparent text-zinc-500 hover:text-zinc-800"}`;

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="My Collection" className="flex flex-wrap gap-2 border-b border-zinc-200">
        <button type="button" role="tab" aria-selected={tab === "configured"} onClick={() => setTab("configured")} className={tabClass(tab === "configured")}>
          Configured products
        </button>
        <button type="button" role="tab" aria-selected={tab === "custom"} onClick={() => setTab("custom")} className={tabClass(tab === "custom")}>
          Custom items
        </button>
        {pending > 0 || tab === "shared" ? (
          <button type="button" role="tab" aria-selected={tab === "shared"} onClick={() => setTab("shared")} className={tabClass(tab === "shared")}>
            {sharedTabLabel(pending)}
          </button>
        ) : null}
        <button type="button" role="tab" aria-selected={tab === "sent"} onClick={() => setTab("sent")} className={tabClass(tab === "sent")}>
          Sent
        </button>
      </div>
      <div role="tabpanel" hidden={tab !== "configured"}>
        <MyCollectionList items={items} />
      </div>
      <div role="tabpanel" hidden={tab !== "custom"}>
        <MyCollectionCustomItems items={customItems} />
      </div>
      {tab === "shared" ? (
        <div role="tabpanel">
          <SharedWithYouTab brands={brands} onPendingChange={setPending} onOpenTab={setTab} />
        </div>
      ) : null}
      {tab === "sent" ? (
        <div role="tabpanel">
          <SentTab />
        </div>
      ) : null}
    </div>
  );
}
