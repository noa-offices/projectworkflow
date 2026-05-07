import { AppSidebar } from "@/components/app-sidebar";
import { ModuleCard } from "@/components/module-card";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";

const modules = [
  {
    title: "Clients & Projects",
    description:
      "Manage clients, projects, and project quotations from one working area.",
    href: "/clients",
  },
  {
    title: "Product Library",
    description:
      "Manage product templates, source pricing, images, and configurable options.",
    href: "/products/templates",
  },
  {
    title: "Brand Material Library",
    description:
      "Manage finishes, swatches, material groups, and brand-specific selections.",
    href: "/products/materials",
  },
  {
    title: "Price Updates",
    description:
      "Review overdue template price checks, brand price lists, and source price follow-up work.",
    href: "/products/templates?priceStatus=due",
  },
  {
    title: "Specification Sheets",
    description:
      "Open a client project quotation to preview or download specification sheets.",
    href: "/clients",
  },
  {
    title: "Settings",
    description:
      "Manage company profile, users, and system configuration areas.",
    href: "/settings",
  },
];

export default async function DashboardPage() {
  const { user, displayName } = await requireActiveUser();

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Dashboard"
          description="A practical starting point for client quotations, specifications, product setup, and price-control work."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {modules.map((module) => (
              <ModuleCard
                key={module.title}
                title={module.title}
                description={module.description}
                href={module.href}
              />
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}
