import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";

const productCards = [
  {
    title: "Brands & Categories",
    description: "Manage brand records, main categories, and nested sub categories.",
    href: "/products/brands",
    action: "Manage",
  },
  {
    title: "Product Templates",
    description: "Reusable product structures and specification fields.",
    href: "/products/templates",
    action: "Manage",
  },
  {
    title: "Price Components",
    description: "Components are managed inside each product template for now.",
    href: "#",
    action: "Open a template",
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
          description="Manage product foundations before templates, pricing, and quotation logic are added."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {productCards.map((card) => {
              const isReady = card.href !== "#";
              const className =
                "rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition";

              if (!isReady) {
                return (
                  <div key={card.title} className={`${className} opacity-75`}>
                    <h2 className="text-base font-semibold text-zinc-950">
                      {card.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      {card.description}
                    </p>
                    <p className="mt-6 text-sm font-semibold text-zinc-500">
                      {card.action}
                    </p>
                  </div>
                );
              }

              return (
                <Link
                  key={card.title}
                  href={card.href}
                  className={`${className} hover:border-emerald-900/25 hover:shadow-md`}
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
              );
            })}
          </section>
        </main>
      </div>
    </div>
  );
}
