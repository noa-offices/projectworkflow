import Link from "next/link";

const navigationItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Products" },
  { href: "/clients", label: "Clients" },
  { href: "/quotations", label: "Quotations" },
  { href: "/settings", label: "Settings" },
];

export function AppSidebar() {
  return (
    <aside className="border-b border-zinc-200 bg-white lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-5 py-4 lg:block lg:px-6 lg:py-6">
        <Link href="/" className="text-lg font-semibold tracking-tight text-zinc-950">
          ProjectWorkflow
        </Link>
        <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 lg:inline-flex">
          Phase 0
        </span>
      </div>
      <nav className="flex gap-2 overflow-x-auto px-4 pb-4 lg:flex-col lg:px-4">
        {navigationItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
