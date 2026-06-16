import { ERPDashboard } from "@/components/dashboard/erp-dashboard";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import { requireActiveUser } from "@/lib/auth";

export default async function DashboardPage() {
  const { user, profile, displayName } = await requireActiveUser();

  return (
    <ErpAppShell
      eyebrow="Dashboard"
      title="ERP Overview"
      description="Local-first operating view for projects, quotations, products, procurement, and document workflows."
      role={profile?.role ?? null}
      userDisplayName={displayName}
      userEmail={user.email}
    >
      <ERPDashboard />
    </ErpAppShell>
  );
}
