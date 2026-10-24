"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusRing } from "./inventory-ui";
import { ScrollTabs } from "./inventory-ui-client";

type Tab = "overview" | "products" | "requests" | "movements";
export function InventoryNav({ active, preview = false, previewRole = 'warehouse_staff', showMovements = false }: { active?: Tab; preview?: boolean; previewRole?: string; showMovements?: boolean }) {
  const pathname = usePathname();
  const selected = active ?? (pathname.startsWith("/inventory/movements") ? "movements" : pathname.startsWith("/inventory/requests") ? "requests" : pathname.startsWith("/inventory/products") ? "products" : "overview");
  const tabs: { key: Tab; label: string; href: string }[] = [{ key: "overview", label: "Overview", href: "/inventory" }, { key: "products", label: "Products", href: "/inventory/products" }, { key: "requests", label: "Requests", href: "/inventory/requests" }, ...(showMovements ? [{ key: "movements" as const, label: "Movements", href: "/inventory/movements" }] : [])];
  return (
    <ScrollTabs label="Inventory" currentKey={selected} className="mb-3 border-b border-zinc-200 lg:mb-5">
      {tabs.map(tab => (
        <Link key={tab.key} href={preview ? `/dev/inventory-preview?view=${tab.key}&frame=1&role=${encodeURIComponent(previewRole)}` : tab.href} aria-current={selected === tab.key ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold sm:px-4 ${focusRing} ${selected === tab.key ? "border-emerald-900 text-emerald-900" : "border-transparent text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"}`}>
          {tab.label}
        </Link>
      ))}
    </ScrollTabs>
  );
}
