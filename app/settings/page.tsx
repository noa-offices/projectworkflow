import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { requireActiveUser } from "@/lib/auth";

export default async function SettingsPage() {
  const { user, profile, displayName } = await requireActiveUser();

  return (
    <div className="min-h-screen bg-stone-50 lg:flex">
      <AppSidebar />
      <div className="flex-1">
        <TopBar
          title="Settings"
          description="Placeholder area for workspace defaults, document preferences, and future administrative controls."
          userDisplayName={displayName}
          userEmail={user.email}
        />
        <main className="px-5 py-6 sm:px-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {profile?.role === "system_owner" ? (
              <Link
                href="/settings/users"
                className="group rounded-lg border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-emerald-900/25 hover:shadow-md"
              >
                <div className="flex h-full flex-col justify-between gap-6">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-950">
                      User Management
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Approve users and manage account roles.
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-emerald-900 transition group-hover:text-emerald-800">
                    Open settings
                  </span>
                </div>
              </Link>
            ) : null}
          </div>
          <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-950">Coming next</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Company-neutral defaults, quotation numbering preferences, export
              settings, and workflow options will live here later.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
