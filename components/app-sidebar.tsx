"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { APP_LABEL, APP_NAME } from "@/lib/app-meta";

const navigationGroups = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/clients", label: "Clients & Projects" },
    ],
  },
  {
    label: "Products",
    items: [
      { href: "/products/templates", label: "Product Library" },
      { href: "/products/management", label: "Product Management" },
      { href: "/products/brands", label: "Brands" },
      { href: "/products/materials", label: "Material Library" },
      { href: "/products/templates?priceStatus=due", label: "Price Updates" },
    ],
  },
  {
    items: [{ href: "/settings", label: "Settings" }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function isActive(href: string) {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/";
    }

    if (href === "/clients") {
      return pathname === "/clients" || pathname.startsWith("/clients/");
    }

    if (href === "/products/templates?priceStatus=due") {
      return pathname === "/products/templates" && searchParams.get("priceStatus") === "due";
    }

    if (href === "/products/management") {
      return pathname === "/products/templates" && searchParams.get("manage") === "1";
    }

    if (href === "/products/templates") {
      return pathname === "/products/templates" && searchParams.get("priceStatus") !== "due" && searchParams.get("manage") !== "1";
    }

    if (href === "/products/brands") {
      return pathname === "/products/brands";
    }

    if (href === "/products/materials") {
      return pathname === "/products/materials";
    }

    if (href === "/settings") {
      return pathname === "/settings" || pathname.startsWith("/settings/");
    }

    return pathname === href;
  }

  return (
    <aside className="border-b border-zinc-200 bg-white lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-5 py-4 lg:block lg:px-6 lg:py-6">
        <div>
          <Link href="/" className="text-lg font-semibold tracking-tight text-zinc-950">
            {APP_NAME}
          </Link>
          <p className="hidden pt-1 text-xs font-medium text-zinc-500 lg:block">
            {APP_LABEL}
          </p>
        </div>
      </div>
      <nav className="flex gap-4 overflow-x-auto px-4 pb-4 lg:flex-col lg:px-4">
        {navigationGroups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className="flex gap-2 lg:flex-col">
            {group.label ? (
              <p className="hidden px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 lg:block">
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition hover:bg-slate-50 hover:text-emerald-900 ${
                  isActive(item.href)
                    ? "bg-emerald-50 text-emerald-900"
                    : "text-slate-800"
                } ${
                  group.label ? "lg:ml-3" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
