import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";

const productCards = [
  {
    title: "Product Templates",
    description: "Manage reusable product templates, source pricing, images, and template options.",
    href: "/products/templates",
    action: "Manage",
  },
  {
    title: "Brand Material Library",
    description: "Reusable finish groups, material codes, and swatch references by brand.",
    href: "/products/materials",
    action: "Manage",
  },
  {
    title: "Brands",
    description: "Manage product brands, origins, suppliers, and brand-level price settings.",
    href: "/products/brands",
    action: "Manage Brands",
  },
  {
    title: "Price Updates",
    description: "Review templates with due price checks and follow up on source price updates.",
    href: "/products/templates?priceStatus=due",
    action: "Review due items",
  },
];

export default async function ProductsPage() {
  const { user, displayName } = await requireActiveUser();

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Products & Templates"
          description="Maintain the product library, materials, categories, and price-control workflows used by quotations."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {productCards.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-emerald-900/25 hover:shadow-md"
              >
                <h2 className="text-base font-semibold text-zinc-950">
                  {card.title}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {card.description}
                </p>
                <p className="mt-6 text-sm font-semibold text-emerald-900">
                  {card.action}
                </p>
              </Link>
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}
