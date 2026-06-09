import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { EnquiriesPreview } from "@/components/sales/enquiries-preview";
import { requireActiveUser } from "@/lib/auth";
import Link from "next/link";

export default async function SalesEnquiriesPage() {
  const { user, displayName } = await requireActiveUser();

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Leads / Enquiries"
      description="Legacy enquiry records are kept for backward compatibility."
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        <section className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <h2 className="font-semibold">Leads and enquiries are now managed under Opportunities.</h2>
          <p className="mt-1 text-sm">
            This legacy workspace remains available so existing local enquiry data is not deleted.
          </p>
          <Link
            href="/sales/opportunities"
            className="mt-3 inline-flex h-10 items-center rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Open Opportunities
          </Link>
        </section>
        <EnquiriesPreview />
      </div>
    </ErpAppShell>
  );
}
