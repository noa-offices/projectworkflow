import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";

export default async function ClientsPage() {
  const { user, displayName } = await requireActiveUser();

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Clients & Projects"
          description="Placeholder workspace for client profiles, project details, contacts, and related quotation history."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <section className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-950">Coming next</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Client records, project references, contact roles, and activity
              summaries will be introduced in the next implementation phase.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
