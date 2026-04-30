import { AppSidebar } from "@/components/app-sidebar";
import { ModuleCard } from "@/components/module-card";
import { TopBar } from "@/components/top-bar";

const modules = [
  {
    title: "Products & Templates",
    description:
      "Organize reusable product details, standard options, and quotation building blocks.",
    href: "/products",
  },
  {
    title: "Clients & Projects",
    description:
      "Keep client records and project context ready for quotations and specifications.",
    href: "/clients",
  },
  {
    title: "Quotations",
    description:
      "Prepare clear commercial offers with project scope, quantities, and pricing.",
    href: "/quotations",
  },
  {
    title: "Specification Sheets",
    description:
      "Create structured product specifications for approvals, procurement, and delivery.",
    href: "/products",
  },
  {
    title: "Price Updates",
    description:
      "Review product cost changes before they flow into future quotation work.",
    href: "/products",
  },
  {
    title: "Settings",
    description:
      "Manage workspace preferences, document defaults, and future team options.",
    href: "/settings",
  },
];

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Dashboard"
          description="A calm starting point for quotations, specifications, clients, and project order workflow."
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
