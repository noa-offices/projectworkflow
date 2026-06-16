import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";

export default async function SalesOpportunitiesPage() {
  const { user, profile, displayName } = await requireActiveUser();

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Opportunities"
      description="Opportunities are no longer used. New enquiries now start from Quotations."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Opportunities are no longer used.</h2>
          <p className="mt-2 text-sm text-zinc-600">
            New enquiries now start from Quotations. Existing local opportunity data has not been deleted.
          </p>
          <Link
            href="/sales/quotations"
            className="mt-4 inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Open Quotations
          </Link>
        </section>
      </div>
    </ErpAppShell>
  );
}
