"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BarChart3,
  BadgeCheck,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileDown,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Presentation,
  Settings,
  ShoppingCart,
  Truck,
  Search,
} from "lucide-react";

type SidebarItem = {
  active?: boolean;
  disabled?: boolean;
  href?: string;
  icon: LucideIcon;
  label: string;
  suffix?: string;
};

type SidebarSection = {
  items: SidebarItem[];
  title: string;
};

function isDashboardActive(pathname: string) {
  return pathname === "/" || pathname === "/dashboard";
}

function isProjectsActive(pathname: string) {
  return pathname === "/clients" || pathname.startsWith("/clients/");
}

function isQuotationsActive(pathname: string) {
  return pathname === "/sales/quotations" || pathname.startsWith("/sales/quotations/") || pathname === "/quotations" || pathname.startsWith("/quotations/");
}

function isSalesApprovalsActive(pathname: string) {
  return pathname === "/sales/approvals" || pathname.startsWith("/sales/approvals/");
}

function isSettingsActive(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function isProductLibraryActive(pathname: string, priceStatus: string | null, manage: string | null) {
  return (
    (pathname === "/products" || pathname === "/products/templates") &&
    priceStatus !== "due" &&
    manage !== "1"
  );
}

function isProductManagementActive(pathname: string, manage: string | null) {
  return pathname === "/products/manage" || pathname === "/products/management" || (pathname === "/products/templates" && manage === "1");
}

function isPriceUpdatesActive(pathname: string, priceStatus: string | null) {
  return pathname === "/products/price-updates" || ((pathname === "/products" || pathname === "/products/templates") && priceStatus === "due");
}

function NavRow({ item, indent = false }: { indent?: boolean; item: SidebarItem }) {
  const Icon = item.icon;
  const className = [
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition",
    indent ? "ml-3" : "",
    item.active ? "bg-emerald-50 text-emerald-900" : "text-zinc-700 hover:bg-zinc-100 hover:text-emerald-900",
    item.disabled ? "cursor-not-allowed opacity-60 hover:bg-transparent hover:text-zinc-700" : "",
  ].join(" ");

  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.suffix ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          {item.suffix}
        </span>
      ) : null}
    </>
  );

  if (!item.href || item.disabled) {
    return (
      <div className={className} aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <Link href={item.href} aria-current={item.active ? "page" : undefined} className={className}>
      {content}
    </Link>
  );
}

export function ErpSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const priceStatus = searchParams.get("priceStatus");
  const manage = searchParams.get("manage");

  const sections: SidebarSection[] = useMemo(
    () => [
      {
        title: "Workspace",
        items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, active: isDashboardActive(pathname) }],
      },
      {
        title: "Sales",
        items: [
          { label: "Quotations", href: "/sales/quotations", icon: FileText, active: isQuotationsActive(pathname) },
          { label: "Approved Quotations", href: "/sales/approvals", icon: BadgeCheck, active: isSalesApprovalsActive(pathname) },
        ],
      },
      {
        title: "Projects",
        items: [
          { label: "Active Projects", href: "/clients", icon: FolderKanban, active: isProjectsActive(pathname) },
          { label: "Delivery & Installation", icon: Truck, disabled: true, suffix: "Coming soon" },
          { label: "Project Archive", icon: Archive, disabled: true, suffix: "Coming soon" },
        ],
      },
      {
        title: "Procurement",
        items: [
          { label: "Procurement RFQs", icon: Search, disabled: true, suffix: "Coming soon" },
          { label: "Purchase Orders", icon: ShoppingCart, disabled: true, suffix: "Coming soon" },
          { label: "Supplier Confirmations", icon: BadgeCheck, disabled: true, suffix: "Coming soon" },
        ],
      },
      {
        title: "Products",
        items: [
          { label: "Product Library", href: "/products", icon: Boxes, active: isProductLibraryActive(pathname, priceStatus, manage) },
          { label: "Product Management", href: "/products/manage", icon: Boxes, active: isProductManagementActive(pathname, manage) },
          { label: "Brands", href: "/products/brands", icon: Boxes, active: pathname === "/products/brands" },
          { label: "Material Library", href: "/products/materials", icon: Boxes, active: pathname === "/products/materials" },
          { label: "Price Updates", href: "/products/price-updates", icon: Boxes, active: isPriceUpdatesActive(pathname, priceStatus) },
        ],
      },
      {
        title: "Documents",
        items: [
          { label: "Order Confirmation", icon: ClipboardCheck, disabled: true, suffix: "Coming soon" },
          { label: "Specification Sheets", icon: FileText, disabled: true, suffix: "Coming soon" },
          { label: "Presentations", icon: Presentation, disabled: true, suffix: "Coming soon" },
          { label: "Delivery Notes", icon: FileDown, disabled: true, suffix: "Coming soon" },
        ],
      },
      {
        title: "Insights",
        items: [{ label: "Reports", icon: BarChart3, disabled: true, suffix: "Coming soon" }],
      },
      {
        title: "System",
        items: [{ label: "Settings", href: "/settings", icon: Settings, active: isSettingsActive(pathname) }],
      },
    ],
    [manage, pathname, priceStatus],
  );
  const activeSectionTitle = sections.find((section) => section.items.some((item) => item.active))?.title;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(["Workspace"]));

  function isSectionExpanded(title: string) {
    return title === activeSectionTitle || expandedSections.has(title);
  }

  function toggleSection(title: string) {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }

  return (
    <aside className="border-b border-zinc-200 bg-white lg:min-h-screen lg:border-b-0 lg:border-r">
      <div className="flex items-center gap-3 border-b border-zinc-200 px-5 py-5">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-900 text-sm font-bold text-white">
          PW
        </span>
        <div>
          <p className="text-sm font-semibold text-zinc-950">ProjectWorkflow</p>
          <p className="text-xs text-zinc-500">ERP Command Center</p>
        </div>
      </div>
      <div className="grid gap-6 px-3 py-5">
        {sections.map((section) => (
          <nav key={section.title} className="grid gap-1" aria-label={section.title}>
            <button
              type="button"
              aria-expanded={isSectionExpanded(section.title)}
              onClick={() => toggleSection(section.title)}
              className={[
                "flex w-full items-center gap-2 rounded-md px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.2em] transition",
                section.title === activeSectionTitle ? "text-emerald-900" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700",
              ].join(" ")}
            >
              {isSectionExpanded(section.title) ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="flex-1">{section.title}</span>
            </button>
            {isSectionExpanded(section.title) ? (
              <div className="grid gap-1">
                {section.items.map((item) => (
                  <NavRow key={`${section.title}:${item.label}`} item={item} indent={section.title === "Products"} />
                ))}
              </div>
            ) : null}
          </nav>
        ))}
      </div>
    </aside>
  );
}
