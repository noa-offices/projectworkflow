import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { EnquiriesPreview } from "@/components/sales/enquiries-preview";
import { requireActiveUser } from "@/lib/auth";

export default async function SalesEnquiriesPage() {
  const { user, displayName } = await requireActiveUser();

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Leads / Enquiries"
      description="Capture new client enquiries before they become qualified sales opportunities."
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        <EnquiriesPreview />
      </div>
    </ErpAppShell>
  );
}
