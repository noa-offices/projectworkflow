import type { ReactNode } from "react";

/**
 * Page wrapper for every Inventory screen. The generous bottom padding (plus the phone safe area)
 * keeps the last card and sticky bars clear of the floating assistant in the bottom-right corner.
 */
export function InventoryFrame({ children }: { children: ReactNode }) {
  return <div data-inventory-frame className="mx-auto min-w-0 max-w-7xl px-3 pt-2 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-4 sm:pt-3 lg:p-8 lg:pb-24">{children}</div>;
}
