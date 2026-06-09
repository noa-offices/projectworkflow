import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { ClientApprovalsPreview } from "@/components/sales/client-approvals-preview";
import { requireActiveUser } from "@/lib/auth";

export default async function SalesApprovalsPage() {
  const { user, displayName } = await requireActiveUser();

  return (
    <ErpAppShell
      eyebrow="SALES"
      title="Client Approvals"
      description="Review quotations awaiting client confirmation before converting them into projects."
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <div className="px-5 py-6 sm:px-8">
        <ClientApprovalsPreview />
      </div>
    </ErpAppShell>
  );
}
