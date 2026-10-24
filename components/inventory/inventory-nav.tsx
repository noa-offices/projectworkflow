"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function InventoryNav({ active, preview = false, previewRole = 'warehouse_staff', showMovements = false }: { active?: "overview" | "products" | "requests" | "movements"; preview?: boolean; previewRole?: string; showMovements?: boolean }) {
  const pathname = usePathname();
  const selected = active ?? (pathname.startsWith("/inventory/movements") ? "movements" : pathname.startsWith("/inventory/requests") ? "requests" : pathname.startsWith("/inventory/products") ? "products" : "overview");
  return (
    <nav aria-label="Inventory" className="mb-5 flex min-w-0 gap-0 overflow-x-auto border-b sm:gap-1 border-zinc-200">
      {([{ key: "overview", label: "Overview", href: "/inventory" }, { key: "products", label: "Products", href: "/inventory/products" }, {key:"requests",label:"Requests",href:"/inventory/requests"}, ...(showMovements ? [{key:"movements",label:"Movements",href:"/inventory/movements"}] : [])] as const).map(tab => (
        <Link key={tab.key} href={preview ? `/dev/inventory-preview?view=${tab.key}&frame=1&role=${encodeURIComponent(previewRole)}` : tab.href} aria-current={selected === tab.key ? "page" : undefined}
          className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-2.5 text-sm sm:px-4 font-semibold ${selected === tab.key ? "border-emerald-900 text-emerald-900" : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-950"}`}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
